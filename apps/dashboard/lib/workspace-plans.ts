import type { PlanRow } from "./plans-types";

/**
 * A Project's Plans grouped for the workspace, so the one Go is working on leads and the many drafts and
 * finished Plans stay one tap away instead of crowding it. Grouping only orders the view; it changes no record.
 */
export interface PlanGroups {
  /** The Plan Go names, or the Project's recorded active Plan before Go has been read. */
  current: PlanRow | null;
  /** Recorded as active but not the Plan Go is working on. */
  otherActive: PlanRow[];
  /** Drafts, proposals and dormant Plans: not yet governed work. */
  upcoming: PlanRow[];
  /** Complete, superseded and any other closed status. */
  finished: PlanRow[];
}

const UPCOMING = new Set(["draft", "proposed", "dormant"]);
export function groupPlans(plans: PlanRow[], goPlan: string | null): PlanGroups {
  const current = (goPlan ? plans.find(p => p.slug === goPlan) : undefined) ?? plans.find(p => p.isActivePlan) ?? null;
  const rest = plans.filter(p => p !== current);
  return {
    current,
    otherActive: rest.filter(p => p.status === "active"),
    upcoming: rest.filter(p => UPCOMING.has(p.status)),
    finished: rest.filter(p => p.status !== "active" && !UPCOMING.has(p.status))
  };
}

/** "3 open · 1 in progress · 4 done", omitting zero counts; null when the Plan has no Action counts. */
export function planProgress(plan: PlanRow): string | null {
  const c = plan.actionCounts;
  if (!c) return null;
  const parts = [[c.open, "open"], [c.in_progress, "in progress"], [c.blocked, "blocked"], [c.done, "done"]] as const;
  const text = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(" · ");
  return text || "No Actions";
}
