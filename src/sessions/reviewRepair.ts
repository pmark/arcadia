import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";

/**
 * The durable record of the production worker's review repair loop
 * (src/production/reviewRepair.ts): one row per failed candidate head, so a
 * restart never launches a second repair for the same failure and the round
 * count per Action survives it.
 *
 * A repair Session is a new Session for the same Action on a NEW branch cut
 * from the failed candidate's work before its completion settlement. Its
 * Session id is bound to the row in the same transaction that inserts the
 * Session and supersedes the failed candidate's accepted exit, and released
 * again if that Session is abandoned before it starts, so the row, the
 * supersession and the Session can never disagree.
 */

/** Repair rounds per Action per production run (epoch): Decision 0098's bound, applied to the worker. */
export const MAX_REVIEW_REPAIR_ROUNDS = 3;

export interface ReviewRepairFinding {
  severity: string;
  title: string;
  evidence: string;
  recommendation: string;
}

export interface ReviewRepairCheck {
  name: string;
  status: string;
  evidence: string;
}

/** `released`: decided but never launched because its failed verdict stopped standing. */
export type ReviewRepairOutcome = "pending" | "launched" | "escalated" | "gated" | "released";

export interface ReviewRepairRow {
  request_id: string;
  action_key: string;
  policy_epoch: number;
  round: number;
  failed_session_id: string;
  failed_branch: string;
  failed_head: string;
  start_revision: string;
  pull_request_url: string | null;
  role: string;
  verdict: string;
  summary: string;
  report_path: string | null;
  findings_json: string;
  failed_checks_json: string;
  repair_session_id: string | null;
  outcome: ReviewRepairOutcome;
  reason: string | null;
  last_error: string | null;
  /** When the worker returned the failed PR to draft (once per failed head). */
  drafted_at: string | null;
  /** When the worker posted its one verdict comment on the failed PR (once per failed head). */
  commented_at: string | null;
  /** When the worker closed this failed PR as superseded by its repair's PR. */
  closed_at: string | null;
  /** Consecutive failures returning the PR to draft or commenting; past the bound the loop stops for the operator. */
  notify_failures: number;
  created_at: string;
  updated_at: string;
}

export function ensureReviewRepairTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_review_repairs (
      request_id TEXT PRIMARY KEY,
      action_key TEXT NOT NULL,
      policy_epoch INTEGER NOT NULL,
      round INTEGER NOT NULL,
      failed_session_id TEXT NOT NULL,
      failed_branch TEXT NOT NULL,
      failed_head TEXT NOT NULL,
      start_revision TEXT NOT NULL,
      pull_request_url TEXT,
      role TEXT NOT NULL,
      verdict TEXT NOT NULL,
      summary TEXT NOT NULL,
      report_path TEXT,
      findings_json TEXT NOT NULL,
      failed_checks_json TEXT NOT NULL,
      repair_session_id TEXT UNIQUE,
      outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'launched', 'escalated', 'gated', 'released')),
      reason TEXT,
      last_error TEXT,
      drafted_at TEXT,
      commented_at TEXT,
      closed_at TEXT,
      notify_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_production_review_repairs_action ON production_review_repairs(action_key, policy_epoch);
  `);
  const present = new Set((db.prepare("PRAGMA table_info(production_review_repairs)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!present.has("closed_at")) db.exec("ALTER TABLE production_review_repairs ADD COLUMN closed_at TEXT");
  if (!present.has("notify_failures")) db.exec("ALTER TABLE production_review_repairs ADD COLUMN notify_failures INTEGER NOT NULL DEFAULT 0");
}

function hasTable(db: Database.Database): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_review_repairs'").get() !== undefined;
}

/** One row per failed candidate Session and exact failed head. */
export function reviewRepairRequestId(failedSessionId: string, failedHead: string): string {
  return `worker-tick-repair-${failedSessionId}-${failedHead}`;
}

export function getReviewRepair(db: Database.Database, requestId: string): ReviewRepairRow | null {
  if (!hasTable(db)) return null;
  return (db.prepare("SELECT * FROM production_review_repairs WHERE request_id = ?").get(requestId) as ReviewRepairRow | undefined) ?? null;
}

export function listReviewRepairs(db: Database.Database, actionKey: string): ReviewRepairRow[] {
  if (!hasTable(db)) return [];
  return db.prepare("SELECT * FROM production_review_repairs WHERE action_key = ? ORDER BY created_at, rowid").all(actionKey) as ReviewRepairRow[];
}

/** Repair Sessions launched for this Action under this production epoch (the run): the durable round count. */
export function launchedRepairRounds(db: Database.Database, actionKey: string, epoch: number): number {
  if (!hasTable(db)) return 0;
  return (db.prepare(`SELECT COUNT(*) AS count FROM production_review_repairs
    WHERE action_key = ? AND policy_epoch = ? AND repair_session_id IS NOT NULL`).get(actionKey, epoch) as { count: number }).count;
}

/**
 * The repair this Session works on: the one it was launched for, or, for a
 * Session that resumed a repair Session's candidate (Decision 0051: same
 * worktree and branch), the repair that candidate was launched for.
 */
export function getSessionRepair(db: Database.Database, sessionId: string): ReviewRepairRow | null {
  if (!hasTable(db)) return null;
  const direct = db.prepare("SELECT * FROM production_review_repairs WHERE repair_session_id = ?").get(sessionId) as ReviewRepairRow | undefined;
  if (direct) return direct;
  return (db.prepare(`SELECT r.* FROM production_review_repairs r
    JOIN agent_sessions repair ON repair.id = r.repair_session_id
    JOIN agent_sessions s ON s.id = ?
    WHERE repair.worktree_path = s.worktree_path AND repair.branch = s.branch AND repair.action_id = s.action_id
    ORDER BY r.created_at DESC LIMIT 1`).get(sessionId) as ReviewRepairRow | undefined) ?? null;
}

/**
 * Inside `prepareSession`'s transaction: bind the new Session to its pending
 * repair row and supersede the failed candidate's accepted exit, so terminal
 * recovery and the scheduler's pointer hold release the failed candidate in
 * the same commit that creates its replacement. Either both happen or the
 * Session row is not inserted.
 */
export function bindRepairSession(db: Database.Database, input: { requestId: string; sessionId: string; now: Date }): void {
  const row = getReviewRepair(db, input.requestId);
  if (!row || row.outcome !== "pending" || row.repair_session_id !== null) {
    throw validationError("The review repair this launch was prepared for is no longer pending.", { code: "repair_not_pending", requestId: input.requestId, conflict: true });
  }
  const at = input.now.toISOString();
  const superseded = db.prepare(`UPDATE session_exit_receipts SET superseded_by_session_id = ?, updated_at = ?
    WHERE session_id = ? AND outcome = 'accepted_completion' AND superseded_by_session_id IS NULL`)
    .run(input.sessionId, at, row.failed_session_id).changes;
  if (superseded !== 1) {
    throw validationError("The failed candidate's accepted exit is missing or already superseded; no repair Session is prepared.", {
      code: "repair_candidate_superseded", requestId: input.requestId, failedSessionId: row.failed_session_id, conflict: true
    });
  }
  db.prepare("UPDATE production_review_repairs SET repair_session_id = ?, outcome = 'launched', last_error = NULL, updated_at = ? WHERE request_id = ?")
    .run(input.sessionId, at, input.requestId);
}

/**
 * Undo {@link bindRepairSession} for a Session abandoned before it started,
 * fenced on that exact Session: the failed candidate is pending again and
 * the next tick may retry the repair.
 */
export function releaseRepairSession(db: Database.Database, input: { requestId: string; sessionId: string; now: Date }): void {
  if (!hasTable(db)) return;
  const at = input.now.toISOString();
  const row = getReviewRepair(db, input.requestId);
  if (!row || row.repair_session_id !== input.sessionId) return;
  db.prepare("UPDATE session_exit_receipts SET superseded_by_session_id = NULL, updated_at = ? WHERE session_id = ? AND superseded_by_session_id = ?")
    .run(at, row.failed_session_id, input.sessionId);
  db.prepare("UPDATE production_review_repairs SET repair_session_id = NULL, outcome = 'pending', updated_at = ? WHERE request_id = ? AND repair_session_id = ?")
    .run(at, input.requestId, input.sessionId);
}

export function parseRepairFindings(row: Pick<ReviewRepairRow, "findings_json">): ReviewRepairFinding[] {
  try {
    const parsed = JSON.parse(row.findings_json) as unknown;
    return Array.isArray(parsed) ? parsed as ReviewRepairFinding[] : [];
  } catch {
    return [];
  }
}

export function parseRepairChecks(row: Pick<ReviewRepairRow, "failed_checks_json">): ReviewRepairCheck[] {
  try {
    const parsed = JSON.parse(row.failed_checks_json) as unknown;
    return Array.isArray(parsed) ? parsed as ReviewRepairCheck[] : [];
  } catch {
    return [];
  }
}

const oneLine = (text: string, limit = 600) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** The findings as one ordered, numbered list (the reviewer's order), for the brief and the escalation. */
export function renderRepairFindings(row: Pick<ReviewRepairRow, "findings_json" | "failed_checks_json">): string[] {
  const findings = parseRepairFindings(row);
  const checks = parseRepairChecks(row);
  const lines = findings.map((finding, index) =>
    `  ${index + 1}. [${finding.severity}] ${oneLine(finding.title, 200)} — evidence: ${oneLine(finding.evidence)} — recommendation: ${oneLine(finding.recommendation)}`);
  if (lines.length === 0) lines.push("  (the reviewer recorded no finding; see the failed checks and the report)");
  if (checks.length > 0) {
    lines.push("Failed or unestablished review checks:");
    for (const check of checks) lines.push(`  - ${oneLine(check.name, 120)}: ${check.status} — ${oneLine(check.evidence)}`);
  }
  return lines;
}

/** The repair section of a repair Session's Action brief (src/sessions/actionBrief.ts). */
export function renderRepairBrief(row: ReviewRepairRow): string[] {
  return [
    "",
    `Repair — this Session repairs a candidate an independent reviewer did not pass (repair round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS}):`,
    `Failed candidate: Session ${row.failed_session_id}, branch ${row.failed_branch}, head ${row.failed_head}${row.pull_request_url ? `, pull request ${row.pull_request_url}` : ""}.`,
    `Independent ${row.role} verdict: ${row.verdict}. Summary: ${oneLine(row.summary)}`,
    `Reviewer report Artifact: ${row.report_path ?? "unavailable"} (in the Arcadia workspace).`,
    `This worktree starts at ${row.start_revision}: the failed candidate's work before its completion settlement, on a new branch.`,
    `Reviewer findings, in the reviewer's order:`,
    ...renderRepairFindings(row),
    "Fix every finding in this worktree, run the declared validation, and finish with the completion protocol below:",
    "draft a fresh `complete` Agent Ask for THIS Session (a new request id). The host retired the failed candidate's own",
    "completion draft from this branch before you started; if a `complete` draft for this Action that you did not write is",
    "still in `.arcadia/asks/` (not the archive), delete it and never reuse its request id: it was for the failed head.",
    "The repaired head is reviewed again from scratch by independent reviewers before it can integrate.",
    "This repair grants no additional authority: the Plan, the Constitution and every approval boundary still bind."
  ];
}
