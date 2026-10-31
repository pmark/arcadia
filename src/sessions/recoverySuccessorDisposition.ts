import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { tryGit } from "../git/worktrees.js";
import { readProductionPolicySafely } from "../production/policy.js";
import { createId } from "../utils/id.js";
import { canonicalPath, getActiveActionClaim, getSession, type TmuxAdapter } from "./index.js";
import { getSessionExitReceipt } from "./reconciliation.js";
import { sessionLogPath } from "./sessionRecording.js";
import {
  getRecoverySuccessorDisposition,
  getRecoveryForSuccessor,
  undisposedLaterCandidateSessions,
  type RecoverySuccessorDispositionRecord
} from "./terminalClaimRecovery.js";
import { probeWorktreeLiveness } from "./worktreeLiveness.js";

/**
 * Issue #1920: an explicit recovery successor that failed before provider
 * start (for example after a worker tick wrote an exit receipt borrowed from
 * an unrelated Run) blocks every later `--recover-session` attempt. This is
 * the one supported, append-only disposition of that exact state. It writes a
 * single new row; it never rewrites a Session, receipt, attempt, claim,
 * request or candidate, and grants no launch.
 */
export type RecoverySuccessorDispositionRefusalCode =
  | "foreign_pair"
  | "original_not_terminal"
  | "successor_live"
  | "successor_started"
  | "successor_exited"
  | "successor_not_failed"
  | "successor_recording_present"
  | "candidate_reused"
  | "candidate_dirty"
  | "candidate_moved"
  | "candidate_process_live"
  | "claim_missing"
  | "production_active"
  | "production_unknown"
  | "already_disposed"
  | "stale_preview";

export interface RecoverySuccessorDispositionRefusal { code: RecoverySuccessorDispositionRefusalCode; reason: string }

export interface RecoverySuccessorDispositionBinding {
  originalSessionId: string;
  successorSessionId: string;
  repositoryPath: string;
  consumedRequestId: string;
  recoveryPreviewFingerprint: string;
  recoveryBindingSha256: string;
  falseReceipt: { id: string; requestId: string; runId: string | null; outcome: string; sha256: string } | null;
  candidate: { worktreePath: string; branch: string; head: string | null };
  claimGeneration: string | null;
  /** No recorded provider start: no start time, exit status, live terminal, candidate process or Session log. */
  noProviderStart: { status: string; startedAt: string | null; exitStatus: number | null; tmuxLive: boolean; candidateProcesses: number | null; sessionLogPresent: boolean };
}

export interface RecoverySuccessorDispositionPreview {
  ready: boolean;
  fingerprint: string | null;
  refusals: RecoverySuccessorDispositionRefusal[];
  binding: RecoverySuccessorDispositionBinding | null;
  /** Present when this successor already has its disposition; a replay returns it. */
  disposition: RecoverySuccessorDispositionRecord | null;
}

export interface RecoverySuccessorDispositionInput {
  db: Database.Database;
  repoRoot: string;
  originalSessionId: string;
  successorSessionId: string;
  /** The workspace whose `.arcadia/sessions` holds Session logs. */
  workspace: string;
  tmux: Pick<TmuxAdapter, "hasSession">;
  now?: Date;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Read-only. Reports every refusal and, when none, the exact fingerprint an apply must carry. */
export function previewRecoverySuccessorDisposition(input: RecoverySuccessorDispositionInput): RecoverySuccessorDispositionPreview {
  const now = input.now ?? new Date();
  const refusals: RecoverySuccessorDispositionRefusal[] = [];
  const refuse = (code: RecoverySuccessorDispositionRefusalCode, reason: string) => { refusals.push({ code, reason }); };
  const repositoryPath = canonicalPath(input.repoRoot);
  const disposition = getRecoverySuccessorDisposition(input.db, input.successorSessionId);

  const original = getSession(input.db, input.originalSessionId);
  const successor = getSession(input.db, input.successorSessionId);
  const recovery = getRecoveryForSuccessor(input.db, input.successorSessionId);
  if (!original || !successor || !recovery || recovery.original_session_id !== original.id || recovery.repository_path !== repositoryPath
    || original.repository_path !== repositoryPath || successor.repository_path !== repositoryPath
    || successor.project_slug !== original.project_slug || successor.action_id !== original.action_id
    || canonicalPath(successor.worktree_path) !== canonicalPath(original.worktree_path)) {
    refuse("foreign_pair", "The Sessions are not an explicit recovery's original and successor on this repository's same candidate.");
    return { ready: false, fingerprint: null, refusals, binding: null, disposition };
  }

  const policy = readProductionPolicySafely(input.db);
  if (policy.status !== "ok") refuse("production_unknown", `Production state is unavailable: ${policy.reason}`);
  else if (policy.policy.desiredState === "active") refuse("production_active", "Production is Active; dispose a recovery successor only while Production is Off.");

  const originalLive = input.tmux.hasSession(original.tmux_session_name);
  if (original.status !== "completed" || original.exit_status !== 0 || originalLive) {
    refuse("original_not_terminal", "The original Session must remain completed with exit 0 and no live terminal.");
  }

  const successorLive = input.tmux.hasSession(successor.tmux_session_name);
  if (successorLive || successor.status === "prepared" || successor.status === "running") {
    refuse("successor_live", "The successor is prepared, running or has a live terminal; it has not failed before start.");
  }
  if (successor.started_at) refuse("successor_started", "The successor records a provider start.");
  if (successor.exit_status !== null) refuse("successor_exited", "The successor records an exit status.");
  if (successor.status !== "failed") refuse("successor_not_failed", `The successor is ${successor.status}, not failed.`);
  // `started_at` is written only after tmux.launch returns, so a crash in that
  // window leaves it null. The recording wrapper tmux runs creates the
  // Session log before the provider starts; any log means a start may have
  // happened, so the absence of a recorded start is not enough.
  const successorLog = sessionLogPath(input.workspace, successor.id);
  const sessionLogPresent = existsSync(successorLog);
  if (sessionLogPresent) refuse("successor_recording_present", `The successor's Session log exists (${successorLog}); its provider may have started.`);

  const later = undisposedLaterCandidateSessions(input.db, original).filter(id => id !== successor.id);
  if (later.length) refuse("candidate_reused", `Another Session has used this candidate since: ${later.join(", ")}.`);

  const worktreePath = canonicalPath(original.worktree_path);
  const head = tryGit(original.worktree_path, ["rev-parse", "HEAD"])?.trim() ?? null;
  const branch = tryGit(original.worktree_path, ["symbolic-ref", "--short", "HEAD"])?.trim() ?? null;
  const status = tryGit(original.worktree_path, ["status", "--porcelain", "--untracked-files=all"]);
  if (!head || !original.launch_revision || head !== original.launch_revision || branch !== original.branch.replace(/^refs\/heads\//, "")) {
    refuse("candidate_moved", "The candidate HEAD or branch no longer equals the original's launch revision and branch.");
  }
  if (status === null || status.trim()) refuse("candidate_dirty", "The candidate worktree is dirty or unreadable.");
  const liveness = probeWorktreeLiveness(original.worktree_path, { requireCompleteScan: true });
  if (!liveness.ok || liveness.processes.length) refuse("candidate_process_live", "Candidate process liveness is active or uncertain.");

  const claim = getActiveActionClaim(input.db, input.repoRoot, original.project_slug, original.action_id, now);
  if (!claim?.claim_generation || canonicalPath(claim.worktree_path) !== worktreePath || claim.branch !== original.branch) {
    refuse("claim_missing", "The candidate no longer holds this Action's claim.");
  }

  const receipt = getSessionExitReceipt(input.db, successor.id);
  const binding: RecoverySuccessorDispositionBinding = {
    originalSessionId: original.id,
    successorSessionId: successor.id,
    repositoryPath,
    consumedRequestId: recovery.request_id,
    recoveryPreviewFingerprint: recovery.preview_fingerprint,
    recoveryBindingSha256: sha256(recovery.binding_json),
    falseReceipt: receipt && { id: receipt.id, requestId: receipt.request_id, runId: receipt.run_id, outcome: receipt.outcome, sha256: sha256(JSON.stringify(receipt)) },
    candidate: { worktreePath, branch: original.branch, head },
    claimGeneration: claim?.claim_generation ?? null,
    noProviderStart: {
      status: successor.status, startedAt: successor.started_at, exitStatus: successor.exit_status, tmuxLive: successorLive,
      candidateProcesses: liveness.ok ? liveness.processes.length : null, sessionLogPresent
    }
  };
  const fingerprint = sha256(JSON.stringify(binding));
  if (disposition && disposition.fingerprint !== fingerprint) {
    refuse("already_disposed", `This successor already has disposition ${disposition.id} under a different fingerprint.`);
  }
  return { ready: refusals.length === 0, fingerprint, refusals, binding, disposition };
}

export interface RecoverySuccessorDispositionResult { disposition: RecoverySuccessorDispositionRecord; created: boolean }

/** Appends exactly one disposition for the exact previewed fingerprint; a same-fingerprint repeat returns the same receipt. */
export function applyRecoverySuccessorDisposition(input: RecoverySuccessorDispositionInput & { fingerprint: string }): RecoverySuccessorDispositionResult {
  return writeTransaction(input.db, () => {
    const existing = getRecoverySuccessorDisposition(input.db, input.successorSessionId);
    if (existing) {
      if (existing.fingerprint === input.fingerprint && existing.original_session_id === input.originalSessionId
        && existing.repository_path === canonicalPath(input.repoRoot)) return { disposition: existing, created: false };
      throw validationError(`Recovery successor disposition refused: this successor already has disposition ${existing.id}.`, {
        code: "already_disposed", dispositionId: existing.id
      });
    }
    const preview = previewRecoverySuccessorDisposition(input);
    const refusal = preview.refusals[0];
    if (refusal) {
      throw validationError(`Recovery successor disposition refused: ${refusal.reason}`, { code: refusal.code, refusals: preview.refusals });
    }
    if (preview.fingerprint !== input.fingerprint) {
      throw validationError("Recovery successor disposition refused: the bound facts (candidate, claim generation, receipt or Session state) changed since the preview; preview again.", {
        code: "stale_preview", fingerprint: preview.fingerprint
      });
    }
    const binding = preview.binding!;
    const row: RecoverySuccessorDispositionRecord = {
      id: createId("recoverySuccessorDisposition"),
      successor_session_id: binding.successorSessionId,
      original_session_id: binding.originalSessionId,
      repository_path: binding.repositoryPath,
      consumed_request_id: binding.consumedRequestId,
      false_receipt_id: binding.falseReceipt?.id ?? null,
      candidate_head: binding.candidate.head!,
      claim_generation: binding.claimGeneration!,
      fingerprint: preview.fingerprint,
      binding_json: JSON.stringify(binding),
      created_at: (input.now ?? new Date()).toISOString()
    };
    input.db.prepare(`INSERT INTO terminal_claim_recovery_dispositions
      (id, successor_session_id, original_session_id, repository_path, consumed_request_id, false_receipt_id,
       candidate_head, claim_generation, fingerprint, binding_json, created_at)
      VALUES (@id, @successor_session_id, @original_session_id, @repository_path, @consumed_request_id, @false_receipt_id,
       @candidate_head, @claim_generation, @fingerprint, @binding_json, @created_at)`).run(row);
    return { disposition: row, created: true };
  });
}
