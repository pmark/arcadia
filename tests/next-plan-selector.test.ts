import { describe, expect, it } from "vitest";
import { validateDecisionCard } from "../src/decisions/card.js";
import { selectNextPlan, type PlanSummary, type SelectorInput } from "../src/plans/nextPlanSelector.js";

const NOW = "2026-10-14T00:00:00.000Z";
const EXPIRES = "2026-10-15T00:00:00.000Z";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

const plan = (project: string, slug: string, status: string, extra: Partial<PlanSummary> = {}): PlanSummary =>
  ({ project, slug, status, sourceAsks: ["ask-old"], authoringSession: "s-old", onMain: true, ...extra });

function base(overrides: Partial<SelectorInput> = {}): SelectorInput {
  return {
    preferences: [{ project: "arcadia", included: true, chosenPlan: "next-plan", receipt: "pref-receipt-1" }],
    plans: [plan("arcadia", "active-plan", "active", { sourceAsks: [] }), plan("arcadia", "next-plan", "draft")],
    queues: [{ project: "arcadia", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: "active-plan", activePlanWaitsOnOperator: true }],
    closeOuts: [],
    redAlerts: [],
    currentRunId: "run-now",
    currentSessionId: "s-now",
    currentRunAsks: ["ask-now"],
    onlyProject: null,
    headSha: "f46031d62aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    inputSources: { preferences: "live", queue: "live", redAlerts: "live", runId: "live", sessionId: "live", runAsks: "live" },
    now: NOW,
    expires: EXPIRES,
    ...overrides
  };
}

describe("selectNextPlan", () => {
  it("honours Decision 0116: a waiting active Plan still gets its NEXT draft Plan chosen", () => {
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

  it("M3: refuses the next Plan while the Project's active Plan is NOT waiting on the operator", () => {
    const queues = [{ project: "arcadia", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: "active-plan", activePlanWaitsOnOperator: false }];
    const result = selectNextPlan(base({ queues }));
    expect(result.chosen).toBeNull();
    expect(result.refusals.map(r => r.code)).toContain("project_has_active_plan");
  });

  it("M3: choosing the Project's own active Plan is not refused as a second active Plan", () => {
    const result = selectNextPlan(base({ preferences: [{ project: "arcadia", included: true, chosenPlan: "active-plan", receipt: "r" }] }));
    expect(result.chosen).toEqual({ project: "arcadia", plan: "active-plan" });
  });

  it("emits an advisory run card that validates, with policy_match null, pins and the real activation path", () => {
    const result = selectNextPlan(base());
    expect(result.cardErrors).toEqual([]);
    const check = validateDecisionCard(result.card, { now: new Date(NOW) });
    expect(check.ok).toBe(true);
    const card = result.card!;
    expect(card.policy_match).toBeNull();
    expect(card.verb).toBe("run");
    expect(card.what).toMatch(/^Advisory/);
    expect(card.pins.stateHash).toBe(result.stateHash);
    expect(card.pins.previewFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const run = card.options.find(o => o.id === "run-plan")!;
    expect(run.consequence).toContain("Preview only: pressing grants nothing and starts nothing");
    expect(run.consequence).toContain("agent-ask settle --activate");
    expect(run.consequence).toContain("PROJECT.md active_plan");
    expect(card.evidence.some(e => e.label.includes("Preflight") && e.label.includes("pass"))).toBe(true);
  });

  it("B1: a not-ready selection has no run option, is verb answer, and carries its preflight in the card and hash", () => {
    const failing = base({ redAlerts: [{ id: "alert-1", project: "arcadia", trigger: "session_stalled" }] });
    const result = selectNextPlan(failing);
    expect(result.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    expect(result.ready).toBe(false);
    const card = result.card!;
    expect(card.verb).toBe("answer");
    expect(card.options).toHaveLength(1);
    expect(card.options[0].label).toBe("Resolve the named blockers first");
    expect(card.options[0].consequence).toMatch(/^No change: no_open_red_alert:fail; remedy: /);
    expect(card.options.map(o => o.id)).not.toContain("run-plan");
    expect(card.evidence.map(e => e.label).join("|")).toContain("Preflight no_open_red_alert: fail");
    expect(card.evidence.map(e => e.label).join("|")).toContain("Ready: false");
    // The preflight is part of the pin: a card cannot be separated from it.
    const ok = selectNextPlan(base());
    expect(result.stateHash).not.toBe(ok.stateHash);
  });

  it("B1: unknown preflight counts as not ready (no run option)", () => {
    const result = selectNextPlan(base({ queues: null }));
    expect(result.ready).toBe(false);
    expect(result.card!.options.map(o => o.id)).toEqual(["resolve-blockers"]);
  });

  it("refuses a Plan authored in this run by source Ask, run id and session", () => {
    const withPlan = (extra: Partial<PlanSummary>) => base({ plans: [plan("arcadia", "next-plan", "draft", extra)] });
    const byAsk = selectNextPlan(withPlan({ sourceAsks: ["ask-now"] }));
    expect(byAsk.chosen).toBeNull();
    expect(byAsk.refusals.some(r => r.code === "plan_authored_in_this_run")).toBe(true);
    expect(selectNextPlan(withPlan({ sourceAsks: ["run-now"] })).refusals.some(r => r.code === "plan_authored_in_this_run")).toBe(true);
    const bySession = selectNextPlan(withPlan({ authoringSession: "s-now" }));
    expect(bySession.refusals.some(r => r.code === "plan_authored_in_this_run")).toBe(true);
    expect(bySession.card!.verb).toBe("answer");
  });

  it("M1: refuses a chosen Plan without an approval receipt, even when its status is active or a forged field says approved", () => {
    const noReceipt = selectNextPlan(base({
      preferences: [{ project: "arcadia", included: true, chosenPlan: "next-plan", receipt: null }]
    }));
    expect(noReceipt.chosen).toBeNull();
    expect(noReceipt.refusals.map(r => r.code)).toContain("plan_not_approved");
    const active = selectNextPlan(base({
      preferences: [{ project: "arcadia", included: true, chosenPlan: "active-plan", receipt: null }]
    }));
    expect(active.refusals.map(r => r.code)).toContain("plan_not_approved");
    const forged = { project: "arcadia", included: true, chosenPlan: "next-plan", receipt: "   ", approved: true, approvalReceipt: "x" };
    const blank = selectNextPlan(base({ preferences: [forged] }));
    expect(blank.refusals.map(r => r.code)).toContain("plan_not_approved");
    const forgedPlan = { ...plan("arcadia", "next-plan", "active"), approved: true, approvalReceipt: "plan-status:active" };
    const planForged = selectNextPlan(base({
      plans: [forgedPlan],
      preferences: [{ project: "arcadia", included: true, chosenPlan: "next-plan", receipt: null }]
    }));
    expect(planForged.refusals.map(r => r.code)).toContain("plan_not_approved");
  });

  it("M1: a draft Plan named with a receipt is eligible (the NEXT Plan to be activated)", () => {
    const result = selectNextPlan(base());
    expect(result.chosen!.plan).toBe("next-plan");
    expect(result.reasons.join(" ")).toContain("pref-receipt-1");
  });

  it("refuses a Project outside the preference record and a Plan outside the chosen one", () => {
    const excluded = selectNextPlan(base({ preferences: [{ project: "arcadia", included: false, chosenPlan: "next-plan", receipt: "r" }] }));
    expect(excluded.chosen).toBeNull();
    expect(excluded.refusals.map(r => r.code)).toContain("project_not_included");
    const none = selectNextPlan(base({ preferences: [{ project: "arcadia", included: true, chosenPlan: null, receipt: null }] }));
    expect(none.refusals.map(r => r.code)).toContain("no_candidate_plan");
  });

  it("scopes slugs to their Project when two Projects share a Plan slug", () => {
    const result = selectNextPlan(base({
      preferences: [{ project: "beta", included: true, chosenPlan: "next-plan", receipt: null }],
      plans: [...base().plans, plan("beta", "next-plan", "draft", { sourceAsks: ["b"] })]
    }));
    expect(result.chosen).toBeNull();
    expect(result.refusals.some(r => r.project === "beta" && r.code === "plan_not_approved")).toBe(true);
  });

  it("refuses path-traversal-looking slugs without echoing them into the card", () => {
    const result = selectNextPlan(base({
      preferences: [{ project: "arcadia", included: true, chosenPlan: "../../etc/passwd", receipt: "r" }],
      plans: [plan("arcadia", "../../etc/passwd", "active")]
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
    const plans = [...base().plans, plan("beta", "beta-plan", "draft", { sourceAsks: ["b"] })];
    const queues = [...base().queues!, { project: "beta", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: null, activePlanWaitsOnOperator: false }];
    const both = [
      { project: "beta", included: true, chosenPlan: "beta-plan", receipt: "rb" },
      { project: "arcadia", included: true, chosenPlan: "next-plan", receipt: "ra" }
    ];
    const first = selectNextPlan(base({ plans, queues, preferences: both }));
    expect(first.chosen).toEqual({ project: "beta", plan: "beta-plan" });
    const swapped = selectNextPlan(base({ plans, queues, preferences: [both[1], both[0]] }));
    expect(swapped.chosen).toEqual({ project: "arcadia", plan: "next-plan" });
    expect(first.reasons.join(" ")).toContain("ties break");
  });

  it("returns the selection with a named blocker and remedy when preflight fails, without mutating", () => {
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

  it("reports close-out absent as a failure and evidence none as unknown", () => {
    const queues = [{ project: "arcadia", orderValid: true, unpositionedCount: 0, runningActions: [], activePlan: "closing-plan", activePlanWaitsOnOperator: false }];
    const plans = [...base().plans, plan("arcadia", "closing-plan", "complete")];
    const absent = selectNextPlan(base({ queues, plans }));
    const check = absent.preflight.find(c => c.check === "previous_plan_closed_out")!;
    expect(check.status).toBe("fail");
    expect(check.remedy).toMatch(/^No one-click control exists yet: plan close-out/);
    const open = selectNextPlan(base({ queues, plans, closeOuts: [{ project: "arcadia", plan: "closing-plan", closed: false, openRemainders: [{ id: "r1", status: "todo" }], evidence: "partial" }] }));
    expect(open.preflight.find(c => c.check === "previous_plan_closed_out")!.blocker).toContain("r1");
    const unknown = selectNextPlan(base({ queues, plans, closeOuts: [{ project: "arcadia", plan: "closing-plan", closed: true, openRemainders: [], evidence: "none" }] }));
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
    const plans = base().plans.map(p => ({ ...p, title: "evil\n‮title <script>alert(1)</script>" }));
    const result = selectNextPlan(base({ plans: plans }));
    expect(result.card).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain("script");
  });

  it("M2: lists every input's provenance, gaps for caller-supplied inputs, and pins them in the hash", () => {
    const live = selectNextPlan(base());
    expect(live.inputs.map(i => i.name)).toEqual(["preferences", "queue", "redAlerts", "runId", "sessionId", "runAsks"]);
    const caller = selectNextPlan(base({ inputSources: { preferences: "caller", queue: "live", redAlerts: "caller", runId: "live", sessionId: "live", runAsks: "live" } }));
    expect(caller.inputs.find(i => i.name === "preferences")!.source).toBe("caller");
    expect(caller.gaps.join(" ")).toContain("preferences are caller-supplied and unverified: no operator preference store exists yet");
    expect(caller.gaps.join(" ")).toContain("redAlerts");
    expect(caller.stateHash).not.toBe(live.stateHash);
    expect(caller.card!.evidence.map(e => e.label).join("|")).toContain("Caller-supplied inputs (unverified)");
    expect(live.gaps).toEqual([]);
  });

  it("gives identical card and hash for identical input and does not mutate it", () => {
    const input = deepFreeze(base());
    const a = selectNextPlan(input);
    const b = selectNextPlan(input);
    expect(a).toEqual(b);
    expect(a.card!.pins.previewFingerprint).toBe(b.card!.pins.previewFingerprint);
  });

  it("keeps the clock out of the state hash (expires derives from the injected now)", () => {
    const a = selectNextPlan(base());
    const clock = selectNextPlan(base({ now: "2026-10-14T01:00:00.000Z", expires: "2026-10-16T00:00:00.000Z" }));
    expect(clock.stateHash).toBe(a.stateHash);
    expect(selectNextPlan(base({ redAlerts: [{ id: "z", project: "arcadia" }] })).stateHash).not.toBe(a.stateHash);
  });

  it("omits the url for a Plan not on main rather than linking a 404", () => {
    const off = selectNextPlan(base({ plans: [plan("arcadia", "active-plan", "active", { sourceAsks: [] }), plan("arcadia", "next-plan", "draft", { onMain: false })] }));
    const evidence = off.card!.evidence.find(e => e.label.includes("docs/plans/next-plan.md"))!;
    expect(evidence).toBeDefined();
    expect(evidence.url).toBeUndefined();
    const on = selectNextPlan(base());
    expect(on.card!.evidence.find(e => e.label.includes("docs/plans/next-plan.md"))!.url).toContain("blob/main/docs/plans/next-plan.md");
  });
});
