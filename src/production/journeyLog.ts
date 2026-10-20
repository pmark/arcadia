import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * An append-only history of what the managed-production worker met on each
 * Action's way (lesson_76d1c3144e2078c88ca9). `production_operator_escalations`
 * and `production_launch_refusal_log` keep ONE current row per Action,
 * upserted each tick, and `production_review_repairs.outcome` is overwritten
 * when a gated repair later launches, so their history was lost. Each write
 * site also appends here; `arcadia journey` reads it to show the obstacles
 * already left behind. Rows are never updated or deleted.
 */
export type JourneyLogSource = "escalation" | "launch_refusal" | "review_repair";

/**
 * Created by `applyInitialSchema` (so a read-only `arcadia journey` open sees
 * it) and by the tick and review-repair table ensures (so a writer whose
 * database predates it gains it on its next writable open).
 */
export function ensureActionJourneyLogTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS action_journey_log (
      id TEXT PRIMARY KEY,
      action_key TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('escalation', 'launch_refusal', 'review_repair')),
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      remedy TEXT,
      fingerprint TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_action_journey_log_action_at ON action_journey_log(action_key, at);
  `);
}

export function journeyLogFingerprint(kind: string, message: string, remedy: string | null): string {
  return createHash("sha256").update(JSON.stringify([kind, message, remedy])).digest("hex");
}

/**
 * Append one entry unless the latest entry for (action_key, source) already
 * has this fingerprint, so a per-tick upsert of an unchanged state writes
 * nothing. Returns whether a row was appended. Never throws: the journal is a
 * projection, and its failure must never break the tick that called it.
 */
export function appendJourneyLog(
  db: Database.Database,
  input: { actionKey: string; source: JourneyLogSource; kind: string; message: string; remedy?: string | null; at: string }
): boolean {
  try {
    const remedy = input.remedy ?? null;
    const fingerprint = journeyLogFingerprint(input.kind, input.message, remedy);
    const latest = db.prepare(`SELECT fingerprint FROM action_journey_log WHERE action_key = ? AND source = ?
      ORDER BY at DESC, rowid DESC LIMIT 1`).get(input.actionKey, input.source) as { fingerprint: string } | undefined;
    if (latest?.fingerprint === fingerprint) return false;
    db.prepare(`INSERT INTO action_journey_log (id, action_key, source, kind, message, remedy, fingerprint, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.actionKey, input.source, input.kind, input.message, remedy, fingerprint, input.at);
    return true;
  } catch {
    return false;
  }
}

/** Journal a review-repair row's current outcome (kind = outcome, message = reason ?? summary); never throws. */
export function appendReviewRepairJourneyLog(db: Database.Database, requestId: string, at: string): void {
  try {
    const row = db.prepare("SELECT action_key, outcome, reason, summary FROM production_review_repairs WHERE request_id = ?").get(requestId) as
      | { action_key: string; outcome: string; reason: string | null; summary: string }
      | undefined;
    if (row) appendJourneyLog(db, { actionKey: row.action_key, source: "review_repair", kind: row.outcome, message: row.reason ?? row.summary, at });
  } catch { /* the journal never breaks its caller */ }
}
