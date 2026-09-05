import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { discoverDocs } from "../docs/discover.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import {
  SAFE_TASK_BRANCH,
  assertClean,
  countCommits,
  existingDirectory,
  git,
  isAncestor,
  isInside,
  parseWorktrees,
  refExists,
  resolveBaseBranch,
  samePath,
  summarizeClutter,
  tryGit,
  upstreamRef,
  type ClutterSummary
} from "../git/worktrees.js";
import {
  launchPreparedSession,
  prepareSession,
  resolveProjectTransition,
  systemTmux,
  type AgentSession,
  type ProjectTransition,
  type TmuxAdapter
} from "../sessions/index.js";

export interface GoCommandOptions {
  repo?: string;
  source?: string;
  apply?: boolean;
  agent?: "codex" | "claude";
  /** Overrides the plan's `recommended_model` for this one invocation. */
  model?: string;
  /** Overrides the plan's `recommended_reasoning_effort` for this one invocation. */
  effort?: string;
  workspace?: string;
  /** The only option that authorizes process creation. */
  launch?: boolean;
  /** Test-only override; the CLI intentionally does not expose it. */
  agentWorktreeRoot?: string;
  /** Test-only clock injection. */
  now?: Date;
  /** Test-only process boundary. */
  tmux?: TmuxAdapter;
}

export interface BaseRemoteSync {
  /** False when the base branch has no tracked remote; every other field is then null/false. */
  attempted: boolean;
  /** The remote name (e.g. "origin"), present whenever a fetch was attempted. */
  remote: string | null;
  fastForwarded: boolean;
  /** Set whenever fastForwarded is false, explaining why (no remote, already current). */
  reason: string | null;
}

export interface GoCommandData {
  applied: boolean;
  projectSlug: string;
  repositoryPath: string;
  sourceWorktree: string;
  sourceBranch: string;
  baseBranch: string;
  baseWorktree: string | null;
  baseRemoteSync: BaseRemoteSync;
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
  transition: ProjectTransition;
  session: AgentSession | null;
  handoff: {
    baseRef: string;
    prompt: "arcadia advance";
  };
  /** Local-only accumulation counts, so session boundaries surface clutter instead of hiding it. Null when git could not be read. */
  clutter: ClutterSummary | null;
}

export function runGoCommand(options: GoCommandOptions): CommandSuccess<GoCommandData> {
  if (options.launch && (!options.apply || options.agent !== "claude")) {
    throw validationError("--launch requires --apply --agent claude; it is the only authority to start a process.");
  }
  const requestedRepo = options.repo ?? invocationRoot();
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

  // Fetches and fast-forwards local base onto its remote before anything below
  // reads from it — dispatch, `commitsToIntegrate`, and the next worktree all
  // have to see current state, not whatever the last session happened to leave
  // on disk. Failing closed on divergence here is the same fail-closed
  // contract the rest of this command already applies to the source branch.
  // Preview changes no Git state, fetch included, so this only runs on apply.
  const baseRemoteSync: BaseRemoteSync = options.apply
    ? syncBaseBranchWithRemote({ controlWorktree, baseBranch, baseWorktreePath: baseRecord?.path ?? null })
    : { attempted: false, remote: null, fastForwarded: false, reason: "Preview does not fetch or modify the base branch." };

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
  let session: AgentSession | null = null;
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

    let workspacePath: string | null = null;
    if (options.launch) {
      workspacePath = resolveReadyWorkspace(options.workspace).workspacePath;
      const transition = withDatabase(workspacePath, (db) => resolveProjectTransition({
        repoRoot: controlWorktree,
        projectSlug,
        db,
        tmux: options.tmux ?? systemTmux
      }));
      if (transition.kind !== "launch") {
        throw validationError("The Project transition does not authorize a new Session launch.", {
          transition: transition.kind,
          reason: transition.reason,
          nextAction: transition.nextAction
        });
      }
    }

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

    if (options.launch && workspacePath) {
      const prepared = withDatabase(workspacePath, (db) => prepareSession({
        db,
        workspace: workspacePath,
        repoRoot: controlWorktree,
        dispatch,
        agent: "claude",
        model,
        effort,
        baseRevision: git(controlWorktree, ["rev-parse", baseBranch]).trim(),
        branch: nextWorktree!.branch,
        worktreePath: nextWorktree!.path,
        now: options.now ?? new Date(),
        tmux: options.tmux
      }));
      session = withDatabase(workspacePath, (db) => launchPreparedSession(db, prepared, options.tmux));
    }
  }

  const transition = session && options.workspace
    ? withDatabase(resolveReadyWorkspace(options.workspace).workspacePath, (db) => resolveProjectTransition({
        repoRoot: controlWorktree,
        projectSlug,
        db,
        tmux: options.tmux ?? systemTmux
      }))
    : resolveProjectTransition({ repoRoot: controlWorktree, projectSlug });

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
      baseRemoteSync,
      integration,
      commitsToIntegrate,
      sourceWorktreeRemoved,
      sourceBranchDeleted,
      nextWorktree,
      dispatch,
      dispatchable: isDispatchable(dispatch),
      transition,
      session,
      handoff: {
        baseRef: baseBranch,
        prompt: "arcadia advance"
      },
      clutter: summarizeClutter(repo, baseBranch)
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

  if (data.baseRemoteSync.attempted) {
    lines.push(
      data.baseRemoteSync.fastForwarded
        ? `Base remote sync: fast-forwarded ${data.baseBranch} from ${data.baseRemoteSync.remote}.`
        : `Base remote sync: ${data.baseRemoteSync.reason}`
    );
  } else if (data.baseRemoteSync.reason) {
    lines.push(`Base remote sync: ${data.baseRemoteSync.reason}`);
  }

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
  if (data.session) {
    lines.push(
      `Session: ${data.session.id} (${data.session.status})`,
      `Reattach: tmux attach-session -t ${data.session.tmux_session_name}`
    );
  }

  if (data.clutter) {
    lines.push("", ...renderClutter(data.clutter));
  }

  return lines;
}

/**
 * The nudge that would have prevented weeks of silent accumulation.
 *
 * `go` runs at the boundary between sessions, which is both when clutter is
 * created and the only moment anyone is reliably looking. Stating the counts
 * here costs nothing and turns "nobody noticed for weeks" into "you were told
 * every time."
 */
function renderClutter(clutter: NonNullable<GoCommandData["clutter"]>): string[] {
  const { extraWorktrees, branches, obviouslyMerged } = clutter;
  if (extraWorktrees === 0 && obviouslyMerged === 0) {
    return [`Repository state: clean — no extra worktrees, ${branches} branch${branches === 1 ? "" : "es"}.`];
  }

  const parts: string[] = [];
  if (extraWorktrees > 0) parts.push(`${extraWorktrees} extra worktree${extraWorktrees === 1 ? "" : "s"}`);
  if (obviouslyMerged > 0) parts.push(`${obviouslyMerged} already-merged branch${obviouslyMerged === 1 ? "" : "es"}`);

  return [
    `Repository state: ${parts.join(" and ")} out of ${branches} branches.`,
    "  Run `arcadia tidy` to see what is safe to retire (it changes nothing without --apply)."
  ];
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

/**
 * Fetch the base branch's tracked remote and fast-forward the local base onto
 * it when that is a clean ancestor merge. Skips cleanly when no remote is
 * configured, and refuses (never silently proceeds) when local base has
 * diverged from the fetched remote ref in a way a fast-forward cannot resolve.
 */
function syncBaseBranchWithRemote(input: {
  controlWorktree: string;
  baseBranch: string;
  baseWorktreePath: string | null;
}): BaseRemoteSync {
  const { controlWorktree, baseBranch, baseWorktreePath } = input;
  const upstream = upstreamRef(controlWorktree, baseBranch);
  if (!upstream) {
    return { attempted: false, remote: null, fastForwarded: false, reason: "The base branch has no tracked remote configured." };
  }
  const remoteName = upstream.split("/")[0]!;
  git(controlWorktree, ["fetch", remoteName]);
  const remoteRef = `refs/remotes/${upstream}`;
  const baseHeadRef = `refs/heads/${baseBranch}`;
  if (!refExists(controlWorktree, remoteRef)) {
    return { attempted: true, remote: remoteName, fastForwarded: false, reason: "The fetch produced no remote-tracking ref for the base branch." };
  }
  if (isAncestor(controlWorktree, remoteRef, baseHeadRef)) {
    return { attempted: true, remote: remoteName, fastForwarded: false, reason: "Local base branch is already current with its remote." };
  }
  if (!isAncestor(controlWorktree, baseHeadRef, remoteRef)) {
    throw validationError("The local base branch has diverged from its remote; Arcadia go will not fast-forward through a rewrite.", {
      baseBranch,
      remote: upstream,
      remedy: "Reconcile the divergence manually (rebase or merge) before retrying."
    });
  }
  if (baseWorktreePath) {
    git(baseWorktreePath, ["merge", "--ff-only", remoteRef]);
  } else {
    git(controlWorktree, ["branch", "-f", baseBranch, remoteRef]);
  }
  return { attempted: true, remote: remoteName, fastForwarded: true, reason: null };
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
