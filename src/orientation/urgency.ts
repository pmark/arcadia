import { APPROACHING_LEAD_DAYS, daysUntilDue } from "./staleness.js";
import type { OrientationEntry, OrientationPriority } from "./types.js";

/**
 * Base continuous urgency score per priority tier — a floor, not the final
 * value. See docs/plans/mission-control-view/03-urgency-and-force-model.md.
 */
const BASE_PRIORITY_SCORE: Record<OrientationPriority, number> = {
  critical: 0.75,
  high: 0.55,
  normal: 0.35,
  low: 0.15
};

/**
 * Continuous 0..1 urgency score for a live Life-ledger entry. Reuses the
 * existing staleness.ts lead-window math (APPROACHING_LEAD_DAYS,
 * daysUntilDue) rather than a parallel scoring system — an overdue entry is
 * maximally urgent (1); a time_bound entry nearing its due date within its
 * priority's lead window gets a smooth bonus on top of its base priority
 * score; everything else is just its base priority score.
 */
export function computeOrientationUrgencyScore(entry: OrientationEntry, now: Date): number {
  const base = BASE_PRIORITY_SCORE[entry.priority];
  const remaining = daysUntilDue(entry, now);
  if (remaining === undefined) {
    return clamp01(base);
  }
  if (remaining <= 0) {
    return 1;
  }
  const lead = APPROACHING_LEAD_DAYS[entry.priority];
  const proximity = 1 - Math.min(1, remaining / lead);
  const bonus = 0.25 * Math.max(0, proximity);
  return clamp01(base + bonus);
}

export type UrgencyLevel = "critical" | "attention" | "quiet";

/** Coarse label derived from the continuous score — for badges/sort ties, never the spatial input itself. */
export function urgencyLevelForScore(score: number): UrgencyLevel {
  if (score >= 0.75) return "critical";
  if (score >= 0.4) return "attention";
  return "quiet";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
