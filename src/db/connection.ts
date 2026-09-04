import Database from "better-sqlite3";
import { withSqliteNativeAddonPreflight } from "./nativeAddon.js";
import { applyInitialSchema } from "./schema.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export function openDatabase(workspace: string): Database.Database {
  const paths = getWorkspacePaths(workspace);
  const db = withSqliteNativeAddonPreflight(() => new Database(paths.databaseFile));
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  // Long-running services (`intelligence serve`, the worker, the control
  // panel) hold this database open and commit continuously, so a competing
  // writer routinely waits. Five seconds was short enough that ordinary
  // settlement writes lost the race; `busy_timeout` only costs time when
  // there is genuine contention, so a longer wait is strictly better here.
  db.pragma("busy_timeout = 15000");
  applyInitialSchema(db);
  return db;
}

export function openReadOnlyDatabase(workspace: string): Database.Database {
  const paths = getWorkspacePaths(workspace);
  const db = withSqliteNativeAddonPreflight(() => new Database(paths.databaseFile, { readonly: true, fileMustExist: true }));
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * Runs `callback` inside an IMMEDIATE transaction, and is what every write
 * path should use.
 *
 * better-sqlite3's `db.transaction()` issues a plain `BEGIN`, which in WAL
 * mode is a *deferred* transaction: it takes a read snapshot first and only
 * asks for the write lock at the first write statement. If another connection
 * has committed in between, SQLite cannot upgrade that snapshot and fails with
 * `SQLITE_BUSY_SNAPSHOT` — immediately, and with `busy_timeout` having no
 * effect, because waiting cannot make a stale snapshot fresh. Retrying the
 * whole command does not help either while a service commits continuously,
 * which is why `docs/self-blocking-guards.md` item 5 records a settlement that
 * could not be retried at all until a service was killed.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front, before reading anything, so
 * there is no snapshot to invalidate and contention degrades into an ordinary
 * wait that `busy_timeout` governs.
 */
export function writeTransaction<T>(db: Database.Database, callback: () => T): T {
  return db.transaction(callback).immediate();
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
