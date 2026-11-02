/**
 * Pure, no-model classification of recovery signals from ledger rows
 * (Decision 0169). The caller gathers rows from the ledger; this module reads
 * no database, Git, clock or network and never mutates its input.
 *
 * Signals:
 * - `no_progress`: a resumed Session exited `incomplete_resumable` with its
 *   candidate equal to the revision it started from (`launch_revision`, else
 *   `base_revision`) and a clean worktree: the same predicate as the worker
 *   tick's unchanged-candidate check (`isNoProgressExit`).
 * - `qa_plan`: a failed independent QA review whose failed checks include the
 *   host-written operator QA plan check. `failureClass` is `sole_failure` when
 *   every non-pass check (fail, inherited, not-applicable, not-checked) is the
 *   QA plan check and `mixed` when any other check is not a pass.
 *
 * An operator-held mark for the Action (a gated wait) at or before a signal
 * suppresses it: the operator owns that wait. Signals come back ordered by
 * time, then by input order.
 */

export const OPERATOR_QA_PLAN_CRITERION = "operator-qa-plan";

export interface RecoverySessionExitRow {
  sessionId: string;
  actionKey: string;
  outcome: string;
  /** True when the Session continued a prior Session's handoff (`getSessionContinuation` is non-null). */
  resumed: boolean;
  baseRevision: string | null;
  launchRevision: string | null;
  candidateRevision: string | null;
  /** Worktree had no uncommitted changes at exit. Absent when not recorded; explicit `false` yields no no-progress signal. */
  worktreeClean?: boolean;
  at: string;
}

export interface RecoveryFailedCheck {
  criterion: string;
  name?: string;
  status: string;
  evidence?: string;
}

export interface RecoveryReviewRepairRow {
  requestId: string;
  actionKey: string;
  round: number;
  role: string;
  verdict: string;
  failedChecks: readonly RecoveryFailedCheck[];
  outcome: string;
  at: string;
}

export interface RecoveryHeldMark {
  actionKey: string;
  kind: string;
  reason?: string;
  at: string;
  /** The mark stops suppressing at or after this time (e.g. a released row's `closed_at`). */
  releasedAt?: string;
}

export interface RecoveryLedgerRows {
  sessionExits?: readonly RecoverySessionExitRow[];
  reviewRepairs?: readonly RecoveryReviewRepairRow[];
  operatorHeldMarks?: readonly RecoveryHeldMark[];
}

export type RecoverySignalKind = "no_progress" | "qa_plan";
export type QaPlanFailureClass = "sole_failure" | "mixed";

export interface RecoverySignal {
  kind: RecoverySignalKind;
  actionKey: string;
  /** Timestamp of the receipt or row that raised the signal. */
  at: string;
  /** Session exit session id, or the review repair request id. */
  source: string;
  /** Present for `qa_plan` signals only. */
  failureClass?: QaPlanFailureClass;
}

function epoch(at: string): number {
  const value = Date.parse(at);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/** Mirrors the worker tick's unchanged-candidate check (src/production/tick.ts), minus Git: `worktreeClean` is supplied. */
export function isNoProgressExit(exit: RecoverySessionExitRow): boolean {
  if (!exit.resumed || exit.outcome !== "incomplete_resumable") return false;
  if (exit.worktreeClean === false) return false;
  const start = exit.launchRevision ?? exit.baseRevision;
  return exit.candidateRevision != null && start != null && exit.candidateRevision === start;
}

/** Classify ledger rows into ordered recovery signals. */
export function classifyRecoverySignals(rows: RecoveryLedgerRows): RecoverySignal[] {
  const held = rows.operatorHeldMarks ?? [];
  const isHeld = (actionKey: string, at: string): boolean =>
    held.some((mark) => mark.actionKey === actionKey && epoch(mark.at) <= epoch(at)
      && (mark.releasedAt === undefined || epoch(at) < epoch(mark.releasedAt)));

  const signals: RecoverySignal[] = [];

  for (const exit of rows.sessionExits ?? []) {
    if (!isNoProgressExit(exit)) continue;
    if (isHeld(exit.actionKey, exit.at)) continue;
    signals.push({ kind: "no_progress", actionKey: exit.actionKey, at: exit.at, source: exit.sessionId });
  }

  for (const repair of rows.reviewRepairs ?? []) {
    if (repair.role !== "qa") continue;
    const failed = repair.failedChecks.filter((check) => check.status !== "pass");
    if (!repair.failedChecks.some((check) => check.criterion === OPERATOR_QA_PLAN_CRITERION && check.status === "fail")) continue;
    if (isHeld(repair.actionKey, repair.at)) continue;
    const sole = failed.every((check) => check.criterion === OPERATOR_QA_PLAN_CRITERION);
    signals.push({
      kind: "qa_plan",
      actionKey: repair.actionKey,
      at: repair.at,
      source: repair.requestId,
      failureClass: sole ? "sole_failure" : "mixed"
    });
  }

  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => epoch(a.signal.at) - epoch(b.signal.at) || a.index - b.index)
    .map(({ signal }) => signal);
}
