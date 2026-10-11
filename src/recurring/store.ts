import type Database from "better-sqlite3";

export function ensureRecurringScheduleTables(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS recurring_schedules (
    id TEXT PRIMARY KEY, definition_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recurring_schedule_occurrences (
    schedule_id TEXT NOT NULL, occurrence_key TEXT NOT NULL, due_at TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE, proposal_id TEXT, status TEXT NOT NULL CHECK(status IN ('submitted','failed')),
    attempts INTEGER NOT NULL CHECK(attempts >= 0), last_error TEXT, updated_at TEXT NOT NULL,
    PRIMARY KEY(schedule_id, occurrence_key), FOREIGN KEY(schedule_id) REFERENCES recurring_schedules(id),
    FOREIGN KEY(proposal_id) REFERENCES agent_ask_proposals(id)
  );`);
  const columns = db.prepare("PRAGMA table_info(recurring_schedules)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "timing_json")) db.exec("ALTER TABLE recurring_schedules ADD COLUMN timing_json TEXT");
}
