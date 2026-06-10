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
}
