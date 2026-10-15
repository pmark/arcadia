import { existsSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { getProject } from "../db/repositories.js";
import { listMonitoredProjects } from "../commands/workMonitor.js";
import { parseGithubSlug, resolveBaseBranch, sharesRepository } from "../git/worktrees.js";
import { assertGuidanceTarget } from "./agentGuidance.js";
import { arcadiaRepoRoot } from "./contextSetup.js";
import { computeWayPropagationPlan, declinesAutomaticUpgrades, readUpgradePolicy, type WayPropagationPlan } from "./wayPropagation.js";

/**
 * Delivers Way changes to every adopting project as a pull request, per
 * Every apply starts from a fresh isolated worktree. It never switches or
 * writes the registered primary checkout, and every pull request remains open
 * for the repository's normal review and merge gates.
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
  "opened",
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
  candidatePath: string | null;
  candidateBranch: string | null;
  candidateHead: string | null;
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
  /** Restrict the plan to the Learn retrieval bootstrap and its resources. */
  learningOnly?: boolean;
  now?: () => string;
  /** Test seams; production uses collision-resistant names under the system temp directory. */
  branchName?: () => string;
  candidateDirectory?: () => string;
  /** Resolved agent identity for the propagation commit. Required by the CLI for apply. */
  gitEnv?: Record<string, string>;
  runCommand?: CommandRunner;
}

export function runWayPropagation(options: RunWayPropagationOptions): WayPropagationSummary {
  const runCommand = options.runCommand ?? defaultRunCommand(options.gitEnv);
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
      { dryRun, learningOnly: options.learningOnly === true, now, branchName: options.branchName, candidateDirectory: options.candidateDirectory, runCommand, arcadiaRoot }
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
  context: { dryRun: boolean; learningOnly: boolean; now: () => string; branchName?: () => string; candidateDirectory?: () => string; runCommand: CommandRunner; arcadiaRoot: string | null }
): WayPropagationResult {
  const base: Omit<WayPropagationResult, "status" | "detail"> = {
    projectId: project.id,
    projectName: project.name,
    repoPath: project.repositoryPath,
    pullRequestUrl: null,
    filesChanged: [],
    unmanageable: [],
    candidatePath: null,
    candidateBranch: null,
    candidateHead: null
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
  if (context.arcadiaRoot && sharesRepository(repoPath, context.arcadiaRoot)) {
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

  let baseBranch: string;
  try { baseBranch = resolveBaseBranch(repoPath); }
  catch (error) { return { ...base, repoPath, status: "error", detail: error instanceof Error ? error.message : String(error) }; }
  if (context.dryRun) {
    const plan = computeWayPropagationPlan(repoPath, project.slug, { learningOnly: context.learningOnly });
    const writable = plan.changes.filter((change) => change.action === "write");
    const unmanageable = plan.unmanageable.map((change) => change.path);
    if (writable.length === 0 && plan.unmanageable.some((change) => change.path !== "CLAUDE.md")) {
      return { ...base, repoPath, status: "error", detail: `Guidance delivery is blocked: ${plan.unmanageable.map((change) => `${change.path}: ${change.reason}`).join(" ")}`, unmanageable };
    }
    if (writable.length === 0) return { ...base, repoPath, status: "current", detail: "Already current.", unmanageable };
    const tiers = [plan.hasMechanicalChanges ? "mechanical" : null, plan.hasGoverningChanges ? "governing" : null]
      .filter(Boolean)
      .join(" and ");
    return {
      ...base,
      repoPath,
      status: "dry-run",
      detail: `Would prepare an isolated candidate and open a pull request touching the ${tiers} tier; it would stay open for review.`,
      filesChanged: writable.map((change) => change.path),
      unmanageable
    };
  }

  return applyPropagation(repoPath, baseBranch, context, base, project.slug);
}

function applyPropagation(
  repoPath: string,
  baseBranch: string,
  context: { now: () => string; branchName?: () => string; candidateDirectory?: () => string; runCommand: CommandRunner; learningOnly: boolean },
  base: Omit<WayPropagationResult, "status" | "detail">,
  projectSlug: string | null
): WayPropagationResult {
  let unmanageable: string[] = [];
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

  const branch = context.branchName?.() ?? `arcadia-way/propagate-${context.now()}-${randomUUID().slice(0, 8)}`;
  const candidatePath = context.candidateDirectory?.() ?? mkdtempSync(path.join(tmpdir(), "arcadia-way-propagate-"));
  const candidateBase = `refs/remotes/origin/${baseBranch}`;
  const candidate: Pick<WayPropagationResult, "candidatePath" | "candidateBranch" | "candidateHead"> = {
    candidatePath,
    candidateBranch: branch,
    candidateHead: null
  };

  try {
    runOrThrow(context.runCommand, repoPath, "git", ["fetch", "origin", baseBranch]);
    runOrThrow(context.runCommand, repoPath, "git", ["rev-parse", "--verify", candidateBase]);
    if (tryRunCommand(context.runCommand, repoPath, "git", ["show-ref", "--verify", `refs/heads/${branch}`])) {
      throw new Error(`Candidate branch collision: ${branch}. The existing branch and its worktree were preserved.`);
    }
    runOrThrow(context.runCommand, repoPath, "git", ["worktree", "add", "-b", branch, candidatePath, candidateBase]);
    candidate.candidateHead = tryRunCommand(context.runCommand, candidatePath, "git", ["rev-parse", "HEAD"]);

    const plan = computeWayPropagationPlan(candidatePath, projectSlug, { learningOnly: context.learningOnly });
    const writable = plan.changes.filter((change) => change.action === "write");
    unmanageable = plan.unmanageable.map((change) => change.path);
    if (writable.length === 0 && plan.unmanageable.some((change) => change.path !== "CLAUDE.md")) {
      return { ...base, repoPath, ...candidate, status: "error", detail: `Guidance delivery is blocked on the pinned candidate base: ${plan.unmanageable.map((change) => `${change.path}: ${change.reason}`).join(" ")}`, unmanageable };
    }
    if (writable.length === 0) return { ...base, repoPath, ...candidate, status: "current", detail: "Already current on the pinned candidate base.", unmanageable };
    for (const change of writable) assertGuidanceTarget(candidatePath, change.path);
    for (const change of writable) {
      const target = path.join(candidatePath, change.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, change.content ?? "", "utf8");
    }

    runOrThrow(context.runCommand, candidatePath, "git", ["add", ...writable.map((change) => change.path)]);
    runOrThrow(context.runCommand, candidatePath, "git", ["commit", "-m", commitMessage(plan)]);
    candidate.candidateHead = tryRunCommand(context.runCommand, candidatePath, "git", ["rev-parse", "HEAD"]);
    runOrThrow(context.runCommand, candidatePath, "git", ["push", "-u", "origin", branch]);

    const title = "Arcadia Way: propagate updates";
    const body = pullRequestBody(plan, writable);
    const createResult = runOrThrow(context.runCommand, candidatePath, "gh", [
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

    return {
      ...base,
      repoPath,
      ...candidate,
      status: "opened",
      detail: "An isolated candidate was pushed and its pull request remains open for independent review and required checks.",
      pullRequestUrl,
      filesChanged: writable.map((change) => change.path),
      unmanageable
    };
  } catch (error) {
    return {
      ...base,
      repoPath,
      ...candidate,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      unmanageable
    };
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

function defaultRunCommand(gitEnv?: Record<string, string>): CommandRunner {
  return (cwd, command, args) => {
  const result = spawnSync(command, args, {
    cwd,
    env: command === "git" && args[0] === "commit" ? { ...process.env, ...gitEnv } : process.env,
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
  };
}
