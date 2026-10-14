import { describe, expect, it } from "vitest";
import {
  adaptQueue, selectNextPlan, type LiveQueue, type LiveQueueEntry, type PlanSummary, type SelectorInput
} from "../src/plans/nextPlanSelector.js";

const plan = (slug: string, status: string, extra: Partial<PlanSummary> = {}): PlanSummary =>
  ({ project: "arcadia", slug, status, sourceAsks: ["ask-old"], authoringSession: "s-old", onMain: true, ...extra });

const attention = (kind: string, planSlug: string | null): LiveQueueEntry =>
  ({ projectSlug: "arcadia", actionId: "gated", planSlug, state: "attention", attentionKind: kind, orderStatus: "explicit", position: 1 });

function queueWith(entries: LiveQueueEntry[]): LiveQueue {
  return { orderValid: true, unpositionedCount: 0, nextActionKey: null, ordered: [], ready: [], running: [], flagged: [], attention: entries };
}

function input(overrides: Partial<SelectorInput> = {}): SelectorInput {
  const adapted = adaptQueue(queueWith([attention("decision", "active-plan")]), { arcadia: "active-plan" });
  return {
    preferences: [{ project: "arcadia", included: true, chosenPlan: "next-plan", receipt: "pref-1" }],
    plans: [plan("active-plan", "active"), plan("next-plan", "draft")],
    queues: adapted.queues,
    queueGlobal: adapted.global,
    activePlans: { arcadia: "active-plan" },
    closeOuts: [],
    redAlerts: [],
    currentRunId: "run-now",
    currentSessionId: "s-now",
    currentRunAsks: [],
    onlyProject: null,
    headSha: null,
    inputSources: { preferences: "live", queue: "live", redAlerts: "live", runId: "live", sessionId: "live", runAsks: "live" },
    now: "2026-10-14T00:00:00.000Z",
    expires: "2026-10-15T00:00:00.000Z",
    ...overrides
  };
}

const withQueue = (entries: LiveQueueEntry[]) => {
  const adapted = adaptQueue(queueWith(entries), { arcadia: "active-plan" });
  return input({ queues: adapted.queues, queueGlobal: adapted.global });
};

describe("B1: waiting is about the active Plan, not the Project", () => {
  it("an unrelated Decision (another Plan's planSlug) does not make the active Plan wait", () => {
    const result = selectNextPlan(withQueue([attention("decision", "other-plan")]));
    expect(result.chosen).toBeNull();
    expect(result.refusals.map(r => r.code)).toContain("project_has_active_plan");
  });

  it("a Decision tied to the active Plan lets the next Plan be chosen", () => {
    const result = selectNextPlan(withQueue([attention("decision", "active-plan")]));
    expect(result.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    expect(result.refusals.map(r => r.code)).not.toContain("project_has_active_plan");
  });

  it("entries that cannot be tied to a Plan make waiting unknown and do not bypass the rule", () => {
    const adapted = adaptQueue(queueWith([attention("decision", null)]), { arcadia: "active-plan" });
    expect(adapted.queues.find(q => q.project === "arcadia")!.activePlanWaitsOnOperator).toBeNull();
    const result = selectNextPlan(withQueue([attention("decision", null)]));
    expect(result.chosen).toBeNull();
    expect(result.refusals.map(r => r.code)).toContain("project_has_active_plan");
  });

  it("an unknown active Plan slug makes waiting unknown", () => {
    const adapted = adaptQueue(queueWith([attention("decision", "active-plan")]), {});
    expect(adapted.queues[0].activePlanWaitsOnOperator).toBeNull();
  });
});

describe("S1: the active Plan comes from the checked-in pointer, never an alphabetical status scan", () => {
  const stale = ["aaa-stale", "bbb-stale", "ccc-stale", "ddd-stale"].map(slug => plan(slug, "active"));
  const plans = [...stale, plan("pointer-plan", "active"), plan("next-plan", "draft")];

  it("uses PROJECT.md active_plan when the queue is unreadable", () => {
    const result = selectNextPlan(input({ plans, queues: null, queueGlobal: null, activePlans: { arcadia: "pointer-plan" } }));
    const refusal = result.refusals.find(r => r.code === "project_has_active_plan")!;
    expect(refusal.message).toContain("pointer-plan");
    expect(refusal.message).not.toContain("aaa-stale");
  });

  it("choosing the pointer Plan itself is not refused despite stale active docs", () => {
    const result = selectNextPlan(input({
      plans, queues: null, queueGlobal: null, activePlans: { arcadia: "pointer-plan" },
      preferences: [{ project: "arcadia", included: true, chosenPlan: "pointer-plan", receipt: "r" }]
    }));
    expect(result.chosen).toEqual({ project: "arcadia", plan: "pointer-plan" });
  });

  it("an unknown active Plan is not a false refusal; it is unknown and not ready", () => {
    const result = selectNextPlan(input({ plans, queues: null, queueGlobal: null, activePlans: {} }));
    expect(result.refusals.map(r => r.code)).not.toContain("project_has_active_plan");
    expect(result.chosen).not.toBeNull();
    expect(result.preflight.find(c => c.check === "active_plan_known")!.status).toBe("unknown");
    expect(result.ready).toBe(false);
  });
});

describe("S2: receipt wording", () => {
  it("states the receipt is a caller-supplied claim, truncated and stripped of control characters", () => {
    const receipt = `${"x".repeat(200)}\n‮evil`;
    const result = selectNextPlan(input({
      preferences: [{ project: "arcadia", included: true, chosenPlan: "next-plan", receipt }],
      inputSources: { preferences: "caller" }
    }));
    const line = result.reasons.find(r => r.includes("receipt claimed"))!;
    expect(line).toContain("receipt claimed (caller-supplied, unverified):");
    expect(line).not.toContain("\n");
    expect(line).not.toContain("‮");
    expect(line.length).toBeLessThan(200);
    expect(result.card!.what).toContain("based on a caller-supplied, unverified preference record");
  });
});

describe("S3: authorship unknown never offers run", () => {
  it("a Plan with no source Ask and no authoring session is not ready and has no run option", () => {
    const result = selectNextPlan(input({
      plans: [plan("active-plan", "active"), plan("next-plan", "draft", { sourceAsks: [], authoringSession: null })]
    }));
    const check = result.preflight.find(c => c.check === "authorship_known")!;
    expect(check.status).toBe("unknown");
    expect(check.ok).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.card!.options.map(o => o.id)).toEqual(["resolve-blockers"]);
    expect(result.card!.verb).toBe("answer");
  });

  it("missing current run and session ids also leave authorship unknown", () => {
    const result = selectNextPlan(input({ currentRunId: null, currentSessionId: null, currentRunAsks: [] }));
    expect(result.preflight.find(c => c.check === "authorship_known")!.status).toBe("unknown");
    expect(result.card!.options.map(o => o.id)).toEqual(["resolve-blockers"]);
  });
});

describe("fail closed: a Project absent from activePlans has an UNKNOWN active Plan", () => {
  it("a queue entry alone is not a pointer: unknown, not ready, no run option", () => {
    const adapted = adaptQueue(queueWith([]), {});
    const result = selectNextPlan(input({
      queues: [{ project: "arcadia", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: null, activePlanWaitsOnOperator: null }],
      queueGlobal: adapted.global,
      activePlans: {}
    }));
    expect(result.preflight.find(c => c.check === "active_plan_known")!.status).toBe("unknown");
    expect(result.ready).toBe(false);
    expect(result.card!.options.map(o => o.id)).toEqual(["resolve-blockers"]);
  });

  it("another Project's pointer does not make this Project known", () => {
    const result = selectNextPlan(input({ activePlans: { "someone-else": "x" } }));
    expect(result.preflight.find(c => c.check === "active_plan_known")!.status).toBe("unknown");
    expect(result.ready).toBe(false);
  });

  it("an explicit null pointer means the Project has no active Plan and is allowed", () => {
    const adapted = adaptQueue(queueWith([]), { arcadia: null });
    const result = selectNextPlan(input({ queues: adapted.queues, queueGlobal: adapted.global, activePlans: { arcadia: null } }));
    expect(result.refusals.map(r => r.code)).not.toContain("project_has_active_plan");
    expect(result.preflight.find(c => c.check === "active_plan_known")!.status).toBe("pass");
    expect(result.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
  });

  it("an explicit slug is unchanged", () => {
    const result = selectNextPlan(input({ activePlans: { arcadia: "active-plan" } }));
    expect(result.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    expect(result.preflight.find(c => c.check === "active_plan_known")!.status).toBe("pass");
  });
});
