import type { PlanRow } from "./plans-types";

/**
 * A Project's Plans grouped for the workspace, so the one Go is working on leads and the many drafts and
 * finished Plans stay one tap away instead of crowding it. Grouping only orders the view; it changes no record.
 */
export interface PlanGroups {
  current: PlanRow | null;
  /** Where `current` came from, so its label never claims Go named a Plan it did not. */
  source: "go" | "recorded" | null;
  /** Go named this Plan, but the Plan list does not include it (the list is older than Go's read). */
  missingGoPlan: string | null;
  /** Recorded as active but not the leading Plan. */
  otherActive: PlanRow[];
  /** Drafts, proposals and any status that is neither active nor finished, such as an ungoverned `unknown`. */
  upcoming: PlanRow[];
  finished: PlanRow[];
}

const FINISHED = new Set(["complete", "completed", "done", "superseded", "archived"]);
export function groupPlans(plans: PlanRow[], goPlan: string | null): PlanGroups {
  const named = goPlan ? plans.find(p => p.slug === goPlan) ?? null : null;
  const recorded = named ? null : plans.find(p => p.isActivePlan) ?? null;
  const current = named ?? recorded;
  const rest = plans.filter(p => p !== current);
  return {
    current,
    source: named ? "go" : recorded ? "recorded" : null,
    missingGoPlan: goPlan && !named ? goPlan : null,
    otherActive: rest.filter(p => p.status === "active"),
    upcoming: rest.filter(p => p.status !== "active" && !FINISHED.has(p.status)),
    finished: rest.filter(p => FINISHED.has(p.status))
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
