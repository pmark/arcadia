import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

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
  return { id, createdAt };
}

/**
 * The operator memo for exactly this text, or null. The newest operator correction that names a routable type wins,
 * so correcting a correction replaces it. Rows from a model, and rows whose type a memo may not apply, are invisible.
 */
export function findAskMemo(db: Database.Database, text: string): AskMemo | null {
  if (!hasAskCorrectionsTable(db)) return null;
  const normalized = normalizeAskText(text);
  if (!normalized) return null;
  const sources = OPERATOR_CORRECTION_SOURCES.map(() => "?").join(", ");
  const types = MEMO_ROUTE_TYPES.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT id, ask_request_id, corrected_type, corrected_project, source, created_at FROM ask_corrections
        WHERE text_hash = ? AND normalized_text = ? AND source IN (${sources}) AND corrected_type IN (${types})
        ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get(askTextHash(normalized), normalized, ...OPERATOR_CORRECTION_SOURCES, ...MEMO_ROUTE_TYPES) as
    | {
        id: string;
        ask_request_id: string;
        corrected_type: MemoRouteType;
        corrected_project: string | null;
        source: OperatorCorrectionSource;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    askRequestId: row.ask_request_id,
    type: row.corrected_type,
    projectId: row.corrected_project,
    source: row.source,
    createdAt: row.created_at,
    date: row.created_at.slice(0, 10)
  };
}
