import type Database from "better-sqlite3";

/** Where an Ask-originated question came from: its Ask and the ingress its capture envelope names, when stored. */
export interface AskOrigin {
  askId: string;
  via: string | null;
}

/**
 * The open or deferred Ask question created at or after `sinceIso` whose source text is exactly `text`, in the same
 * Project (`projectId`, null for none). Exact on the trimmed text: "duplicate" means the same words, not a similar
 * request. Only Ask questions count, so a Decision an Ask raised for another reason never swallows a message, and a
 * re-send that adds `--project` (a different Project) is a new question.
 */
export function findOpenAskQuestionDuplicate(
  db: Database.Database,
  text: string,
  sinceIso: string,
  projectId: string | null
): { id: string; slug: string | null; created_at: string } | null {
  const candidates = db
    .prepare(
      `SELECT id, slug, created_at, ask_request_id FROM review_items
        WHERE ask_request_id IS NOT NULL
          AND status IN ('open', 'deferred')
          AND TRIM(source_input) = ?
          AND project_id IS ?
          AND created_at >= ?
        ORDER BY created_at DESC, id DESC`
    )
    .all(text.trim(), projectId, sinceIso) as Array<{ id: string; slug: string | null; created_at: string; ask_request_id: string }>;
  const found = candidates.find((candidate) => askQuestionOrigin(db, candidate.ask_request_id) !== null);
  return found ? { id: found.id, slug: found.slug, created_at: found.created_at } : null;
}

/**
 * Whether a review_item is an Ask question: raised by an Ask (`ask_request_id`) that routed to Clarify First and made
 * no Action. A review_item an Ask raised for another reason (a gated Action, a repository path) is a Decision, not an
 * Ask question. Null when it is not one.
 */
export function askQuestionOrigin(db: Database.Database, askRequestId: string | null | undefined): AskOrigin | null {
  if (!askRequestId) return null;
  const ask = db
    .prepare(
      `SELECT ar.id, ar.work_item_id, ar.stewardship_json, ce.ingress_source
         FROM ask_requests ar
         LEFT JOIN ask_capture_envelopes ce ON ce.id = ar.capture_id
        WHERE ar.id = ?`
    )
    .get(askRequestId) as
    | { id: string; work_item_id: string | null; stewardship_json: string | null; ingress_source: string | null }
    | undefined;
  if (!ask || ask.work_item_id || !ask.stewardship_json) return null;
  try {
    const stewardship = JSON.parse(ask.stewardship_json) as { recommendedExecutionPath?: unknown };
    if (stewardship.recommendedExecutionPath !== "Clarify First") return null;
  } catch {
    return null;
  }
  return { askId: ask.id, via: ask.ingress_source };
}
