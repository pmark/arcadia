import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import { existingDirectory } from "../git/worktrees.js";
import { systemTmux, type TmuxAdapter } from "../sessions/index.js";
import {
  applyRecoverySuccessorDisposition,
  previewRecoverySuccessorDisposition,
  type RecoverySuccessorDispositionPreview,
  type RecoverySuccessorDispositionResult
} from "../sessions/recoverySuccessorDisposition.js";

interface DispositionCommandOptions { workspace: string; repo: string; original: string; successor: string; tmux?: TmuxAdapter }

/** Read-only: `arcadia session preview-dispose-recovery`. */
export function runSessionPreviewDisposeRecoveryCommand(options: DispositionCommandOptions): CommandSuccess<RecoverySuccessorDispositionPreview> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repoRoot = existingDirectory(options.repo, "repository");
  const data = withReadOnlyDatabase(workspacePath, db => previewRecoverySuccessorDisposition({
    db, repoRoot, originalSessionId: options.original, successorSessionId: options.successor, tmux: options.tmux ?? systemTmux
  }));
  return createSuccess({ command: "session.previewDisposeRecovery", workspace: workspacePath, data });
}

/** Appends one disposition for the exact previewed fingerprint: `arcadia session dispose-recovery`. */
export function runSessionDisposeRecoveryCommand(options: DispositionCommandOptions & { fingerprint: string }): CommandSuccess<RecoverySuccessorDispositionResult> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repoRoot = existingDirectory(options.repo, "repository");
  const data = withDatabase(workspacePath, db => applyRecoverySuccessorDisposition({
    db, repoRoot, originalSessionId: options.original, successorSessionId: options.successor,
    fingerprint: options.fingerprint, tmux: options.tmux ?? systemTmux
  }));
  return createSuccess({ command: "session.disposeRecovery", workspace: workspacePath, data });
}

export function renderSessionPreviewDisposeRecoverySuccess(response: CommandSuccess<RecoverySuccessorDispositionPreview>): string[] {
  const data = response.data;
  const binding = data.binding;
  return [
    `Ready: ${data.ready ? "yes" : "no"}`,
    ...(data.fingerprint ? [`Disposition fingerprint: ${data.fingerprint}`] : []),
    ...(binding ? [
      `Original: ${binding.originalSessionId} · successor ${binding.successorSessionId} · consumed request ${binding.consumedRequestId}`,
      `Candidate: ${binding.candidate.worktreePath} @ ${binding.candidate.head ?? "(unreadable)"} · claim generation ${binding.claimGeneration ?? "(none)"}`,
      `Successor exit receipt: ${binding.falseReceipt ? `${binding.falseReceipt.id} (${binding.falseReceipt.outcome}, run ${binding.falseReceipt.runId ?? "none"})` : "none"}`
    ] : []),
    ...(data.disposition ? [`Already disposed: ${data.disposition.id} at ${data.disposition.created_at}`] : []),
    ...data.refusals.map(refusal => `Refused (${refusal.code}): ${refusal.reason}`)
  ];
}

export function renderSessionDisposeRecoverySuccess(response: CommandSuccess<RecoverySuccessorDispositionResult>): string[] {
  const { disposition, created } = response.data;
  return [
    `Disposition: ${disposition.id}${created ? "" : " (already recorded)"}`,
    `Successor ${disposition.successor_session_id} of ${disposition.original_session_id} is recorded as failed before provider start.`,
    "Nothing was launched, released or rewritten. Preview a fresh request with `arcadia session preview-launch --recover-session` before any separately approved launch."
  ];
}
