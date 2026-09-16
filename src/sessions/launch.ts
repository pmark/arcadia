import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { observeProviderCapacity, type ProviderCapacityObservation } from "../codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { writeTransaction } from "../db/connection.js";
import { isDispatchable, resolveDispatch } from "../docs/dispatch.js";
import { git, resolveBaseBranch, tryGit } from "../git/worktrees.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { commitAdmission, issueAdmission, releaseAdmission, type AdmissionReceipt } from "../production/policy.js";
import {
  failPreparedSession,
  getRepositoryLease,
  getSession,
  launchPreparedSession,
  prepareSession,
  reserveAgentWorktree,
  sessionAgentForProvider,
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
  /**
   * The current explicit one-Session launch grant: the fingerprint of the
   * preview the operator approved. Exactly one of `previewFingerprint` or
   * `standingPolicy` must be given.
   */
  previewFingerprint?: string;
  /**
   * Launch under a standing managed-production policy grant instead of a
   * fresh human click: admits against the Active policy's current epoch and
   * rechecks Off immediately before launch commitment. Exactly one of
   * `previewFingerprint` or `standingPolicy` must be given.
   */
  standingPolicy?: boolean;
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  /** Test-only override for where the new agent worktree is created. */
  agentWorktreeRoot?: string;
  /** Test-only override for the standing-policy provider capacity observation. */
  capacityObservation?: ProviderCapacityObservation;
  now?: Date;
  tmux?: TmuxAdapter;
  testHooks?: {
    /** Deterministic fault injection between worktree creation and reservation commit. */
    afterWorktreeCreatedBeforeReservationCommit?: () => void;
    /** Deterministic fault injection between admission issuance and its launch-time commit recheck. */
    afterAdmissionIssuedBeforeCommit?: () => void;
  };
}

export interface GuardedLaunchResult {
  /** True when an already-durable Session satisfied this request instead of a new one being created. */
  reused: boolean;
  session: AgentSession;
  preview: LaunchPreview;
  /** The epoch-bound admission this launch committed against, when launched under a standing policy grant. */
  admission: AdmissionReceipt | null;
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
  if (input.standingPolicy && input.previewFingerprint) {
    throw validationError(
      "A launch may not carry both an operator-approved preview fingerprint and a standing production policy grant."
    );
  }
  if (!input.standingPolicy && !input.previewFingerprint) {
    throw validationError(
      "A launch must carry either an operator-approved preview fingerprint or the standing production policy grant."
    );
  }

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
    return { reused: true, session: resumeOrReturn(input.db, existingLease, tmux), preview, admission: null };
  }

  if (!input.standingPolicy && preview.previewFingerprint !== input.previewFingerprint) {
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

  let admission: AdmissionReceipt | null = null;
  if (input.standingPolicy) {
    const provider = preview.selection.provider;
    const observation = input.capacityObservation ?? observeProviderCapacity(input.profiles, { now });
    const capacity = observation.providers.find((decision) => decision.providerId === provider);
    if (!capacity) {
      throw validationError(`No capacity observation is available for provider "${provider}".`, { conflict: true });
    }
    const issued = issueAdmission(input.db, {
      requestId: `${input.requestId}:admission`,
      actionKey: `${preview.projectSlug}/${preview.actionId}`,
      projectSlug: preview.projectSlug,
      planSlug: preview.planSlug ?? "",
      provider,
      capacity,
      now
    });
    if (!issued.admitted) {
      throw validationError(`The standing managed-production policy refused this launch: ${issued.reason}`, {
        code: issued.code,
        conflict: true
      });
    }
    admission = issued.receipt;
    input.testHooks?.afterAdmissionIssuedBeforeCommit?.();
  }

  const agent = sessionAgentForProvider(preview.selection.provider);
  if (!agent) {
    throw validationError(
      `No Session launch adapter is registered for provider "${preview.selection.provider}".`,
      { conflict: true }
    );
  }
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
      // The winner's Session satisfies this request; this call's own reserved
      // admission (if any) never committed to a launch and would otherwise
      // hold a concurrency slot until it expires. Release it immediately
      // rather than waiting out the TTL.
      if (admission) releaseAdmission(input.db, admission.requestId, now);
      return { reused: true, session: resumeOrReturn(input.db, raced, tmux), preview, admission: null };
    }
    throw error;
  }

  // The standing-policy cutoff: recheck Off (and the admitted epoch) as close
  // to process start as this call gets, inside the same admission's own
  // transactional commit. A refusal here means production went Inactive or
  // reactivated between issuing this admission and this exact moment — the
  // prepared Session and its worktree are abandoned unlaunched rather than
  // spawning a process no policy currently authorizes.
  if (admission) {
    const committed = commitAdmission(input.db, admission.requestId, now);
    if (!committed.admitted) {
      failPreparedSession(input.db, prepared.id);
      tryGit(repoRoot, ["worktree", "remove", nextWorktree.path]);
      tryGit(repoRoot, ["branch", "-D", nextWorktree.branch]);
      throw validationError(`The standing managed-production policy withdrew authorization before launch commitment: ${committed.reason}`, {
        code: committed.code,
        conflict: true
      });
    }
    admission = committed.receipt;
  }

  return { reused: false, session: launchPreparedSession(input.db, prepared, tmux), preview, admission };
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
