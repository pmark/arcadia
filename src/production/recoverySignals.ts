/**
 * Pure, no-model classification of recovery signals from ledger rows
 * (Decision 0169). The caller gathers rows from the ledger; this module reads
 * no database, Git, clock or network and never mutates its input.
 *
 * Signals:
 * - `no_progress`: a Session exited without finishing and its candidate
 *   revision equals the revision it was launched from, so the relaunch changed
 *   nothing.
 * - `qa_plan`: a failed independent QA review whose failed checks include the
 *   host-written operator QA plan check. `failureClass` is `sole_failure` when
 *   that is the only failed check and `mixed` when other checks failed too.
 *
 * An operator-held mark for the Action (a gated wait) at or before a signal
 * suppresses it: the operator owns that wait. Signals come back ordered by
 * time, then by input order.
 */

export const OPERATOR_QA_PLAN_CRITERION = "operator-qa-plan";

/** Session exit outcomes that finish a Session; every other outcome is unfinished. */
const FINISHED_OUTCOMES: ReadonlySet<string> = new Set(["accepted_completion", "successful_exit"]);

export interface RecoverySessionExitRow {
  sessionId: string;
  actionKey: string;
  outcome: string;
  launchRevision: string | null;
  candidateRevision: string | null;
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

function isFailed(check: RecoveryFailedCheck): boolean {
  return check.status === "fail";
}

/** Classify ledger rows into ordered recovery signals. */
export function classifyRecoverySignals(rows: RecoveryLedgerRows): RecoverySignal[] {
  const held = rows.operatorHeldMarks ?? [];
  const isHeld = (actionKey: string, at: string): boolean =>
    held.some((mark) => mark.actionKey === actionKey && epoch(mark.at) <= epoch(at));

  const signals: RecoverySignal[] = [];

  for (const exit of rows.sessionExits ?? []) {
    if (FINISHED_OUTCOMES.has(exit.outcome)) continue;
    if (!exit.launchRevision || !exit.candidateRevision) continue;
    if (exit.launchRevision !== exit.candidateRevision) continue;
    if (isHeld(exit.actionKey, exit.at)) continue;
    signals.push({ kind: "no_progress", actionKey: exit.actionKey, at: exit.at, source: exit.sessionId });
  }

  for (const repair of rows.reviewRepairs ?? []) {
    if (repair.role !== "qa") continue;
    const failed = repair.failedChecks.filter(isFailed);
    if (!failed.some((check) => check.criterion === OPERATOR_QA_PLAN_CRITERION)) continue;
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
