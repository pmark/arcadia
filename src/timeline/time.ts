import { validationError } from "../cli/errors.js";
import type { TimelineWindow } from "./schema.js";

const RELATIVE = /^(\d+(?:\.\d+)?)\s*(m|min|h|d|w)$/i;
const UNIT_MS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000
};

/** The default look-back when no `--since` is given. */
export const DEFAULT_LOOKBACK_MS = 24 * 3_600_000;

/**
 * `--since` / `--until` / `--as-of`: an ISO time (`2026-10-06T03:30Z`, `2026-10-05`)
 * or a relative look-back from `now` (`30m`, `6h`, `1d`, `2w`).
 */
export function parseTimeBound(value: string, now: Date, flag: string): Date {
  const trimmed = value.trim();
  const relative = RELATIVE.exec(trimmed);
  if (relative) {
    const amount = Number(relative[1]);
    return new Date(now.getTime() - amount * UNIT_MS[relative[2].toLowerCase()]);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const date = new Date(trimmed);
    if (Number.isFinite(date.getTime())) return date;
  }
  throw validationError(`${flag} must be an ISO time (2026-10-06T03:30Z) or a relative look-back (30m, 6h, 1d, 2w).`, {
    flag,
    value
  });
}

export function resolveWindow(input: { since?: string; until?: string; asOf?: string; now: Date }): TimelineWindow & { asOf: Date | null } {
  const asOf = input.asOf ? parseTimeBound(input.asOf, input.now, "--as-of") : null;
  const until = input.until ? parseTimeBound(input.until, input.now, "--until") : asOf ?? input.now;
  // A relative --since counts back from the window's end, so `--as-of X --since 6h` means the six hours before X.
  const since = input.since ? parseTimeBound(input.since, until, "--since") : new Date(until.getTime() - DEFAULT_LOOKBACK_MS);
  if (since.getTime() > until.getTime()) {
    throw validationError("--since is after --until.", { since: since.toISOString(), until: until.toISOString() });
  }
  return { since, until, asOf };
}
