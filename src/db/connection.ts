import Database from "better-sqlite3";
import { getWorkspacePaths } from "../workspace/paths.js";

export function openDatabase(workspace: string): Database.Database {
  const paths = getWorkspacePaths(workspace);
  const db = new Database(paths.databaseFile);
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
