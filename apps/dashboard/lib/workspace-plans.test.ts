import { describe, expect, it } from "vitest";
import type { PlanRow } from "./plans-types";
import { groupPlans, planProgress } from "./workspace-plans";

const plan = (slug: string, status: string, isActivePlan = false, actionCounts: PlanRow["actionCounts"] = null): PlanRow =>
  ({ slug, status, governed: true, milestone: null, isActivePlan, actionCounts, activationNote: null, relativePath: `docs/plans/${slug}.md` });

describe("workspace Plan groups", () => {
  const plans = [plan("old", "complete"), plan("idea", "draft"), plan("go", "active", true), plan("stale-active", "active"), plan("pitch", "proposed"), plan("replaced", "superseded")];

  it("leads with Go's Plan, then other active Plans, keeping drafts and finished Plans apart", () => {
    const groups = groupPlans(plans, "go");
    expect(groups.current?.slug).toBe("go");
    expect(groups.otherActive.map(p => p.slug)).toEqual(["stale-active"]);
    expect(groups.upcoming.map(p => p.slug)).toEqual(["idea", "pitch"]);
    expect(groups.finished.map(p => p.slug)).toEqual(["old", "replaced"]);
  });
  it("follows Go when it names a different Plan, and the recorded active Plan before Go is read", () => {
    expect(groupPlans(plans, "stale-active").current?.slug).toBe("stale-active");
    expect(groupPlans(plans, "stale-active").otherActive.map(p => p.slug)).toEqual(["go"]);
    expect(groupPlans(plans, null).current?.slug).toBe("go");
    expect(groupPlans([plan("idea", "draft")], null).current).toBeNull();
  });
  it("loses no Plan", () => {
    const g = groupPlans(plans, "go");
    expect([g.current, ...g.otherActive, ...g.upcoming, ...g.finished].length).toBe(plans.length);
  });
  it("summarizes Action progress without zero counts", () => {
    expect(planProgress(plan("p", "active", false, { open: 2, in_progress: 0, done: 3, blocked: 1 }))).toBe("2 open · 1 blocked · 3 done");
    expect(planProgress(plan("p", "active", false, { open: 0, in_progress: 0, done: 0, blocked: 0 }))).toBe("No Actions");
    expect(planProgress(plan("p", "draft"))).toBeNull();
  });
});
