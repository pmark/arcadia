import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

export function getSchemaPath(): string {
  const fromCwd = path.resolve("database", "schema.sql");
  if (existsSync(fromCwd)) {
    return fromCwd;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const fromModule = path.resolve(moduleDir, "..", "..", "database", "schema.sql");
  if (existsSync(fromModule)) {
    return fromModule;
  }

  throw new Error("Could not find database/schema.sql");
}

export function readInitialSchema(): string {
  return readFileSync(getSchemaPath(), "utf8");
}

export function applyInitialSchema(db: Database.Database): void {
  db.exec(readInitialSchema());
  applyMigrations(db);
}

export function applyMigrations(db: Database.Database): void {
  ensureProjectGoalColumn(db);
  ensureReviewItemsTable(db);
}

function ensureProjectGoalColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "goal")) {
    db.prepare("ALTER TABLE projects ADD COLUMN goal TEXT").run();
  }
}

function ensureReviewItemsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY,
      ask_request_id TEXT,
      work_item_id TEXT,
      plan_id TEXT,
      project_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'approved', 'rejected', 'deferred')),
      decision_needed TEXT NOT NULL,
      recommendation TEXT,
      source_input TEXT NOT NULL,
      proposed_action TEXT NOT NULL,
      resolved_intent TEXT NOT NULL,
      confidence_label TEXT NOT NULL,
      confidence REAL NOT NULL,
      missing_fields TEXT NOT NULL DEFAULT '[]',
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_at TEXT,
      decision_note TEXT,
      resulting_ask_request_id TEXT,
      FOREIGN KEY (ask_request_id) REFERENCES ask_requests(id) ON DELETE SET NULL,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
      FOREIGN KEY (plan_id) REFERENCES execution_plans(id) ON DELETE SET NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (resulting_ask_request_id) REFERENCES ask_requests(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_items_status ON review_items(status);
    CREATE INDEX IF NOT EXISTS idx_review_items_project_id ON review_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_review_items_ask_request_id ON review_items(ask_request_id);
  `);
}
