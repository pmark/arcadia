import type { OrientationEntry, OrientationHorizon } from "./types.js";

/** Days after which an entry at each horizon is considered stale (per 01-spec.md). */
export const STALENESS_THRESHOLD_DAYS: Record<OrientationHorizon, number> = {
  now: 2,
  soon: 7,
  later: 21,
  someday: 60
};

/** Days after which an entry is stale for approaching-window purposes (per priority). */
export const APPROACHING_LEAD_DAYS: Record<OrientationEntry["priority"], number> = {
  critical: 14,
  high: 7,
  normal: 3,
  low: 1
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function ageInDays(fromIso: string, now: Date): number {
  const from = new Date(fromIso).getTime();
  return (now.getTime() - from) / MS_PER_DAY;
}

export function isStale(entry: OrientationEntry, now: Date): boolean {
  const threshold = STALENESS_THRESHOLD_DAYS[entry.horizon];
  return ageInDays(entry.lastConfirmedAt, now) > threshold;
}

export function isNeglected(entry: OrientationEntry, now: Date): boolean {
  const threshold = STALENESS_THRESHOLD_DAYS[entry.horizon];
  return ageInDays(entry.lastConfirmedAt, now) >= threshold * 2;
}

/** How many days remain until due_at (negative = overdue). Undefined when the entry has no due date. */
export function daysUntilDue(entry: OrientationEntry, now: Date): number | undefined {
  if (!entry.dueAt) {
    return undefined;
  }
  const due = new Date(entry.dueAt).getTime();
  return (due - now.getTime()) / MS_PER_DAY;
}

export function isApproaching(entry: OrientationEntry, now: Date): boolean {
  const remaining = daysUntilDue(entry, now);
  if (remaining === undefined) {
    return false;
  }
  const lead = APPROACHING_LEAD_DAYS[entry.priority];
  return remaining >= 0 && remaining <= lead;
}

export function isDueOrUrgent(entry: OrientationEntry, now: Date): boolean {
  const remaining = daysUntilDue(entry, now);
  if (remaining !== undefined && remaining <= 0) {
    return true;
  }
  return entry.priority === "critical";
}
