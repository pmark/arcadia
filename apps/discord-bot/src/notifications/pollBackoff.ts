import { CliTimeoutError } from "../arcadia/cli.js";
import type { LogLevel } from "../logging.js";

/**
 * After a CLI call is killed by its timeout, an identical call on the very next
 * tick will usually be killed too (Issue #2581: compose was relaunched every
 * tick for a 200 s kill). This skips that command for a bounded number of ticks,
 * longer after each consecutive timeout up to the last bound, and forgets the
 * history on a success. Only timeouts back off; any other failure retries as before.
 */
export interface TimeoutBackoff {
  /** Consumes one tick. Returns the skip reason while the command is backing off, else null. */
  shouldSkip(key: string): string | null;
  recordTimeout(key: string, detail: string): void;
  recordSuccess(key: string): void;
}

export interface TimeoutBackoffOptions {
  /** Ticks to skip after the 1st, 2nd, ... consecutive timeout; the last entry is the cap. */
  skipTicks?: number[];
}

export const DEFAULT_SKIP_TICKS = [1, 2, 4];

export function createTimeoutBackoff(options: TimeoutBackoffOptions = {}): TimeoutBackoff {
  const bounds = options.skipTicks && options.skipTicks.length > 0 ? options.skipTicks : DEFAULT_SKIP_TICKS;
  const state = new Map<string, { consecutive: number; remaining: number; detail: string }>();
  return {
    shouldSkip(key) {
      const entry = state.get(key);
      if (!entry || entry.remaining <= 0) return null;
      entry.remaining -= 1;
      return `previous call timed out (${entry.detail}); skipping ${entry.remaining + 1} more tick(s) including this one, ${entry.consecutive} consecutive timeout(s)`;
    },
    recordTimeout(key, detail) {
      const consecutive = (state.get(key)?.consecutive ?? 0) + 1;
      const skip = bounds[Math.min(consecutive, bounds.length) - 1];
      state.set(key, { consecutive, remaining: skip, detail });
    },
    recordSuccess(key) {
      state.delete(key);
    }
  };
}

/**
 * Runs `call` unless `key` is backing off. A skipped tick is logged with its
 * reason and returns `{ skipped: true }`; otherwise the call's value, or its
 * error rethrown unchanged after a timeout is recorded.
 */
export async function runWithTimeoutBackoff<T>(
  backoff: TimeoutBackoff,
  key: string,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void,
  call: () => Promise<T>
): Promise<{ skipped: true } | { skipped: false; value: T }> {
  const reason = backoff.shouldSkip(key);
  if (reason) {
    logJson("warn", { msg: "poll skipped after timeout", command: key, reason });
    return { skipped: true };
  }
  try {
    const value = await call();
    backoff.recordSuccess(key);
    return { skipped: false, value };
  } catch (error) {
    if (error instanceof CliTimeoutError) {
      backoff.recordTimeout(key, error.message);
    }
    throw error;
  }
}
