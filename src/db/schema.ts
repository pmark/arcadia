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
}

function ensureProjectGoalColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "goal")) {
    db.prepare("ALTER TABLE projects ADD COLUMN goal TEXT").run();
  }
}
