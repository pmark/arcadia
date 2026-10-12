/**
 * Leaf module (no imports) so the dashboard graph and `db/connection` stay free
 * of the CLI error layer; commands translate the named error themselves.
 */
export class SqliteLockRetriesExhaustedError extends Error {
  constructor(readonly attempts: number, readonly reason: string) {
    super(`The workspace database stayed locked after ${attempts} attempts.`);
    this.name = "SqliteLockRetriesExhaustedError";
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
        throw new SqliteLockRetriesExhaustedError(attempts, reason);
      }
      sleep(base * 2 ** (attempt - 1));
    }
  }
}
