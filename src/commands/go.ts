import { existsSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase, writeTransaction } from "../db/connection.js";
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
  isPatchEquivalent,
  listWorktrees,
  parseWorktrees,
  refExists,
  resolveBaseBranch,
  samePath,
  summarizeClutter,
  tryGit,
  uncommittedChanges,
  upstreamRef,
  type ClutterSummary
} from "../git/worktrees.js";
import {
  getRepositoryLease,
  launchPreparedSession,
  prepareSession,
  reserveAgentWorktree,
  resolveProjectTransition,
  systemTmux,
  type AgentSession,
  type ProjectTransition,
  type TmuxAdapter
} from "../sessions/index.js";

import { recoverLegacyAgentAskDrift, type AskRecoveryTestHooks, type LegacyAskRecovery } from "../sessions/legacyAskRecovery.js";
import { getResumableLeaseHandoff } from "../sessions/reconciliation.js";
import { buildAgentLaunchCommand, isPlausibleClaudeModel, prepareAgentWorktree, type PreparedAgentWorktree } from "../sessions/worktreePreparation.js";
import { bindManualPreservation } from "../sessions/manualPreservation.js";
import { readPreservationReadiness, type PreservationReadiness } from "../sessions/preservationReadiness.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { resolveWorkspace } from "../workspace/resolve.js";

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
  /** Deterministic fault injection after Git creation but before reservation commit. */
  testHooks?: {
    afterWorktreeCreatedBeforeReservationCommit?: () => void;
    /** Deterministic fault injection inside the Agent Ask drift recovery it runs before the clean check. */
    askRecovery?: AskRecoveryTestHooks;
  };
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
  preservation?: PreservationReadiness;
  projectSlug: string;
  repositoryPath: string;
  sourceWorktree: string;
  sourceBranch: string;
  baseBranch: string;
  baseWorktree: string | null;
  baseRemoteSync: BaseRemoteSync;
  integration: "not-needed" | "fast-forward" | "already-integrated";
  commitsToIntegrate: number;
  sourceWorktreeRemoved: boolean;
  sourceBranchDeleted: boolean;
  nextWorktree: PreparedAgentWorktree | null;
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
  /** Legacy root `agent-ask.yaml` drift recovered into an isolated Ask branch before the clean check, if any. */
  askRecoveries: LegacyAskRecovery[];
}

export function runGoCommand(options: GoCommandOptions): CommandSuccess<GoCommandData> {
  if (options.launch && (!options.apply || !options.agent)) {
    throw validationError("--launch requires --apply and an explicit Session adapter; it is the only authority to start a process.");
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

  const askRecoveries: LegacyAskRecovery[] = [];
  const sourceAskRecovery = recoverLegacyAgentAskDrift(repo, sourceRecord.path, options.testHooks?.askRecovery);
  if (sourceAskRecovery.recovered) askRecoveries.push(sourceAskRecovery);
  assertClean(sourceRecord.path, "source worktree");
  if (baseRecord && !samePath(baseRecord.path, sourceRecord.path)) {
    const baseAskRecovery = recoverLegacyAgentAskDrift(repo, baseRecord.path, options.testHooks?.askRecovery);
    if (baseAskRecovery.recovered) askRecoveries.push(baseAskRecovery);
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
  const integration = reconciliationKind(sourceRecord.path, baseBranch, sourceBranch);
  const commitsToIntegrate = countCommits(sourceRecord.path, baseBranch, sourceBranch);

  if (integration !== "not-needed") {
    if (!SAFE_TASK_BRANCH.test(sourceBranch)) {
      throw validationError("Arcadia go only removes clearly agent-owned task branches.", {
        sourceBranch,
        allowedPrefixes: ["codex/", "claude/", "agent/", "worktree-"],
        remedy: "Integrate and retire this branch manually, or rename it to an agent-owned task branch after review."
      });
    }
    if (integration === null) {
      throw validationError("The source branch cannot fast-forward the local base branch.", {
        sourceBranch,
        baseBranch,
        remedy: "Reconcile the divergent histories manually in a separate integration worktree."
      });
    }
  }

  const projectRoot = integration === "already-integrated" ? (baseRecord?.path ?? sourceRecord.path) : sourceRecord.path;
  const projectSlug = resolveProjectSlug(projectRoot);
  const sourceDispatch = resolveDispatch(projectRoot, projectSlug);
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
  if (options.apply && integration !== "not-needed" && integration !== null) {
    if (integration === "fast-forward") {
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
    }

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
    deleteVerifiedSafeSourceBranch(controlWorktree, baseBranch, sourceBranch, sourceRecord.head);
    sourceBranchDeleted = true;
    git(controlWorktree, ["worktree", "prune"]);
  }

  if (options.apply && options.agent) {
    const actionId = dispatch.context?.action.id;
    if (!actionId) {
      throw validationError("Arcadia go cannot name the next agent worktree without a resolved Action.");
    }

    const planModel = dispatch.context?.planRecommendedModel ?? null;
    const model = options.model ?? planModel;
    if (!model) {
      throw validationError(
        "No model is resolved for the next agent session, and Arcadia go will not launch one unpinned.",
        {
          planPath: dispatch.context?.planPath ?? null,
          gitReconciliationAlreadyApplied: integration === "fast-forward" || integration === "already-integrated",
          note:
            integration === "fast-forward" || integration === "already-integrated"
              ? "The source was already integrated into the base branch and its worktree/branch retired " +
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
    // `recommended_model` is free-form, provider-agnostic text (a plan may
    // have been written with Codex in mind), so when Arcadia picks it
    // automatically for a Claude handoff — no explicit --model given — make
    // sure it at least looks like a Claude model before it reaches
    // `claude --model` unvalidated. An explicit --model is trusted as-is.
    if (!options.model && options.agent === "claude" && !isPlausibleClaudeModel(model)) {
      throw validationError(
        "The plan's recommended_model does not look like a Claude Code model, and Arcadia will not hand it to " +
          "`claude --model` unvalidated.",
        {
          planPath: dispatch.context?.planPath ?? null,
          planRecommendedModel: model,
          remedy:
            "Pass --model explicitly with a Claude Code model (e.g. claude-sonnet-5, or the sonnet/opus/haiku/fable " +
            "aliases), or fix the plan's recommended_model for a Claude handoff — it currently names a model built " +
            "for a different agent."
        }
      );
    }
    const effort = options.effort ?? dispatch.context?.planRecommendedReasoningEffort ?? null;

    const workspacePath = resolveReadyWorkspace(options.workspace).workspacePath;
    const tmux = options.tmux ?? systemTmux;
    if (options.launch && workspacePath) {
      const transition = withDatabase(workspacePath, (db) => resolveProjectTransition({
        repoRoot: controlWorktree,
        projectSlug,
        db,
        tmux
      }));
      if (transition.kind !== "launch") {
        throw validationError("The Project transition does not authorize a new Session launch.", {
          transition: transition.kind,
          reason: transition.reason,
          nextAction: transition.nextAction
        });
      }
    }

    const now = options.now ?? new Date();
    // The conflict check and whatever it decides to do about it (resume's
    // reservation refresh, or a fresh worktree's creation+reservation) must
    // run inside one atomic transaction, not two separate `withDatabase`
    // calls -- otherwise two concurrent `go --apply --agent` invocations for
    // the same repository could both read "clear" before either commits, and
    // both prepare their own worktree, reproducing the exact duplicate this
    // Action exists to prevent (the same race `prepareSession` guards against
    // for its own lease/handoff checks; see its comment). `writeTransaction`
    // takes the write lock at `BEGIN IMMEDIATE`, so a second caller's
    // evaluation blocks until the first caller's write has committed.
    const reservationCommitCleanup: { candidate: GoCommandData["nextWorktree"] } = { candidate: null };
    try {
      nextWorktree = withDatabase(workspacePath, (db) => writeTransaction(db, () => {
        const candidate = evaluateExistingCandidate(db, { controlWorktree, actionId, agent: options.agent!, tmux });
        if (candidate.kind === "refuse") {
          throw validationError(candidate.reason!, candidate.details);
        }

        if (candidate.kind === "resume") {
          // Per Decision 0051: the same governed Action still owns this
          // candidate and its prior Session is proven terminal (reconciled,
          // not merely exited), so resume it in place -- same worktree and
          // branch, repository lease handed over -- rather than preparing a
          // second one. No Git write happens here beyond refreshing the
          // handoff reservation so `tidy` does not retire it out from under
          // the resumed Session before it is used.
          reserveAgentWorktree(db, { repositoryPath: controlWorktree, worktreePath: candidate.path!, branch: candidate.branch!, now });
          return {
            agent: options.agent!,
            path: candidate.path!,
            branch: candidate.branch!,
            model,
            effort,
            command: buildAgentLaunchCommand(options.agent!, candidate.path!, model, effort)
          };
        }

        const created = prepareAgentWorktree({
          agent: options.agent!,
          actionId,
          baseBranch,
          repositoryPath: controlWorktree,
          rootOverride: options.agentWorktreeRoot,
          now,
          model,
          effort,
          beforeCreate(prepared) {
            reserveAgentWorktree(db, {
              repositoryPath: controlWorktree,
              worktreePath: prepared.path,
              branch: prepared.branch,
              now
            });
          }
        });
        reservationCommitCleanup.candidate = created;
        options.testHooks?.afterWorktreeCreatedBeforeReservationCommit?.();
        return created;
      }));
    } catch (error) {
      // If SQLite cannot commit after Git created the worktree, do not leave a
      // clean, unreserved handoff that unattended tidy could immediately
      // retire. This worktree was created by this failed call and cannot yet
      // contain agent changes, so compensating removal is lossless.
      if (reservationCommitCleanup.candidate) {
        tryGit(controlWorktree, ["worktree", "remove", reservationCommitCleanup.candidate.path]);
        tryGit(controlWorktree, ["branch", "-D", reservationCommitCleanup.candidate.branch]);
      }
      throw error;
    }

    if (options.launch && workspacePath) {
      const prepared = withDatabase(workspacePath, (db) => prepareSession({
        db,
        workspace: workspacePath,
        repoRoot: controlWorktree,
        dispatch,
        // The launch guard above requires an explicit adapter before this path.
        agent: options.agent!,
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

  let preservation: PreservationReadiness | undefined;
  if (nextWorktree && !options.launch) {
    const workspacePath = resolveReadyWorkspace(options.workspace).workspacePath;
    preservation = withDatabase(workspacePath, db => {
      try {
        bindManualPreservation(db, { repository: controlWorktree, worktree: nextWorktree!.path, baseBranch, projectSlug });
      } catch (error) {
        const readiness = readPreservationReadiness(db, { workspace: workspacePath, repository: controlWorktree, worktree: nextWorktree!.path, projectSlug });
        readiness.blockers.unshift({ code: "manual_binding_failed", reason: error instanceof Error ? error.message : String(error) });
        return { ...readiness, ready: false };
      }
      return readPreservationReadiness(db, { workspace: workspacePath, repository: controlWorktree, worktree: nextWorktree!.path, projectSlug });
    });
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
      ...(preservation ? { preservation } : {}),
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
      clutter: summarizeClutter(repo, baseBranch, [
        ...protectedWorktreePaths(controlWorktree, options.workspace, options.tmux ?? systemTmux),
        ...(nextWorktree ? [nextWorktree.path] : [])
      ]),
      askRecoveries
    }
  });
}

/**
 * Worktrees this nudge should not nag about: one this very call just prepared
 * (added separately by the caller, since that path is not on disk yet when
 * `git worktree list` would need to see it) and any worktree currently backing
 * a genuinely *live* Session -- active work, not clutter.
 *
 * Deliberately narrower than `tidy`'s own `getWorktreeProtection`, which also
 * shields anything with an unexpired 24h handoff reservation so it never
 * destroys a manual handoff nobody has touched yet. Reusing that same
 * blanket rule here hid real accumulation: two abandoned agent worktrees each
 * carrying their own still-unexpired reservation shielded each other,
 * reporting `extraWorktrees: 0` while both sat there uncounted. This nudge's
 * job is to notice that, not to protect it -- `tidy` still refuses to retire
 * a reservation-protected worktree even though this count no longer excludes
 * it.
 *
 * Best-effort on purpose. This feeds a nudge, not a decision: a missing
 * workspace, an uninitialized database, or a schema without the session
 * table must never fail `go`. Returning nothing only costs the nudge some
 * precision, which is the same precision it had before this existed.
 */
function protectedWorktreePaths(repo: string, workspace: string | undefined, tmux: Pick<TmuxAdapter, "hasSession">): string[] {
  try {
    const workspacePath = resolveWorkspace({ workspace, cwd: repo }).workspacePath;
    if (!workspacePath || !existsSync(getWorkspacePaths(workspacePath).databaseFile)) return [];
    return withReadOnlyDatabase(workspacePath, (db) => {
      const lease = getRepositoryLease(db, repo);
      if (!lease || !tmux.hasSession(lease.tmux_session_name)) return [];
      return listWorktrees(repo)
        .filter((record) => samePath(record.path, lease.worktree_path))
        .map((record) => record.path);
    });
  } catch {
    return [];
  }
}

interface CandidateEvaluation {
  kind: "clear" | "resume" | "refuse";
  path?: string;
  branch?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Decide whether `go` may prepare a brand new worktree for `actionId`, per
 * Decision 0051: at most one live execution per candidate, and a sequential
 * Session for the same Action reuses its predecessor's candidate once that
 * predecessor's exit is *proven* terminal -- reconciled, not merely absent
 * from `tmux`. Every other case (a different Action's unresolved candidate, a
 * still-live Session, a dead-but-unreconciled Session, or an uncommitted
 * worktree Arcadia never launched and so cannot prove terminal at all) refuses
 * with the exact path and the operator's explicit choices, and creates
 * nothing.
 */
function evaluateExistingCandidate(
  db: Database.Database,
  input: { controlWorktree: string; actionId: string; agent: "codex" | "claude"; tmux: Pick<TmuxAdapter, "hasSession"> }
): CandidateEvaluation {
  const handoff = getResumableLeaseHandoff(db, input.controlWorktree);
  if (handoff) {
    if (input.tmux.hasSession(handoff.session.tmux_session_name)) {
      return {
        kind: "refuse",
        reason: "A prior Session for this repository is still live; Arcadia go will not prepare a second worktree while it runs.",
        details: {
          sessionId: handoff.session.id,
          worktreePath: handoff.session.worktree_path,
          tmuxSessionName: handoff.session.tmux_session_name,
          remedy: `Wait for it, or attach it directly: tmux attach-session -t ${handoff.session.tmux_session_name}.`
        }
      };
    }
    if (!existsSync(handoff.session.worktree_path)) {
      // The resumable candidate's worktree is gone -- removed outside
      // Arcadia (per this function's own "discard it" remedy below), or
      // never existed on this host. There is nothing left to resume or to
      // refuse over, whichever Action it named: checked before the
      // different-Action refusal so that discarding a stale candidate exactly
      // as instructed actually clears the block, instead of leaving `go`
      // refusing every Action forever over a worktree that no longer exists.
      return { kind: "clear" };
    }
    if (handoff.session.action_id !== input.actionId) {
      return {
        kind: "refuse",
        reason: "The repository holds an unresolved resumable candidate for a different Action; Arcadia go will not prepare a new worktree until it is resolved.",
        details: {
          existingActionId: handoff.session.action_id,
          currentActionId: input.actionId,
          worktreePath: handoff.session.worktree_path,
          remedy: "Preserve the existing candidate (finish or hand it off) or discard it (remove its worktree and branch) before starting a different Action."
        }
      };
    }
    return { kind: "resume", path: handoff.session.worktree_path, branch: handoff.session.branch.replace(/^refs\/heads\//, "") };
  }

  const liveLease = getRepositoryLease(db, input.controlWorktree);
  if (liveLease) {
    const stillLive = input.tmux.hasSession(liveLease.tmux_session_name);
    return {
      kind: "refuse",
      reason: stillLive
        ? "A Session is already live for this repository; Arcadia go will not prepare a second worktree while it runs."
        : "A Session's process has exited but was never reconciled; Arcadia go will not prepare a new worktree over an unproven exit.",
      details: {
        sessionId: liveLease.id,
        worktreePath: liveLease.worktree_path,
        actionId: liveLease.action_id,
        remedy: stillLive
          ? `Wait for it, or attach it directly: tmux attach-session -t ${liveLease.tmux_session_name}.`
          : `Reconcile it first: arcadia session reconcile ${liveLease.id} --request-id <unique-id>.`
      }
    };
  }

  // No DB-tracked Session or handoff owns a matching worktree. A worktree
  // prepared through a manual (never `--launch`ed) handoff leaves no tmux
  // name or session row behind, so Arcadia has no way to prove whether a
  // human terminal is still using it -- it is always reported, never
  // silently duplicated or auto-resumed.
  const orphan = findUncommittedManualCandidate(input.controlWorktree, input.actionId, input.agent);
  if (orphan) {
    return {
      kind: "refuse",
      reason: "A prepared worktree for this Action already holds uncommitted changes; Arcadia go will not prepare a second one.",
      details: {
        worktreePath: orphan.path,
        branch: orphan.branch,
        remedy: "This worktree was never launched through Arcadia, so its exit cannot be proven terminal. Preserve it (commit and push its work, or resume it by hand) or discard it (remove the worktree and branch) before retrying."
      }
    };
  }

  return { kind: "clear" };
}

/**
 * A worktree `prepareAgentWorktree` made for this exact Action and agent, still
 * on disk, still holding uncommitted changes, with no corresponding
 * `agent_sessions` row at all -- the manual-handoff case `evaluateExistingCandidate`
 * cannot otherwise see, matched the same way `prepareAgentWorktree` names one:
 * `<agent>/<slugified-action-id>-<timestamp>`.
 */
function findUncommittedManualCandidate(
  repositoryPath: string,
  actionId: string,
  agent: "codex" | "claude"
): { path: string; branch: string } | null {
  const listing = tryGit(repositoryPath, ["worktree", "list", "--porcelain"]);
  if (listing === null) return null;
  const safeAction = actionId.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 72);
  const prefix = `refs/heads/${agent}/${safeAction}-`;
  for (const record of parseWorktrees(listing)) {
    if (!record.branch?.startsWith(prefix)) continue;
    if (!existsSync(record.path)) continue;
    if (uncommittedChanges(record.path).length === 0) continue;
    return { path: record.path, branch: record.branch.replace(/^refs\/heads\//, "") };
  }
  return null;
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
  } else if (data.integration === "already-integrated") {
    lines.push(
      "",
      `${data.sourceBranch} was already integrated into ${data.baseBranch}; the base branch was left unchanged.`,
      "Removed the clean source worktree and deleted the verified-safe local task branch."
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
  if (data.preservation) {
    lines.push(`Preservation: ${data.preservation.ready ? "ready (local manual candidate)" : "needs configuration or repair"}`);
    lines.push(...data.preservation.blockers.map(b => `  ${b.code}: ${b.reason}`));
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

  if (data.askRecoveries.length > 0) {
    lines.push("", "Recovered drifted Agent Ask input:");
    for (const recovery of data.askRecoveries) {
      lines.push(`  ${recovery.askFile} on ${recovery.branch}${recovery.requestId ? ` (request_id: ${recovery.requestId})` : ""}`);
    }
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


type ReconciliationKind = GoCommandData["integration"] | null;

/**
 * Classify a completed task branch without changing either branch. A source
 * already reachable from the base, or whose every patch is already on the
 * base, has nothing left to integrate and may only be retired after the same
 * proof is repeated immediately before local-ref deletion.
 */
function reconciliationKind(cwd: string, baseBranch: string, sourceBranch: string): ReconciliationKind {
  if (sourceBranch === baseBranch) return "not-needed";
  if (isAncestor(cwd, sourceBranch, baseBranch) || isPatchEquivalent(cwd, baseBranch, sourceBranch)) {
    return "already-integrated";
  }
  if (isAncestor(cwd, baseBranch, sourceBranch)) return "fast-forward";
  return null;
}

/**
 * `git branch -d` compares a branch with its configured upstream when one
 * exists. That makes a stale `origin/<task>` ref veto deletion even after the
 * branch was locally proven integrated into the base. Delete the local ref
 * directly instead, but only when its exact head is still the verified head
 * and the proof still holds. This never reads or writes a remote ref.
 */
function deleteVerifiedSafeSourceBranch(cwd: string, baseBranch: string, sourceBranch: string, expectedHead: string): void {
  if (reconciliationKind(cwd, baseBranch, sourceBranch) !== "already-integrated") {
    throw validationError("The source branch changed before cleanup; Arcadia go will not delete it.", {
      sourceBranch,
      baseBranch,
      remedy: "Inspect and reconcile the changed branch manually before retrying cleanup."
    });
  }
  git(cwd, ["update-ref", "-d", `refs/heads/${sourceBranch}`, expectedHead]);
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
