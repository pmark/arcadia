import { describe, expect, it } from "vitest";
import {
  adaptQueue, adaptRedAlerts, selectNextPlan, type LiveQueue, type LiveQueueEntry, type SelectorInput
} from "../src/plans/nextPlanSelector.js";

// Fixture copied from the field names of `arcadia advance queue --json` (AgentQueue / AgentQueueEntry):
// the live invalid state is 15 unpositioned Actions of private-practice-now while arcadia is positioned.
const entry = (project: string, action: string, orderStatus: string, position: number | null, state = "ready", attentionKind: string | null = null): LiveQueueEntry =>
  ({ projectSlug: project, actionId: action, state, attentionKind, orderStatus, position, selected: false });

const ppnEntries = Array.from({ length: 15 }, (_, i) => entry("private-practice-now", `ppn-action-${i + 1}`, "unpositioned", null));
const liveQueue: LiveQueue = {
  orderValid: false,
  unpositionedCount: 15,
  nextActionKey: "arcadia/next-plan-selector",
  ordered: [entry("arcadia", "next-plan-selector", "explicit", 1), ...ppnEntries],
  ready: [entry("arcadia", "next-plan-selector", "explicit", 1)],
  running: [entry("arcadia", "other-action", "explicit", 2, "running")],
  flagged: [],
  attention: [{ ...entry("arcadia", "operator-gated", "explicit", 3, "attention", "decision"), planSlug: "active-plan" }]
};

function input(overrides: Partial<SelectorInput> = {}): SelectorInput {
  const adapted = adaptQueue(liveQueue, { arcadia: "active-plan" });
  return {
    preferences: [{ project: "arcadia", included: true, chosenPlan: "next-plan", receipt: "pref-1" }],
    plans: [
      { project: "arcadia", slug: "active-plan", status: "active", onMain: true, sourceAsks: [], authoringSession: "s-old" },
      { project: "arcadia", slug: "next-plan", status: "draft", onMain: true, sourceAsks: ["ask-old"], authoringSession: "s-old" }
    ],
    queues: adapted.queues,
    queueGlobal: adapted.global,
    closeOuts: [],
    redAlerts: [],
    currentRunId: "run-now",
    currentSessionId: "s-now",
    currentRunAsks: [],
    onlyProject: null,
    headSha: null,
    now: "2026-10-14T00:00:00.000Z",
    expires: "2026-10-15T00:00:00.000Z",
    ...overrides
  };
}

describe("adaptQueue", () => {
  it("reports 15 unpositioned entries of another Project and an invalid global order", () => {
    const { queues, global } = adaptQueue(liveQueue, { arcadia: "active-plan" });
    expect(global).toEqual({ orderValid: false, unpositionedCount: 15, unpositionedProjects: ["private-practice-now"] });
    const ppn = queues.find(q => q.project === "private-practice-now")!;
    expect(ppn.orderValid).toBe(false);
    expect(ppn.unpositionedCount).toBe(15);
    const arcadia = queues.find(q => q.project === "arcadia")!;
    // The global flag is false, so every Project is invalid even with no entry of its own unpositioned.
    expect(arcadia.orderValid).toBe(false);
    expect(arcadia.unpositionedCount).toBe(0);
    expect(arcadia.runningActions).toEqual(["arcadia/other-action"]);
    expect(arcadia.activePlan).toBe("active-plan");
    expect(arcadia.activePlanWaitsOnOperator).toBe(true);
  });

  it("is valid when the global flag is true and nothing is unpositioned", () => {
    const valid: LiveQueue = { ...liveQueue, orderValid: true, unpositionedCount: 0, ordered: [entry("arcadia", "a", "explicit", 1)], running: [], attention: [] };
    const { queues, global } = adaptQueue(valid);
    expect(global.orderValid).toBe(true);
    expect(queues).toEqual([{ project: "arcadia", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: null, activePlanWaitsOnOperator: null }]);
  });

  it("does not mutate its input", () => {
    const copy = JSON.stringify(liveQueue);
    adaptQueue(liveQueue);
    expect(JSON.stringify(liveQueue)).toBe(copy);
  });
});

describe("adaptRedAlerts", () => {
  it("maps listOpenRedAlerts rows", () => {
    expect(adaptRedAlerts([{ id: "a1", projectSlug: "arcadia", trigger: "session_stalled" }]))
      .toEqual([{ id: "a1", project: "arcadia", trigger: "session_stalled" }]);
  });
});

describe("selector with the live queue", () => {
  it("fails queue_order_valid naming the count and Projects, still returning the selection", () => {
    const result = selectNextPlan(input());
    expect(result.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    const check = result.preflight.find(c => c.check === "queue_order_valid")!;
    expect(check.status).toBe("fail");
    expect(check.blocker).toContain("15 unpositioned");
    expect(check.blocker).toContain("private-practice-now");
    expect(check.remedy).toContain("/work-queue");
    expect(result.ready).toBe(false);
  });

  it("reports a failed live queue reader as unknown with the error class, never a pass", () => {
    const result = selectNextPlan(input({ queues: null, queueGlobal: null, liveErrors: { queue: "WorkspaceNotReadyError" } }));
    const check = result.preflight.find(c => c.check === "queue_order_valid")!;
    expect(check.status).toBe("unknown");
    expect(check.ok).toBe(false);
    expect(check.blocker).toContain("WorkspaceNotReadyError");
  });

  it("reports unreadable red alerts as unknown with the error class", () => {
    const result = selectNextPlan(input({ redAlerts: null, liveErrors: { redAlerts: "SqliteError" } }));
    const check = result.preflight.find(c => c.check === "no_open_red_alert")!;
    expect(check.status).toBe("unknown");
    expect(check.blocker).toContain("SqliteError");
  });

  it("gives the production-off control for scope alerts and an honest gap for the rest", () => {
    const scoped = selectNextPlan(input({ redAlerts: [{ id: "r1", project: "arcadia", trigger: "scope_pointer_mismatch" }] }));
    expect(scoped.preflight.find(c => c.check === "no_open_red_alert")!.remedy).toContain("/production");
    const stalled = selectNextPlan(input({ redAlerts: [{ id: "r2", project: "arcadia", trigger: "session_stalled" }] }));
    expect(stalled.preflight.find(c => c.check === "no_open_red_alert")!.remedy).toMatch(/^No one-click control exists yet/);
  });
});
