import { DIGEST_PERIODS, type DigestPeriod, type DigestWindow } from "./types.js";

/**
 * Cadence windows: calendar-aligned, local, and always the last *completed*
 * period.
 *
 * This is the answer to the plan's `digest-window-boundaries` question, and it
 * follows from what a scheduled digest has to be true about. A rolling
 * "last 24 hours from whenever the tick fired" window would make the same day's
 * activity land in two different digests depending on when the bot happened to
 * restart, and a digest of the period currently in progress would be composed
 * near-empty and then never revisited, because the once-per-period guard has
 * already been satisfied. Narrating the period that has finished is the only
 * option under which every recorded fact lands in exactly one digest of each
 * cadence.
 *
 * Local, not UTC, for the same reason the orientation packet is local: the
 * operator's "yesterday" is the one on their own clock.
 */
export function completedWindow(period: DigestPeriod, now: Date): DigestWindow {
  const end = startOfCurrentPeriod(period, now);
  const start = previousPeriodStart(period, end);
  return { period, start: start.toISOString(), end: end.toISOString() };
}

/**
 * Every cadence's due window at this instant.
 *
 * All three are always "due" in the sense that a completed period always
 * exists; whether one has already been composed is decided by the stored
 * (scope, period, window) identity, not by the clock. That is what makes a
 * missed tick self-catch-up: a bot that was down all night composes the same
 * window on its first tick after restart that it would have composed on time.
 *
 * A bot down for longer than one period only ever produces the most recent
 * one — older windows are not backfilled. The digest is a "what just happened"
 * surface, and silently posting a month of catch-up on restart would be worse
 * than the gap.
 */
export function dueDigestWindows(now: Date): DigestWindow[] {
  return DIGEST_PERIODS.map((period) => completedWindow(period, now));
}

/** Human-readable label for a completed window, for delivery headers. */
export function describeWindow(window: DigestWindow): string {
  const start = window.start.slice(0, 10);
  const endInclusive = new Date(new Date(window.end).getTime() - 1).toISOString().slice(0, 10);
  if (window.period === "day") return start;
  return `${start} to ${endInclusive}`;
}

function startOfCurrentPeriod(period: DigestPeriod, now: Date): Date {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  switch (period) {
    case "day":
      return midnight;
    case "week": {
      // ISO weeks start Monday; getDay() calls Sunday 0.
      const daysSinceMonday = (midnight.getDay() + 6) % 7;
      return new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - daysSinceMonday, 0, 0, 0, 0);
    }
    case "month":
      return new Date(midnight.getFullYear(), midnight.getMonth(), 1, 0, 0, 0, 0);
  }
}

function previousPeriodStart(period: DigestPeriod, currentStart: Date): Date {
  switch (period) {
    case "day":
      return new Date(currentStart.getFullYear(), currentStart.getMonth(), currentStart.getDate() - 1, 0, 0, 0, 0);
    case "week":
      return new Date(currentStart.getFullYear(), currentStart.getMonth(), currentStart.getDate() - 7, 0, 0, 0, 0);
    case "month":
      return new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, 1, 0, 0, 0, 0);
  }
}
