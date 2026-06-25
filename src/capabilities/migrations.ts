import type Database from "better-sqlite3";
import type { CapabilityModule } from "./core.js";
import { builtInCapabilityModules } from "./registry.js";
import { nowIso } from "../utils/time.js";

export function applyCapabilityMigrations(db: Database.Database): void {
  ensureCapabilityCoreTables(db);

  for (const module of builtInCapabilityModules) {
    applyModuleMigrations(db, module);
  }
}

function ensureCapabilityCoreTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS capability_migrations (
      module_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      version TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (module_id, migration_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      source_module TEXT,
      project_id TEXT,
      work_item_id TEXT,
      artifact_id TEXT,
      review_item_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
      FOREIGN KEY (review_item_id) REFERENCES review_items(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
    CREATE INDEX IF NOT EXISTS idx_events_source_module ON events(source_module);
  `);
}

function applyModuleMigrations(db: Database.Database, module: CapabilityModule): void {
  const hasMigration = db.prepare(
    "SELECT 1 FROM capability_migrations WHERE module_id = ? AND migration_id = ?"
  );
  const insertMigration = db.prepare(
    `INSERT INTO capability_migrations (module_id, migration_id, version, applied_at)
     VALUES (?, ?, ?, ?)`
  );

  for (const migration of module.migrations) {
    if (hasMigration.get(module.id, migration.id)) {
      continue;
    }

    db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(module.id, migration.id, module.version, nowIso());
    })();
  }
}
