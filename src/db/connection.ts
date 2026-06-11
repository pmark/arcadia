import Database from "better-sqlite3";
import { applyInitialSchema } from "./schema.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export function openDatabase(workspace: string): Database.Database {
  const paths = getWorkspacePaths(workspace);
  const db = new Database(paths.databaseFile);
  db.pragma("foreign_keys = ON");
  applyInitialSchema(db);
  return db;
}

export function openReadOnlyDatabase(workspace: string): Database.Database {
  const paths = getWorkspacePaths(workspace);
  const db = new Database(paths.databaseFile, { readonly: true, fileMustExist: true });
  db.pragma("foreign_keys = ON");
  return db;
}

export function withDatabase<T>(workspace: string, callback: (db: Database.Database) => T): T {
  const db = openDatabase(workspace);

  try {
    return callback(db);
  } finally {
    db.close();
  }
}

export function withReadOnlyDatabase<T>(workspace: string, callback: (db: Database.Database) => T): T {
  const db = openReadOnlyDatabase(workspace);

  try {
    return callback(db);
  } finally {
    db.close();
  }
}
