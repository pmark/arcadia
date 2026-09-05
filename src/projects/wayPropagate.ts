import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type Database from "better-sqlite3";
import { getProject } from "../db/repositories.js";
import { listMonitoredProjects } from "../commands/workMonitor.js";
import { parseGithubSlug, resolveBaseBranch, uncommittedChanges } from "../git/worktrees.js";
import { arcadiaRepoRoot } from "./contextSetup.js";
import { computeWayPropagationPlan, declinesAutomaticUpgrades, readUpgradePolicy, type WayPropagationPlan } from "./wayPropagation.js";

/**
 * Delivers Way changes to every adopting project as a pull request, per
 * Decision 0024: a mechanical-tier change opens a pull request and merges it
 * without review; a governing-tier change (the Constitution, the
 * continuation protocol) always leaves the pull request open for a human,
 * even when the same run also touches the mechanical tier.
 *
 * Git and `gh` are run through an injectable `runCommand` -- exactly the
 * pattern `workMonitoring/pullRequests.ts` already uses -- so this can be
 * tested against a real local repository and a local bare "origin" without
 * ever touching GitHub.
 */

export const WAY_PROPAGATION_STATUSES = [
  "self",
  "current",
  "no-repo",
  "unreachable-repo",
  "declined",
  "dirty-working-tree",
  "no-github-remote",
  "dry-run",
  "merged",
  "opened-governing",
  "error"
] as const;
export type WayPropagationStatus = (typeof WAY_PROPAGATION_STATUSES)[number];

export interface WayPropagationResult {
  projectId: string;
  projectName: string;
  repoPath: string | null;
  status: WayPropagationStatus;
  detail: string;
  pullRequestUrl: string | null;
  filesChanged: string[];
  unmanageable: string[];
}

export interface WayPropagationSummary {
  generatedAt: string;
  dryRun: boolean;
  results: WayPropagationResult[];
  counts: Record<WayPropagationStatus, number>;
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (cwd: string, command: string, args: string[]) => CommandResult;

export interface RunWayPropagationOptions {
  db: Database.Database;
  /** Restrict the run to one project id or name; every reachable project otherwise. */
  projectIdentifier?: string;
  /** Compute and report what would happen without writing, committing, or pushing anything. */
  dryRun?: boolean;
  now?: () => string;
  runCommand?: CommandRunner;
}

export function runWayPropagation(options: RunWayPropagationOptions): WayPropagationSummary {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const dryRun = options.dryRun === true;
  const now = options.now ?? defaultBranchStamp;
  const arcadiaRoot = safeRealpath(arcadiaRepoRoot());

  const identifier = options.projectIdentifier?.trim().toLowerCase();
  const projects = listMonitoredProjects(options.db).filter(
    (project) => !identifier || project.id.toLowerCase() === identifier || project.name.toLowerCase() === identifier
  );

  const results = projects.map((project) => {
    const slug = getProject(options.db, project.id)?.slug ?? null;
    return propagateOneProject(
      { id: project.id, name: project.name, repositoryPath: project.repositoryPath, slug },
      { dryRun, now, runCommand, arcadiaRoot }
    );
  });

  const counts = Object.fromEntries(WAY_PROPAGATION_STATUSES.map((status) => [status, 0])) as Record<
    WayPropagationStatus,
    number
  >;
  for (const result of results) counts[result.status] += 1;

  return { generatedAt: new Date().toISOString(), dryRun, results, counts };
}

function propagateOneProject(
  project: { id: string; name: string; repositoryPath: string | null; slug: string | null },
  context: { dryRun: boolean; now: () => string; runCommand: CommandRunner; arcadiaRoot: string | null }
): WayPropagationResult {
  const base: Omit<WayPropagationResult, "status" | "detail"> = {
    projectId: project.id,
    projectName: project.name,
    repoPath: project.repositoryPath,
    pullRequestUrl: null,
    filesChanged: [],
    unmanageable: []
  };

  if (!project.repositoryPath) {
    return { ...base, status: "no-repo", detail: "No repository path is configured." };
  }
  if (!existsSync(project.repositoryPath) || !statSync(project.repositoryPath).isDirectory()) {
    return { ...base, status: "unreachable-repo", detail: `Repository path is missing: ${project.repositoryPath}` };
  }
  const repoPath = realpathSync(project.repositoryPath);
  if (!context.runCommand(repoPath, "git", ["rev-parse", "--is-inside-work-tree"]).ok) {
    return { ...base, repoPath, status: "unreachable-repo", detail: `Not a Git working copy: ${repoPath}` };
  }
  if (context.arcadiaRoot && repoPath === context.arcadiaRoot) {
    return { ...base, repoPath, status: "self", detail: "Arcadia does not propagate the Way to itself." };
  }

  const policy = readUpgradePolicy(repoPath);
  if (declinesAutomaticUpgrades(repoPath)) {
    return {
      ...base,
      repoPath,
      status: "declined",
      detail: `Declined: adoption.json declares upgrade_policy "${policy}".`
    };
  }

  const plan = computeWayPropagationPlan(repoPath, project.slug);
  const writable = plan.changes.filter((change) => change.action === "write");
  const unmanageable = plan.unmanageable.map((change) => change.path);

  if (writable.length === 0) {
    return { ...base, repoPath, status: "current", detail: "Already current.", unmanageable };
  }

  if (context.dryRun) {
    const tiers = [plan.hasMechanicalChanges ? "mechanical" : null, plan.hasGoverningChanges ? "governing" : null]
      .filter(Boolean)
      .join(" and ");
    const willMerge = plan.hasMechanicalChanges && !plan.hasGoverningChanges;
    return {
      ...base,
      repoPath,
      status: "dry-run",
      detail: `Would open a pull request touching the ${tiers} tier${willMerge ? " and auto-merge it" : "; it would stay open for review"}.`,
      filesChanged: writable.map((change) => change.path),
      unmanageable
    };
  }

  return applyPropagation(repoPath, plan, writable, unmanageable, context, base);
}

function applyPropagation(
  repoPath: string,
  plan: WayPropagationPlan,
  writable: WayPropagationPlan["changes"],
  unmanageable: string[],
  context: { now: () => string; runCommand: CommandRunner },
  base: Omit<WayPropagationResult, "status" | "detail">
): WayPropagationResult {
  const dirty = uncommittedChanges(repoPath);
  if (dirty.length > 0) {
    return {
      ...base,
      repoPath,
      status: "dirty-working-tree",
      detail: "The repository has uncommitted changes; propagation will not mix them into a Way commit.",
      unmanageable
    };
  }

  const remoteUrl = tryRunCommand(context.runCommand, repoPath, "git", ["remote", "get-url", "origin"]);
  const slug = remoteUrl ? parseGithubSlug(remoteUrl) : null;
  if (!slug) {
    return {
      ...base,
      repoPath,
      status: "no-github-remote",
      detail: "No GitHub remote named origin was found; propagation needs one to open a pull request.",
      unmanageable
    };
  }

  const baseBranch = resolveBaseBranch(repoPath);
  const branch = `arcadia-way/propagate-${context.now()}`;

  try {
    runOrThrow(context.runCommand, repoPath, "git", ["checkout", baseBranch]);
    runOrThrow(context.runCommand, repoPath, "git", ["checkout", "-b", branch]);

    for (const change of writable) {
      const target = path.join(repoPath, change.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, change.content ?? "", "utf8");
    }

    runOrThrow(context.runCommand, repoPath, "git", ["add", ...writable.map((change) => change.path)]);
    runOrThrow(context.runCommand, repoPath, "git", ["commit", "-m", commitMessage(plan)]);
    runOrThrow(context.runCommand, repoPath, "git", ["push", "-u", "origin", branch]);

    const title = "Arcadia Way: propagate updates";
    const body = pullRequestBody(plan, writable);
    const createResult = runOrThrow(context.runCommand, repoPath, "gh", [
      "pr",
      "create",
      "--repo",
      slug,
      "--base",
      baseBranch,
      "--head",
      branch,
      "--title",
      title,
      "--body",
      body
    ]);
    const pullRequestUrl = createResult.stdout.trim().split("\n").pop() ?? null;

    const willAutoMerge = plan.hasMechanicalChanges && !plan.hasGoverningChanges;
    if (willAutoMerge) {
      runOrThrow(context.runCommand, repoPath, "gh", ["pr", "merge", branch, "--repo", slug, "--squash", "--delete-branch"]);
      return {
        ...base,
        repoPath,
        status: "merged",
        detail: "Mechanical-tier change merged without review.",
        pullRequestUrl,
        filesChanged: writable.map((change) => change.path),
        unmanageable
      };
    }

    return {
      ...base,
      repoPath,
      status: "opened-governing",
      detail: "A governing-tier change is included; the pull request stays open for a human to merge.",
      pullRequestUrl,
      filesChanged: writable.map((change) => change.path),
      unmanageable
    };
  } catch (error) {
    return {
      ...base,
      repoPath,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      unmanageable
    };
  } finally {
    // Always return the repository to its starting branch; the propagation
    // branch itself is left for the opened pull request to reference, or is
    // already deleted remotely (and locally, by `--delete-branch`) once merged.
    context.runCommand(repoPath, "git", ["checkout", baseBranch]);
  }
}

function commitMessage(plan: WayPropagationPlan): string {
  const tiers = [plan.hasMechanicalChanges ? "mechanical" : null, plan.hasGoverningChanges ? "governing" : null]
    .filter(Boolean)
    .join(" and ");
  return `Arcadia Way: propagate ${tiers} updates`;
}

function pullRequestBody(plan: WayPropagationPlan, writable: WayPropagationPlan["changes"]): string {
  const lines = [
    "Propagated by `arcadia way propagate`, per Decision 0024.",
    "",
    "Files:",
    ...writable.map((change) => `- \`${change.path}\` (${change.tier})`)
  ];
  if (plan.hasGoverningChanges) {
    lines.push("", "This run touches the governing tier, so it will not merge automatically.");
  }
  return lines.join("\n");
}

function tryRunCommand(runCommand: CommandRunner, cwd: string, command: string, args: string[]): string | null {
  const result = runCommand(cwd, command, args);
  return result.ok ? result.stdout.trim() : null;
}

function runOrThrow(runCommand: CommandRunner, cwd: string, command: string, args: string[]): CommandResult {
  const result = runCommand(cwd, command, args);
  if (!result.ok) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim() || "no output"}`);
  }
  return result;
}

function safeRealpath(target: string): string | null {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}

function defaultBranchStamp(): string {
  return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function defaultRunCommand(cwd: string, command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? ""
  };
}
