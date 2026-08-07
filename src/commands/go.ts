import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { discoverDocs } from "../docs/discover.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";

export interface GoCommandOptions {
  repo?: string;
  source?: string;
  apply?: boolean;
  agent?: "codex" | "claude";
  /** Overrides the plan's `recommended_model` for this one invocation. */
  model?: string;
  /** Overrides the plan's `recommended_reasoning_effort` for this one invocation. */
  effort?: string;
  /** Test-only override; the CLI intentionally does not expose it. */
  agentWorktreeRoot?: string;
  /** Test-only clock injection. */
  now?: Date;
}

interface WorktreeRecord {
  path: string;
  head: string;
  branch: string | null;
}

export interface GoCommandData {
  applied: boolean;
  projectSlug: string;
  repositoryPath: string;
  sourceWorktree: string;
  sourceBranch: string;
  baseBranch: string;
  baseWorktree: string | null;
  integration: "not-needed" | "fast-forward";
  commitsToIntegrate: number;
  sourceWorktreeRemoved: boolean;
  sourceBranchDeleted: boolean;
  nextWorktree: {
    agent: "codex" | "claude";
    path: string;
    branch: string;
    /** Resolved from `--model`, else the plan's `recommended_model`. Never absent: unresolved refuses before a worktree is created. */
    model: string;
    /** Resolved from `--effort`, else the plan's `recommended_reasoning_effort`. Unlike model, absence is valid — the agent CLI's own default applies. */
    effort: string | null;
    command: string;
  } | null;
  dispatch: DispatchResolution;
  dispatchable: boolean;
  handoff: {
    baseRef: string;
    prompt: "arcadia advance";
  };
}

const SAFE_TASK_BRANCH = /^(codex\/|claude\/|agent\/|worktree-)/;

export function runGoCommand(options: GoCommandOptions): CommandSuccess<GoCommandData> {
  const requestedRepo = options.repo ?? process.cwd();
  const requestedSource = options.source ?? requestedRepo;
  const repo = existingDirectory(requestedRepo, "repository");
  const source = existingDirectory(requestedSource, "source worktree");
  const worktrees = parseWorktrees(git(repo, ["worktree", "list", "--porcelain"]));
  const controlWorktree = worktrees[0].path;
  const sourceRecord = worktrees.find((candidate) => samePath(candidate.path, source));
  if (!sourceRecord) {
    throw validationError("The source path is not a registered worktree for this repository.", {
      source,
      worktrees: worktrees.map((candidate) => candidate.path)
    });
  }
  if (!sourceRecord.branch) {
    throw validationError("Arcadia go will not reconcile a detached source worktree.", {
      source,
      head: sourceRecord.head,
      remedy: "Create and preserve a named task branch first."
    });
  }

  const baseBranch = resolveBaseBranch(repo);
  const baseRef = `refs/heads/${baseBranch}`;
  const baseRecord = worktrees.find((candidate) => candidate.branch === baseRef);

  assertClean(sourceRecord.path, "source worktree");
  if (baseRecord && !samePath(baseRecord.path, sourceRecord.path)) {
    assertClean(baseRecord.path, "base worktree");
  }

  const sourceBranch = sourceRecord.branch.replace(/^refs\/heads\//, "");
  const integration = sourceBranch === baseBranch ? "not-needed" : "fast-forward";
  const commitsToIntegrate = countCommits(sourceRecord.path, baseBranch, sourceBranch);

  if (integration === "fast-forward") {
    if (!SAFE_TASK_BRANCH.test(sourceBranch)) {
      throw validationError("Arcadia go only removes clearly agent-owned task branches.", {
        sourceBranch,
        allowedPrefixes: ["codex/", "claude/", "agent/", "worktree-"],
        remedy: "Integrate and retire this branch manually, or rename it to an agent-owned task branch after review."
      });
    }
    if (!isAncestor(sourceRecord.path, baseBranch, sourceBranch)) {
      throw validationError("The source branch cannot fast-forward the local base branch.", {
        sourceBranch,
        baseBranch,
        remedy: "Reconcile the divergent histories manually in a separate integration worktree."
      });
    }
  }

  const projectSlug = resolveProjectSlug(sourceRecord.path);
  const sourceDispatch = resolveDispatch(sourceRecord.path, projectSlug);
  if (!isDispatchable(sourceDispatch)) {
    throw validationError("The repository does not resolve exactly one dispatchable Arcadia action.", {
      projectSlug,
      blockers: sourceDispatch.blockers,
      operatorQuestion: sourceDispatch.operatorQuestion,
      currentAction: sourceDispatch.context?.action.id ?? null,
      remedy: "Repair the governed pointer or answer its Decision before starting another coding-agent session."
    });
  }

  let sourceWorktreeRemoved = false;
  let sourceBranchDeleted = false;
  let nextWorktree: GoCommandData["nextWorktree"] = null;
  let dispatch = sourceDispatch;
  if (options.apply && integration === "fast-forward") {
    if (baseRecord) {
      git(baseRecord.path, ["merge", "--ff-only", sourceBranch]);
    } else {
      // The base branch may be unattached because an agent switched the
      // primary checkout onto its task branch. Updating it is safe only after
      // the ancestry check above proves this is a strict fast-forward.
      git(sourceRecord.path, ["branch", "-f", baseBranch, sourceBranch]);
    }

    const baseDispatch = resolveDispatch(baseRecord?.path ?? sourceRecord.path, projectSlug);
    if (!isDispatchable(baseDispatch)) {
      throw validationError("The fast-forward completed, but dispatch validation failed from the base worktree.", {
        projectSlug,
        blockers: baseDispatch.blockers,
        operatorQuestion: baseDispatch.operatorQuestion,
        remedy: "Keep the source worktree and repair the governed pointer from the base worktree."
      });
    }
    dispatch = baseDispatch;

    if (!baseRecord && samePath(worktrees[0].path, sourceRecord.path)) {
      // A primary checkout cannot be removed as a linked worktree. Return it
      // to the now-fast-forwarded base branch instead.
      git(sourceRecord.path, ["switch", baseBranch]);
    } else {
      // Removing the caller's current directory is legal but leaves its shell
      // unusable. Move to a retained worktree (or its parent) first.
      if (isInside(process.cwd(), sourceRecord.path)) {
        process.chdir(baseRecord?.path ?? path.dirname(sourceRecord.path));
      }
      git(controlWorktree, ["worktree", "remove", sourceRecord.path]);
      sourceWorktreeRemoved = true;
    }
    git(controlWorktree, ["branch", "-d", sourceBranch]);
    sourceBranchDeleted = true;
    git(controlWorktree, ["worktree", "prune"]);
  }

  if (options.apply && options.agent) {
    const actionId = dispatch.context?.action.id;
    if (!actionId) {
      throw validationError("Arcadia go cannot name the next agent worktree without a resolved Action.");
    }

    const model = options.model ?? dispatch.context?.planRecommendedModel ?? null;
    if (!model) {
      throw validationError(
        "No model is resolved for the next agent session, and Arcadia go will not launch one unpinned.",
        {
          planPath: dispatch.context?.planPath ?? null,
          gitReconciliationAlreadyApplied: integration === "fast-forward",
          note:
            integration === "fast-forward"
              ? "The source was already fast-forwarded into the base branch and its worktree/branch retired " +
                "before this check runs, because the model recommendation must be read from the plan as it " +
                "exists after that merge, not before it. Only preparing the next agent worktree failed; nothing " +
                "needs to be undone."
              : "No Git state was changed by this refusal.",
          remedy:
            "Add `recommended_model` (and optionally `recommended_reasoning_effort`) to the plan's frontmatter, " +
            "or pass --model explicitly on this command."
        }
      );
    }
    const effort = options.effort ?? dispatch.context?.planRecommendedReasoningEffort ?? null;

    nextWorktree = createAgentWorktree({
      agent: options.agent,
      actionId,
      baseBranch,
      repositoryPath: controlWorktree,
      rootOverride: options.agentWorktreeRoot,
      now: options.now ?? new Date(),
      model,
      effort
    });
  }

  return createSuccess({
    command: "go",
    data: {
      applied: options.apply === true,
      projectSlug,
      repositoryPath: controlWorktree,
      sourceWorktree: sourceRecord.path,
      sourceBranch,
      baseBranch,
      baseWorktree: baseRecord?.path ?? null,
      integration,
      commitsToIntegrate,
      sourceWorktreeRemoved,
      sourceBranchDeleted,
      nextWorktree,
      dispatch,
      dispatchable: isDispatchable(dispatch),
      handoff: {
        baseRef: baseBranch,
        prompt: "arcadia advance"
      }
    }
  });
}

export function renderGoSuccess(response: CommandSuccess<GoCommandData>): string[] {
  const data = response.data;
  const action = data.dispatch.context?.action;
  const lines = [
    `Project: ${data.projectSlug}`,
    `Base: ${data.baseBranch}${data.baseWorktree ? ` — ${data.baseWorktree}` : " (not currently checked out)"}`,
    `Source: ${data.sourceBranch} — ${data.sourceWorktree}`,
    `Integration: ${data.integration}${data.commitsToIntegrate ? ` (${data.commitsToIntegrate} commit${data.commitsToIntegrate === 1 ? "" : "s"})` : ""}`
  ];

  if (!data.applied) {
    lines.push(
      "",
      "Preview only: no branch, worktree, or commit was changed.",
      "Run the same command with --apply to perform this exact safe reconciliation."
    );
  } else if (data.integration === "fast-forward") {
    lines.push(
      "",
      `Fast-forwarded ${data.sourceBranch} into ${data.baseBranch}.`,
      `Removed the clean source worktree and deleted the merged task branch.`
    );
  } else {
    lines.push("", "The source is already the clean base worktree; no Git reconciliation was needed.");
  }

  lines.push(
    "",
    `Dispatchable: ${data.dispatchable ? "yes" : "no"}`,
    `Current action: ${action?.id ?? "unresolved"}`,
    `Expected artifact: ${action?.expectedArtifact ?? "not declared"}`,
    "",
    data.nextWorktree
      ? `Prepared ${data.nextWorktree.agent} worktree: ${data.nextWorktree.path}`
      : `Start a fresh coding-agent session from ${data.handoff.baseRef} and prompt: ${data.handoff.prompt}`
  );
  if (data.nextWorktree) {
    lines.push(`Model: ${data.nextWorktree.model}${data.nextWorktree.effort ? ` (${data.nextWorktree.effort} effort)` : ""}`);
    lines.push(`Launch: ${data.nextWorktree.command}`);
  }
  return lines;
}

function createAgentWorktree(input: {
  agent: "codex" | "claude";
  actionId: string;
  baseBranch: string;
  repositoryPath: string;
  rootOverride?: string;
  now: Date;
  model: string;
  effort: string | null;
}): NonNullable<GoCommandData["nextWorktree"]> {
  const stamp = input.now.toISOString().replaceAll(/[-:.]/g, "").replace(/Z$/, "Z");
  const safeAction = input.actionId.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 72);
  const name = `${safeAction}-${stamp}`;
  const branch = `${input.agent}/${name}`;
  const repositoryName = path.basename(input.repositoryPath);
  const defaultRoot = path.join(homedir(), input.agent === "codex" ? ".codex/worktrees" : ".claude/worktrees");
  const root = path.resolve(input.rootOverride ?? defaultRoot);
  const worktreePath = path.join(root, name, repositoryName);
  if (existsSync(worktreePath)) {
    throw validationError("The prepared agent worktree path already exists.", { worktreePath });
  }
  mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(input.repositoryPath, ["worktree", "add", "-b", branch, worktreePath, input.baseBranch]);
  const command = buildLaunchCommand(input.agent, worktreePath, input.model, input.effort);
  return { agent: input.agent, path: worktreePath, branch, model: input.model, effort: input.effort, command };
}

/**
 * One place that knows each agent CLI's actual flag shape, so a future third
 * agent only has to add a branch here rather than touch every caller.
 *
 * claude: `--model` and `--effort` are both first-class CLI flags.
 * codex: `-m` selects the model; reasoning effort is a `-c key=value` TOML
 * override (`model_reasoning_effort`), not a dedicated flag.
 */
function buildLaunchCommand(agent: "codex" | "claude", worktreePath: string, model: string, effort: string | null): string {
  const quotedPath = JSON.stringify(worktreePath);
  const quotedModel = JSON.stringify(model);
  if (agent === "claude") {
    const effortFlag = effort ? ` --effort ${JSON.stringify(effort)}` : "";
    return `cd ${quotedPath} && claude --model ${quotedModel}${effortFlag} "arcadia advance"`;
  }
  const effortFlag = effort ? ` -c model_reasoning_effort=${JSON.stringify(effort)}` : "";
  return `codex -C ${quotedPath} -m ${quotedModel}${effortFlag} "arcadia advance"`;
}

function existingDirectory(input: string, label: string): string {
  const resolved = path.resolve(input);
  if (!existsSync(resolved)) {
    throw validationError(`The ${label} path does not exist.`, { path: resolved });
  }
  return realpathSync(resolved);
}

function assertClean(cwd: string, label: string): void {
  const status = git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.trim()) {
    throw validationError(`The ${label} is not clean; Arcadia go will not preserve or discard changes implicitly.`, {
      path: cwd,
      changes: status.split("\n").filter(Boolean),
      remedy: "Review and commit the intended work, or preserve it on a recovery branch, before retrying."
    });
  }
}

function resolveBaseBranch(cwd: string): string {
  const remoteHead = tryGit(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead) return remoteHead.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    if (tryGit(cwd, ["show-ref", "--verify", `refs/heads/${candidate}`]) !== null) return candidate;
  }
  throw validationError("Arcadia go could not determine the local base branch.", {
    remedy: "Configure origin/HEAD or create a local main/master branch."
  });
}

function resolveProjectSlug(repoRoot: string): string {
  const discovered = discoverDocs(repoRoot);
  const projects = discovered.docs.filter((doc) => doc.type === "project");
  if (projects.length !== 1) {
    throw validationError("Arcadia go requires exactly one managed Project document in the repository.", {
      projects: projects.map((project) => project.slug),
      errors: discovered.errors
    });
  }
  return projects[0].slug;
}

function countCommits(cwd: string, base: string, source: string): number {
  return Number.parseInt(git(cwd, ["rev-list", "--count", `${base}..${source}`]).trim(), 10);
}

function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd }).status === 0;
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = error as { stderr?: Buffer | string; message?: string };
    throw validationError(`Git command failed: git ${args.join(" ")}`, {
      cwd,
      cause: String(detail.stderr ?? detail.message ?? error).trim()
    });
  }
}

function tryGit(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 ? result.stdout.trim() : null;
}

function parseWorktrees(output: string): WorktreeRecord[] {
  return output
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      const fields = new Map(block.split("\n").map((line) => {
        const separator = line.indexOf(" ");
        return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
      }));
      return {
        path: realpathSync(fields.get("worktree") ?? ""),
        head: fields.get("HEAD") ?? "",
        branch: fields.get("branch") ?? null
      };
    });
}

function samePath(left: string, right: string): boolean {
  return realpathSync(left) === realpathSync(right);
}

function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
