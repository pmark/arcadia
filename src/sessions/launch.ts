import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { writeTransaction } from "../db/connection.js";
import { isDispatchable, resolveDispatch } from "../docs/dispatch.js";
import { git, resolveBaseBranch, tryGit } from "../git/worktrees.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import {
  getRepositoryLease,
  getSession,
  launchPreparedSession,
  prepareSession,
  reserveAgentWorktree,
  systemTmux,
  type AgentSession,
  type TmuxAdapter
} from "./index.js";
import { buildLaunchPreview, type LaunchPreview } from "./launchPreview.js";
import { prepareAgentWorktree, type PreparedAgentWorktree } from "./worktreePreparation.js";

export interface GuardedLaunchInput {
  db: Database.Database;
  workspace: string;
  /** The canonical repository (the primary checkout), never the launched worktree. */
  repoRoot: string;
  projectSlug: string;
  requestId: string;
  /** The fingerprint of the preview the operator (or standing policy) approved. */
  previewFingerprint: string;
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  /** Test-only override for where the new agent worktree is created. */
  agentWorktreeRoot?: string;
  now?: Date;
  tmux?: TmuxAdapter;
  /** Deterministic fault injection between worktree creation and reservation commit. */
  testHooks?: { afterWorktreeCreatedBeforeReservationCommit?: () => void };
}

export interface GuardedLaunchResult {
  /** True when an already-durable Session satisfied this request instead of a new one being created. */
  reused: boolean;
  session: AgentSession;
  preview: LaunchPreview;
}

/**
 * The single entry point a guarded host launch operation (CLI or HTTP) must
 * call. It re-derives everything from disk and the database at call time —
 * never trusting a caller-supplied dispatch, packet hash, or selection — and
 * is safe to call more than once for the same intended launch: a second call
 * that targets the exact same previewed Action and packet reconciles onto the
 * first call's durable result (an in-flight "prepared" Session is resumed to
 * "running"; an already-"running" Session is returned as-is) instead of
 * starting a second process or erroring. A call that targets a different
 * Action while this repository already holds a lease is refused.
 */
export function launchGuardedHostSession(input: GuardedLaunchInput): GuardedLaunchResult {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.now ?? new Date();
  const tmux = input.tmux ?? systemTmux;

  const preview = buildLaunchPreview({
    db: input.db,
    workspace: input.workspace,
    repoRoot,
    projectSlug: input.projectSlug,
    requestId: input.requestId,
    profiles: input.profiles,
    adapters: input.adapters,
    tmux,
    now
  });

  // Reconcile onto an already-durable result first, before any staleness
  // check: a lost HTTP response or a second tab retrying the same approved
  // launch must recover the existing Session even though re-previewing now
  // reports its own lease as a "conflicting execution" prerequisite (which
  // would otherwise change the fingerprint and make a correct retry look
  // stale). This is the only path that may return a Session whose packet or
  // pointer are not this preview's freshly-recomputed "ready" state — because
  // it is not creating anything, only handing back what this exact request
  // already caused.
  const existingLease = getRepositoryLease(input.db, repoRoot);
  if (existingLease && matchesPreview(existingLease, preview)) {
    return { reused: true, session: resumeOrReturn(input.db, existingLease, tmux), preview };
  }

  if (preview.previewFingerprint !== input.previewFingerprint) {
    throw validationError("The launch preview is stale or was altered since it was approved; re-preview before launching.", {
      expectedFingerprint: input.previewFingerprint,
      currentFingerprint: preview.previewFingerprint,
      conflict: true
    });
  }

  if (existingLease) {
    throw validationError("The repository already has a prepared or running Session for a different Action.", {
      sessionId: existingLease.id,
      conflict: true
    });
  }

  if (!preview.ready || !preview.actionId || !preview.selection || !preview.packet) {
    throw validationError("The previewed Action is not ready to launch.", { prerequisites: preview.prerequisites, conflict: true });
  }

  const dispatch = resolveDispatch(repoRoot, input.projectSlug);
  if (!isDispatchable(dispatch) || dispatch.context?.action.id !== preview.actionId) {
    throw validationError("The governed pointer changed since the preview was built; re-preview before launching.", { conflict: true });
  }

  const agent = preview.selection.provider === "codex-cli" ? "codex" : "claude";
  const model = preview.selection.model;
  const effort = preview.selection.effort ?? null;
  const baseBranch = resolveBaseBranch(repoRoot);
  const baseRevision = git(repoRoot, ["rev-parse", baseBranch]).trim();

  const reservationCommitCleanup: { candidate: PreparedAgentWorktree | null } = { candidate: null };
  let nextWorktree: PreparedAgentWorktree;
  try {
    nextWorktree = writeTransaction(input.db, () => {
      const created = prepareAgentWorktree({
        agent,
        actionId: preview.actionId!,
        baseBranch,
        repositoryPath: repoRoot,
        rootOverride: input.agentWorktreeRoot,
        now,
        model,
        effort,
        beforeCreate(candidate) {
          reserveAgentWorktree(input.db, {
            repositoryPath: repoRoot,
            worktreePath: candidate.path,
            branch: candidate.branch,
            now
          });
        }
      });
      reservationCommitCleanup.candidate = created;
      input.testHooks?.afterWorktreeCreatedBeforeReservationCommit?.();
      return created;
    });
  } catch (error) {
    if (reservationCommitCleanup.candidate) {
      tryGit(repoRoot, ["worktree", "remove", reservationCommitCleanup.candidate.path]);
      tryGit(repoRoot, ["branch", "-D", reservationCommitCleanup.candidate.branch]);
    }
    throw error;
  }

  let prepared: AgentSession;
  try {
    prepared = prepareSession({
      db: input.db,
      workspace: input.workspace,
      repoRoot,
      dispatch,
      agent,
      model,
      effort,
      baseRevision,
      branch: nextWorktree.branch,
      worktreePath: nextWorktree.path,
      now,
      tmux
    });
  } catch (error) {
    // A concurrent caller may have won the repository lease between our
    // pre-check above and this insert (either by throwing here first, or via
    // the database's own unique lease index on a true race). Reconcile onto
    // the winner rather than leaving an orphaned worktree and a misleading
    // failure for a request that was, in substance, satisfied.
    tryGit(repoRoot, ["worktree", "remove", nextWorktree.path]);
    tryGit(repoRoot, ["branch", "-D", nextWorktree.branch]);
    const raced = getRepositoryLease(input.db, repoRoot);
    if (raced && matchesPreview(raced, preview)) {
      return { reused: true, session: resumeOrReturn(input.db, raced, tmux), preview };
    }
    throw error;
  }

  return { reused: false, session: launchPreparedSession(input.db, prepared, tmux), preview };
}

/** A "prepared" lease whose tmux Session was never actually started (a crash between insert and spawn) is resumed rather than left stuck. */
function resumeOrReturn(db: Database.Database, session: AgentSession, tmux: TmuxAdapter): AgentSession {
  if (session.status === "running" || tmux.hasSession(session.tmux_session_name)) {
    return getSession(db, session.id) ?? session;
  }
  return launchPreparedSession(db, session, tmux);
}

function matchesPreview(session: AgentSession, preview: LaunchPreview): boolean {
  return (
    session.project_slug === preview.projectSlug &&
    session.action_id === preview.actionId &&
    preview.packet !== null &&
    session.packet_sha256 === preview.packet.sha256
  );
}
