import { describe, expect, it } from "vitest";
import { selectNextPlan, type SelectorInput } from "../src/plans/nextPlanSelector.js";

// The Workspace Plan picker shows `proposed` Plans. The selector has no special case for them: a proposed Plan is
// live like a draft, so it is chosen only when the preference record names it with an operator receipt.
const input = (chosenPlan: string): SelectorInput => ({
  preferences: [{ project: "arcadia", included: true, chosenPlan, receipt: "pref-receipt-1" }],
  plans: [
    { project: "arcadia", slug: "next-plan", status: "draft", sourceAsks: ["old"], authoringSession: "s-old", onMain: true },
    { project: "arcadia", slug: "proposed-plan", status: "proposed", sourceAsks: ["old"], authoringSession: "s-old", onMain: true }
  ],
  queues: [{ project: "arcadia", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: null, activePlanWaitsOnOperator: null }],
  activePlans: { arcadia: null },
  closeOuts: [], redAlerts: [], currentRunId: "run-now", currentSessionId: "s-now", currentRunAsks: ["ask-now"], onlyProject: null,
  headSha: "f46031d62aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  inputSources: { preferences: "live", queue: "live", redAlerts: "live", runId: "live", sessionId: "live", runAsks: "live" },
  now: "2026-10-14T00:00:00.000Z", expires: "2026-10-15T00:00:00.000Z"
});

describe("selectNextPlan and proposed Plans", () => {
  it("excludes a proposed Plan the operator did not choose", () => {
    const result = selectNextPlan(input("next-plan"));
    expect(result.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    expect(result.refusals.find(r => r.plan === "proposed-plan")?.code).toBe("plan_not_in_project_preference");
  });
});
