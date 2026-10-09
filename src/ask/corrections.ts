import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { IntakeResult } from "../intake/index.js";
import type { StewardshipExecutionPath } from "../stewardship/index.js";
import { askQuestionOrigin } from "./askQuestion.js";
import { ingressSourceKind } from "./replyCapture.js";

/**
 * Operator corrections of an Ask, remembered so an exact repeat of the same words routes the same way next time
 * (Plan Action ask-corrections-stick). The Ask text is kept only in the workspace database, never in a repository.
 *
 * A correction is a memo only when an operator made it (`cli`, `discord`, or `answer`, the operator answering an Ask
 * question) and it names a type that is safe to apply without asking again. A row a model recorded is never a memo.
 */

/** Where a correction came from. Only these are operator sources; anything else is never replayed. */
export const OPERATOR_CORRECTION_SOURCES = ["cli", "discord", "answer"] as const;
export type OperatorCorrectionSource = (typeof OPERATOR_CORRECTION_SOURCES)[number];

/**
 * The types a memo may route to. `answer` is deliberately absent: it resolves a Decision and needs an explicit
 * reference every time, so no memo can ever answer one. `reroute` (a Project-only move of an unplaced Ask) names no type.
 */
export const MEMO_ROUTE_TYPES = ["work", "idea", "status"] as const;
export type MemoRouteType = (typeof MEMO_ROUTE_TYPES)[number];

export interface AskCorrectionInput {
  askRequestId: string;
  /** The Ask's text as the operator sent it; it is normalized here. */
  text: string;
  /** What Arcadia heard the Ask as: `work`, `idea`, `unclear`, `answer`, `status` or `none`. */
  predictedType: string;
  /** What the operator said it was: `work`, `idea`, `answer`, `status` or `reroute`. */
  correctedType: string;
  correctedProject: string | null;
  source: string;
  createdAt?: string;
}

export interface AskMemo {
  id: string;
  askRequestId: string;
  type: MemoRouteType;
  projectId: string | null;
  source: OperatorCorrectionSource;
  createdAt: string;
  /** `YYYY-MM-DD`, shown on the receipt as `(memo <date>)`. */
  date: string;
}

/** Exact match only: trim, fold case, collapse whitespace. No stemming, punctuation stripping or similarity. */
export function normalizeAskText(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function askTextHash(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

export function hasAskCorrectionsTable(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ask_corrections'").get());
}

/**
 * Records one correction and marks the corrected Ask. Insert only. Call it inside the transaction that re-routes the
 * Ask, so a correction cannot exist without its re-route and a re-route cannot lose its memo.
 */
export function recordAskCorrection(db: Database.Database, input: AskCorrectionInput): { id: string; createdAt: string } {
  const normalized = normalizeAskText(input.text);
  const id = `correction_${randomUUID()}`;
  const createdAt = input.createdAt ?? new Date().toISOString();
  // The row and the mark on the Ask commit together, or neither does. Inside a caller's transaction this is a savepoint.
  db.transaction(() => {
    db.prepare(
      `INSERT INTO ask_corrections
         (id, ask_request_id, normalized_text, text_hash, predicted_type, corrected_type, corrected_project, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.askRequestId,
      normalized,
      askTextHash(normalized),
      input.predictedType,
      input.correctedType,
      input.correctedProject,
      input.source,
      createdAt
    );
    db.prepare("UPDATE ask_requests SET corrected_type = ? WHERE id = ?").run(input.correctedType, input.askRequestId);
  })();
  return { id, createdAt };
}

/**
 * An operator answer that approves an Ask question creates the Action the question was about: a correction of the Ask
 * the question came from (heard as unclear, it is work). Call it inside the transaction that approves the question, so
 * the answer and its memo commit together. Nothing is recorded for a Decision that is not an Ask question, or one an
 * agent's Ask raised.
 */
export function recordAnswerCorrection(
  db: Database.Database,
  item: { id: string; ask_request_id: string | null; context_json: string; resolved_intent: string; source_input: string; project_id: string | null },
  resultingAskId: string
): void {
  const origin = askQuestionOrigin(db, item);
  if (!origin || ingressSourceKind(origin.via ?? "ask") === "agent") return;
  const work = db
    .prepare("SELECT wi.project_id FROM ask_requests ar JOIN work_items wi ON wi.id = ar.work_item_id WHERE ar.id = ?")
    .get(resultingAskId) as { project_id: string | null } | undefined;
  recordAskCorrection(db, {
    askRequestId: origin.askId,
    text: item.source_input,
    predictedType: "unclear",
    correctedType: "work",
    correctedProject: work?.project_id ?? item.project_id,
    source: "answer"
  });
}

/**
 * The operator memo for exactly this text, or null. The newest operator correction decides, whatever its type: if it
 * names something a memo may not apply (an `answer`, a Project-only `reroute`), the memo stands down, so a newer
 * correction retires an older one. Rows from a model are invisible. Corrections made in the same millisecond are
 * ordered by insertion (`rowid`), so the one recorded last always wins.
 */
export function findAskMemo(db: Database.Database, text: string): AskMemo | null {
  if (!hasAskCorrectionsTable(db)) return null;
  const normalized = normalizeAskText(text);
  if (!normalized) return null;
  const sources = OPERATOR_CORRECTION_SOURCES.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT id, ask_request_id, corrected_type, corrected_project, source, created_at FROM ask_corrections
        WHERE text_hash = ? AND normalized_text = ? AND source IN (${sources})
        ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(askTextHash(normalized), normalized, ...OPERATOR_CORRECTION_SOURCES) as
    | {
        id: string;
        ask_request_id: string;
        corrected_type: string;
        corrected_project: string | null;
        source: OperatorCorrectionSource;
        created_at: string;
      }
    | undefined;
  if (!row || !(MEMO_ROUTE_TYPES as readonly string[]).includes(row.corrected_type)) return null;
  return {
    id: row.id,
    askRequestId: row.ask_request_id,
    type: row.corrected_type as MemoRouteType,
    projectId: row.corrected_project,
    source: row.source,
    createdAt: row.created_at,
    date: row.created_at.slice(0, 10)
  };
}

/**
 * Whether a memo must stand down for an Ask whose ordinary route (what the patterns decide with no memo) is
 * `ordinaryPath`. A memo may replace the Clarify First and Back Burner outcomes, and the pattern outcome otherwise, but it
 * never lets an Ask skip Requires Review or Blocked. It also stands down for an intake that matched a concrete intent,
 * needs review and is not safe to execute, even when a missing field routes it to Clarify First ("deploy the site to
 * production" with no Project). A `capture_thought` intake matched no intent at all, so it is always flagged that way and
 * is exactly what a memo exists to replace. Pure, so the golden-set replay and `arcadia ask` share one rule.
 */
export function memoStandsDown(
  ordinaryPath: StewardshipExecutionPath,
  intake: Pick<IntakeResult, "action" | "reviewRequired" | "safeToExecute">
): boolean {
  const needsReview = intake.action.kind !== "capture_thought" && intake.reviewRequired && !intake.safeToExecute;
  return ordinaryPath === "Requires Review" || ordinaryPath === "Blocked" || needsReview;
}
