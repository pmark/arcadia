import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { askQuestionOrigin } from "./askQuestion.js";

/** What an Ask left behind, which is what a correction replaces. */
export type AskRecordKind = "question" | "idea" | "work" | "answer" | "none";

export interface AskRecord {
  kind: AskRecordKind;
  id: string | null;
  slug: string | null;
  status: string | null;
  projectId: string | null;
}

export interface AskSupersessionInput {
  oldAskRequestId: string;
  newAskRequestId: string;
  targetType: string;
  projectId: string | null;
  oldKind: AskRecordKind;
  oldRecordId: string | null;
  newKind: string;
  newRecordId: string | null;
  /** What became of the old record: `closed`, `archived`, `promoted`, `deferred` or `unchanged`. */
  oldDisposition: string;
  source: string;
  actor: string | null;
}

export interface AskSupersession extends AskSupersessionInput {
  id: string;
  createdAt: string;
}

interface SupersessionRow {
  id: string;
  old_ask_request_id: string;
  new_ask_request_id: string;
  target_type: string;
  project_id: string | null;
  old_kind: AskRecordKind;
  old_record_id: string | null;
  new_kind: string;
  new_record_id: string | null;
  old_disposition: string;
  source: string;
  actor: string | null;
  created_at: string;
}

function fromRow(row: SupersessionRow): AskSupersession {
  return {
    id: row.id,
    oldAskRequestId: row.old_ask_request_id,
    newAskRequestId: row.new_ask_request_id,
    targetType: row.target_type,
    projectId: row.project_id,
    oldKind: row.old_kind,
    oldRecordId: row.old_record_id,
    newKind: row.new_kind,
    newRecordId: row.new_record_id,
    oldDisposition: row.old_disposition,
    source: row.source,
    actor: row.actor,
    createdAt: row.created_at
  };
}

/** The table is created by migration; a read-only connection to an older database may not have it yet. */
export function hasSupersessionTable(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ask_supersessions'").get());
}

/** Records that `newAskRequestId` replaced `oldAskRequestId`. Insert only: a link is never edited or deleted. */
export function recordSupersession(db: Database.Database, input: AskSupersessionInput): AskSupersession {
  const id = `supersession_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO ask_supersessions
       (id, old_ask_request_id, new_ask_request_id, target_type, project_id, old_kind, old_record_id, new_kind,
        new_record_id, old_disposition, source, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.oldAskRequestId,
    input.newAskRequestId,
    input.targetType,
    input.projectId,
    input.oldKind,
    input.oldRecordId,
    input.newKind,
    input.newRecordId,
    input.oldDisposition,
    input.source,
    input.actor,
    createdAt
  );
  return { ...input, id, createdAt };
}

/** Corrections that replaced this Ask, oldest first. */
export function supersessionsReplacing(db: Database.Database, askId: string): AskSupersession[] {
  if (!hasSupersessionTable(db)) return [];
  const rows = db
    .prepare("SELECT * FROM ask_supersessions WHERE old_ask_request_id = ? ORDER BY created_at, id")
    .all(askId) as SupersessionRow[];
  return rows.map(fromRow);
}

/** The correction that created this Ask, if it is itself a replacement. */
export function supersessionThatCreated(db: Database.Database, askId: string): AskSupersession | null {
  if (!hasSupersessionTable(db)) return null;
  const row = db
    .prepare("SELECT * FROM ask_supersessions WHERE new_ask_request_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(askId) as SupersessionRow | undefined;
  return row ? fromRow(row) : null;
}

/**
 * Follows corrections from an Ask to the Ask that now stands in for it, so a second reply to the same receipt corrects
 * the live record rather than one already replaced. Bounded, so a malformed cycle cannot loop.
 */
export function currentAskId(db: Database.Database, askId: string): string {
  let current = askId;
  for (let hops = 0; hops < 50; hops += 1) {
    const replacements = supersessionsReplacing(db, current);
    const next = replacements[replacements.length - 1];
    if (!next) return current;
    current = next.newAskRequestId;
  }
  return current;
}

/** What the Ask left behind: its pending question, shelved idea, Action, applied answer, or nothing. */
export function describeAskRecord(db: Database.Database, askId: string): AskRecord {
  const ask = db
    .prepare("SELECT id, output_kind, work_item_id FROM ask_requests WHERE id = ?")
    .get(askId) as { id: string; output_kind: string; work_item_id: string | null } | undefined;
  if (!ask) return { kind: "none", id: null, slug: null, status: null, projectId: null };

  const reviews = db
    .prepare(
      `SELECT id, slug, status, project_id, ask_request_id, context_json, resolved_intent
         FROM review_items WHERE ask_request_id = ? ORDER BY created_at, id`
    )
    .all(askId) as Array<{
      id: string;
      slug: string | null;
      status: string;
      project_id: string | null;
      ask_request_id: string;
      context_json: string;
      resolved_intent: string;
    }>;
  const question = reviews.find((review) => askQuestionOrigin(db, review) !== null);
  if (question) {
    return { kind: "question", id: question.id, slug: question.slug, status: question.status, projectId: question.project_id };
  }

  const idea = db
    .prepare("SELECT id, status, project_id FROM back_burner_items WHERE ask_request_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(askId) as { id: string; status: string; project_id: string | null } | undefined;
  if (idea) return { kind: "idea", id: idea.id, slug: null, status: idea.status, projectId: idea.project_id };

  if (ask.work_item_id) {
    const work = db
      .prepare("SELECT id, status, project_id FROM work_items WHERE id = ?")
      .get(ask.work_item_id) as { id: string; status: string; project_id: string | null } | undefined;
    if (work) return { kind: "work", id: work.id, slug: null, status: work.status, projectId: work.project_id };
  }

  if (ask.output_kind === "review_response") return { kind: "answer", id: null, slug: null, status: null, projectId: null };
  return { kind: "none", id: null, slug: null, status: null, projectId: null };
}
