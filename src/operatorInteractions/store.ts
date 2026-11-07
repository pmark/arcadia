import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";

/**
 * Operator interactions the records cannot prove on their own.
 *
 * A card press leaves a receipt and a dashboard Off leaves a policy receipt,
 * so the digest derives those. When an agent acts on the operator's word in
 * chat ("Yes merge them"), nothing records that the operator had to be asked.
 * This is the one place that does: one append-only row per interaction, with
 * the operator's exact words, what they unlocked, and whether the operator's
 * authority was truly needed or the interaction was avoidable.
 *
 * Local only: no credentials, no model, no network. Rows are never updated or
 * deleted by Arcadia; replaying the same (at, words) returns the existing row.
 */

export const OPERATOR_INTERACTION_NECESSITY = ["required", "avoidable"] as const;
export type OperatorInteractionNecessity = (typeof OPERATOR_INTERACTION_NECESSITY)[number];

export interface OperatorInteractionRecord {
  id: string;
  /** When the operator acted (said the words). */
  at: string;
  /** The operator's exact words. */
  words: string;
  /** What the interaction unlocked, in the recording agent's words. */
  unlocked: string;
  necessity: OperatorInteractionNecessity;
  /** The PR, card or Decision it acted on, if any. */
  ref: string | null;
  project: string | null;
  /** When the work started waiting for this answer, if known. */
  waitingSince: string | null;
  /** The agent that recorded it. */
  recordedBy: string | null;
  createdAt: string;
}

export interface OperatorInteractionInput {
  at?: string;
  words: string;
  unlocked: string;
  necessity: string;
  ref?: string | null;
  project?: string | null;
  waitingSince?: string | null;
  recordedBy?: string | null;
  now?: Date;
}

interface Row {
  id: string; at: string; words: string; unlocked: string; necessity: OperatorInteractionNecessity;
  ref: string | null; project: string | null; waiting_since: string | null; recorded_by: string | null; created_at: string;
}

export function ensureOperatorInteractionTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS operator_interactions (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    words TEXT NOT NULL,
    unlocked TEXT NOT NULL,
    necessity TEXT NOT NULL CHECK (necessity IN ('required', 'avoidable')),
    ref TEXT, project TEXT, waiting_since TEXT, recorded_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (at, words)
  );
  CREATE INDEX IF NOT EXISTS idx_operator_interactions_at ON operator_interactions(at);`);
}

export function recordOperatorInteraction(
  db: Database.Database,
  input: OperatorInteractionInput
): { interaction: OperatorInteractionRecord; created: boolean } {
  const now = input.now ?? new Date();
  const words = input.words.trim();
  const unlocked = input.unlocked.trim();
  if (!words) throw validationError("An operator interaction needs the operator's exact words (--words).", {});
  if (!unlocked) throw validationError("An operator interaction needs what it unlocked (--unlocked).", {});
  if (!(OPERATOR_INTERACTION_NECESSITY as readonly string[]).includes(input.necessity)) {
    throw validationError("An operator interaction is either required (only the operator's authority could do it) or avoidable.", { necessity: input.necessity });
  }
  const at = instant(input.at ?? now.toISOString(), "at");
  const waitingSince = input.waitingSince ? instant(input.waitingSince, "waiting-since") : null;
  if (waitingSince && waitingSince > at) {
    throw validationError("--waiting-since must not be after --at.", { at, waitingSince });
  }
  if (Date.parse(at) > now.getTime() + 60_000) throw validationError("--at must not be in the future.", { at });

  ensureOperatorInteractionTable(db);
  return writeTransaction(db, () => {
    const existing = db.prepare("SELECT * FROM operator_interactions WHERE at = ? AND words = ?").get(at, words) as Row | undefined;
    if (existing) return { interaction: toRecord(existing), created: false };
    const row: Row = {
      id: `opint_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      at,
      words,
      unlocked,
      necessity: input.necessity as OperatorInteractionNecessity,
      ref: input.ref?.trim() || null,
      project: input.project?.trim() || null,
      waiting_since: waitingSince,
      recorded_by: input.recordedBy?.trim() || null,
      created_at: now.toISOString()
    };
    db.prepare(`INSERT INTO operator_interactions
      (id, at, words, unlocked, necessity, ref, project, waiting_since, recorded_by, created_at)
      VALUES (@id, @at, @words, @unlocked, @necessity, @ref, @project, @waiting_since, @recorded_by, @created_at)`).run(row);
    return { interaction: toRecord(row), created: true };
  });
}

/** Recorded interactions with `at` in [start, end). Reads only; a workspace without the table has none. */
export function listOperatorInteractions(db: Database.Database, window: { start: string; end: string }): OperatorInteractionRecord[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'operator_interactions'").get()) return [];
  return (db.prepare("SELECT * FROM operator_interactions WHERE at >= ? AND at < ? ORDER BY at, id").all(window.start, window.end) as Row[])
    .map(toRecord);
}

function toRecord(row: Row): OperatorInteractionRecord {
  return {
    id: row.id,
    at: row.at,
    words: row.words,
    unlocked: row.unlocked,
    necessity: row.necessity,
    ref: row.ref,
    project: row.project,
    waitingSince: row.waiting_since,
    recordedBy: row.recorded_by,
    createdAt: row.created_at
  };
}

function instant(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw validationError(`--${field} must be a valid ISO-8601 instant.`, { [field]: value });
  return parsed.toISOString();
}
