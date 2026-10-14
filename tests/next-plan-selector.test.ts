import { describe, expect, it } from "vitest";
import { validateDecisionCard } from "../src/decisions/card.js";
import { selectNextPlan, type SelectorInput } from "../src/plans/nextPlanSelector.js";

const NOW = "2026-10-14T00:00:00.000Z";
const EXPIRES = "2026-10-15T00:00:00.000Z";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

function base(overrides: Partial<SelectorInput> = {}): SelectorInput {
  return {
    preferences: [{ project: "arcadia", included: true, chosenPlan: "next-plan" }],
    plans: [
      { project: "arcadia", slug: "active-plan", status: "active", approvalReceipt: "plan-status:active", sourceAsks: [], authoringSession: "s-old" },
      { project: "arcadia", slug: "next-plan", status: "draft", approvalReceipt: "settle-1", sourceAsks: ["ask-old"], authoringSession: "s-old" }
    ],
    queues: [{ project: "arcadia", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: "active-plan", activePlanWaitsOnOperator: true }],
    closeOuts: [],
    redAlerts: [],
    currentRunId: "run-now",
    currentSessionId: "s-now",
    currentRunAsks: ["ask-now"],
    onlyProject: null,
    headSha: "f46031d62aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    now: NOW,
    expires: EXPIRES,
    ...overrides
  };
}

describe("selectNextPlan", () => {
  it("honours Decision 0116: a waiting active Plan still gets its NEXT Plan chosen", () => {
    const result = selectNextPlan(base());
    expect(result.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    expect(result.reasons.join(" ")).toContain("Decision 0116");
    expect(result.reasons.join(" ")).toContain("waits on the operator");
    expect(result.ready).toBe(true);
    expect(result.refusals.find(r => r.plan === "active-plan")?.code).toBe("plan_not_in_project_preference");
  });

  it("does not implement the opposite (skip the Project while its active Plan waits)", () => {
    const result = selectNextPlan(base());
    expect(result.chosen).not.toBeNull();
    expect(result.refusals.map(r => r.code)).not.toContain("project_not_included");
    expect(result.preflight.find(c => c.check === "previous_plan_closed_out")?.status).toBe("pass");
  });

  it("emits a card that validates with policy_match null and pins", () => {
    const result = selectNextPlan(base());
    expect(result.cardErrors).toEqual([]);
    expect(result.card).not.toBeNull();
    const check = validateDecisionCard(result.card, { now: new Date(NOW) });
    expect(check.ok).toBe(true);
    expect(result.card!.policy_match).toBeNull();
    expect(result.card!.verb).toBe("run");
    expect(result.card!.pins.stateHash).toBe(result.stateHash);
    expect(result.card!.pins.previewFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.card!.options.find(o => o.id === "run-plan")!.consequence).toContain("changed nothing");
    expect(result.card!.evidence.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a Plan authored in this run by source Ask, run id and session", () => {
    const byAsk = selectNextPlan(base({ plans: base().plans.map(p => p.slug === "next-plan" ? { ...p, sourceAsks: ["ask-now"] } : p) }));
    expect(byAsk.chosen).toBeNull();
    expect(byAsk.refusals.some(r => r.code === "plan_authored_in_this_run")).toBe(true);
    const byRunId = selectNextPlan(base({ plans: base().plans.map(p => p.slug === "next-plan" ? { ...p, sourceAsks: ["run-now"] } : p) }));
    expect(byRunId.refusals.some(r => r.code === "plan_authored_in_this_run")).toBe(true);
    const bySession = selectNextPlan(base({ plans: base().plans.map(p => p.slug === "next-plan" ? { ...p, authoringSession: "s-now" } : p) }));
    expect(bySession.refusals.some(r => r.code === "plan_authored_in_this_run")).toBe(true);
    expect(bySession.card!.verb).toBe("answer");
  });

  it("refuses a Plan the operator has not approved, even with a forged approved field", () => {
    const forged = { project: "arcadia", slug: "next-plan", status: "draft", approvalReceipt: null, sourceAsks: ["a"], authoringSession: "s", approved: true, approval: "yes" };
    const result = selectNextPlan(base({ plans: [forged] }));
    expect(result.chosen).toBeNull();
    expect(result.refusals.map(r => r.code)).toContain("plan_not_approved");
    const blank = selectNextPlan(base({ plans: [{ ...forged, approvalReceipt: "   " }] }));
    expect(blank.refusals.map(r => r.code)).toContain("plan_not_approved");
  });

  it("refuses a Project outside the preference record and a Plan outside the chosen one", () => {
    const excluded = selectNextPlan(base({ preferences: [{ project: "arcadia", included: false, chosenPlan: "next-plan" }] }));
    expect(excluded.chosen).toBeNull();
    expect(excluded.refusals.map(r => r.code)).toContain("project_not_included");
    const none = selectNextPlan(base({ preferences: [{ project: "arcadia", included: true, chosenPlan: null }] }));
    expect(none.refusals.map(r => r.code)).toContain("no_candidate_plan");
  });

  it("scopes slugs to their Project when two Projects share a Plan slug", () => {
    const input = base({
      preferences: [{ project: "beta", included: true, chosenPlan: "next-plan" }],
      plans: [
        ...base().plans,
        { project: "beta", slug: "next-plan", status: "draft", approvalReceipt: null, sourceAsks: ["b"], authoringSession: "s" }
      ]
    });
    const result = selectNextPlan(input);
    expect(result.chosen).toBeNull();
    expect(result.refusals.some(r => r.project === "beta" && r.code === "plan_not_approved")).toBe(true);
  });

  it("refuses path-traversal-looking slugs without echoing them into the card", () => {
    const result = selectNextPlan(base({
      preferences: [{ project: "arcadia", included: true, chosenPlan: "../../etc/passwd" }],
      plans: [{ project: "arcadia", slug: "../../etc/passwd", status: "active", approvalReceipt: "x", sourceAsks: ["a"], authoringSession: "s" }]
    }));
    expect(result.chosen).toBeNull();
    expect(result.refusals.map(r => r.code)).toContain("no_candidate_plan");
    expect(JSON.stringify(result.card)).not.toContain("etc/passwd");
  });

  it("does not offer a closed previous Plan as its own successor", () => {
    const result = selectNextPlan(base({
      closeOuts: [{ project: "arcadia", plan: "next-plan", closed: true, openRemainders: [], evidence: "complete" }]
    }));
    expect(result.chosen).toBeNull();
    expect(result.refusals.map(r => r.code)).toContain("no_candidate_plan");
  });

  it("breaks ties by preference order, then slug, deterministically", () => {
    const plans = [
      ...base().plans,
      { project: "beta", slug: "beta-plan", status: "draft", approvalReceipt: "r", sourceAsks: ["b"], authoringSession: "s" }
    ];
    const queues = [...base().queues!, { project: "beta", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: null, activePlanWaitsOnOperator: false }];
    const both = [
      { project: "beta", included: true, chosenPlan: "beta-plan" },
      { project: "arcadia", included: true, chosenPlan: "next-plan" }
    ];
    const first = selectNextPlan(base({ plans, queues, preferences: both }));
    expect(first.chosen).toEqual({ project: "beta", plan: "beta-plan" });
    const swapped = selectNextPlan(base({ plans, queues, preferences: [both[1], both[0]] }));
    expect(swapped.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    expect(first.reasons.join(" ")).toContain("ties break");
  });

  it("returns the selection with a named blocker and one-click remedy when preflight fails, without mutating", () => {
    const input = deepFreeze(base({
      queues: [{ project: "arcadia", orderValid: false, unpositionedCount: 2, runningActions: ["arcadia/x"], activePlan: "active-plan", activePlanWaitsOnOperator: true }],
      redAlerts: [{ id: "alert-1", project: "arcadia" }]
    }));
    const result = selectNextPlan(input);
    expect(result.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    expect(result.ready).toBe(false);
    const failed = result.preflight.filter(c => !c.ok);
    expect(failed.map(c => c.check)).toEqual(expect.arrayContaining(["queue_order_valid", "no_open_red_alert", "pointer_free"]));
    for (const check of failed) {
      expect(check.blocker).toBeTruthy();
      expect(check.remedy).toMatch(/^Open \/(actions|work-queue|production)|^No one-click control exists yet/);
    }
  });

  it("reports close-out absent as a failure with the close-out remedy and evidence none as unknown", () => {
    const queues = [{ project: "arcadia", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: "active-plan", activePlanWaitsOnOperator: false }];
    const absent = selectNextPlan(base({ queues }));
    const check = absent.preflight.find(c => c.check === "previous_plan_closed_out")!;
    expect(check.status).toBe("fail");
    expect(check.remedy).toMatch(/^No one-click control exists yet: plan close-out/);
    const open = selectNextPlan(base({ queues, closeOuts: [{ project: "arcadia", plan: "active-plan", closed: false, openRemainders: [{ id: "r1", status: "todo" }], evidence: "partial" }] }));
    expect(open.preflight.find(c => c.check === "previous_plan_closed_out")!.blocker).toContain("r1");
    const unknown = selectNextPlan(base({ queues, closeOuts: [{ project: "arcadia", plan: "active-plan", closed: true, openRemainders: [], evidence: "none" }] }));
    const unk = unknown.preflight.find(c => c.check === "previous_plan_closed_out")!;
    expect(unk.status).toBe("unknown");
    expect(unk.ok).toBe(false);
  });

  it("treats an unreadable queue as unknown, never a pass", () => {
    const result = selectNextPlan(base({ queues: null }));
    expect(result.preflight.find(c => c.check === "queue_order_valid")!.status).toBe("unknown");
    expect(result.ready).toBe(false);
  });

  it("handles an empty Projects list as a refusal with an answer card", () => {
    const result = selectNextPlan(base({ preferences: [], plans: [] }));
    expect(result.chosen).toBeNull();
    expect(result.refusals[0].code).toBe("no_candidate_plan");
    expect(result.card!.verb).toBe("answer");
    expect(result.card!.policy_match).toBeNull();
  });

  it("never uses titles: hostile text cannot reach the card or refusals", () => {
    const hostile = "evil\n‮title <script>alert(1)</script>";
    const plans = base().plans.map(p => ({ ...p, title: hostile }));
    const result = selectNextPlan(base({ plans: plans }));
    expect(result.card).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain("script");
  });

  it("gives identical card and hash for identical input and does not mutate it", () => {
    const input = deepFreeze(base());
    const a = selectNextPlan(input);
    const b = selectNextPlan(input);
    expect(a).toEqual(b);
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.card!.pins.previewFingerprint).toBe(b.card!.pins.previewFingerprint);
  });

  it("changes the state hash when an input changes but not when only the clock does", () => {
    const a = selectNextPlan(base());
    const clock = selectNextPlan(base({ now: "2026-10-14T01:00:00.000Z", expires: "2026-10-16T00:00:00.000Z" }));
    expect(clock.stateHash).toBe(a.stateHash);
    const changed = selectNextPlan(base({ redAlerts: [{ id: "z", project: "arcadia" }] }));
    expect(changed.stateHash).not.toBe(a.stateHash);
  });
});
