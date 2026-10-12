import Database from "better-sqlite3";
import { withSqliteNativeAddonPreflight, withSqliteWorkspaceWriteDiagnostics } from "./nativeAddon.js";
import { applyInitialSchema } from "./schema.js";
import { ArcadiaError } from "../cli/errors.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export function openDatabase(workspace: string): Database.Database {
  const paths = getWorkspacePaths(workspace);
  return withSqliteWorkspaceWriteDiagnostics(paths.databaseFile, () => {
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
  });
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

export const SQLITE_LOCK_RETRY_ATTEMPTS = 4;
const SQLITE_LOCK_RETRY_BASE_MS = 250;

function isSqliteLockError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^SQLITE_(BUSY|LOCKED)/.test(code)) return true;
  return error instanceof Error && /database is locked/i.test(error.message);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Retries `operation` while SQLite reports a transient lock, a bounded number
 * of times with exponential backoff (`busy_timeout` already waited inside each
 * attempt). Anything that is not a lock propagates untouched. After the bound
 * the failure is a named `SQLITE_LOCK_RETRIES_EXHAUSTED` carrying the cause,
 * so an operator can tell "another writer held the database" from a defect.
 * `operation` must be safe to repeat: wrap whole write transactions, which
 * SQLite rolls back when they fail.
 */
export function retryOnSqliteLock<T>(operation: () => T, options: {
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => void;
} = {}): T {
  const attempts = options.attempts ?? SQLITE_LOCK_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? sleepSync;
  const base = options.baseDelayMs ?? SQLITE_LOCK_RETRY_BASE_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteLockError(error)) throw error;
      if (attempt >= attempts) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new ArcadiaError("SQLITE_LOCK_RETRIES_EXHAUSTED",
          `The workspace database stayed locked after ${attempts} attempts.`, 1,
          { attempts, cause: reason, remedy: "Retry once the competing writer (a worker tick or service) finishes." });
      }
      sleep(base * 2 ** (attempt - 1));
    }
  }
}
