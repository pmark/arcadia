import type { OrientationEffort } from "./types.js";

/**
 * Coarse t-shirt effort sizing — the time dimension the ledger was missing.
 * Deliberately four buckets rather than minutes: people estimate specific
 * durations badly and won't fill them in, but "that's a quick one" / "that's
 * a whole afternoon" is already how they talk. See
 * docs/plans/mission-control-view/07-executive-summary-and-time-planning.md.
 */
export const EFFORT_CEILING_MINUTES: Record<OrientationEffort, number> = {
  quick: 15,
  short: 60,
  session: 180,
  project: Number.POSITIVE_INFINITY
};

export const EFFORT_LABELS: Record<OrientationEffort, string> = {
  quick: "≤15m",
  short: "≤1h",
  session: "1–3h",
  project: "multi-session"
};

/**
 * Whether a sized item honestly fits a window of `availableMinutes`.
 *
 * `project` never fits any single window by definition — it is multi-session
 * work that needs breaking down first, and proposing it into a gap is exactly
 * the false-hope failure this feature exists to remove.
 */
export function effortFitsWithin(effort: OrientationEffort, availableMinutes: number): boolean {
  return availableMinutes >= EFFORT_CEILING_MINUTES[effort];
}

/** The largest size that honestly fits a window, or undefined if nothing does. */
export function largestEffortFitting(availableMinutes: number): OrientationEffort | undefined {
  const ordered: OrientationEffort[] = ["session", "short", "quick"];
  return ordered.find((effort) => effortFitsWithin(effort, availableMinutes));
}

/** Human-readable minutes for packet/CLI lines: 90 -> "1h30m", 60 -> "1h", 20 -> "20m". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return remainder === 0 ? `${hours}h` : `${hours}h${remainder}m`;
}
