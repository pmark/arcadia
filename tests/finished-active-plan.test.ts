import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverDocs } from "../src/docs/discover.js";
import { resolveDispatch, resolveFinishedActivePlan } from "../src/docs/dispatch.js";
import { expectManagedDocumentsContract } from "./helpers/managedDocumentsContract.js";

/**
 * Issue #2147: the managed-documents contract accepts exactly the finished
 * active Plan a completion settlement leaves behind, and no other state in
 * which no current Action resolves. The settlement-driven proof lives in
 * agent-ask-complete.test.ts; these pin the boundary of the exception.
 */
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("resolveFinishedActivePlan", () => {
  it("accepts a complete active Plan with every Action done or deferred and no pointer", () => {
    const repo = fixture({ planStatus: "complete", statuses: ["done", "deferred"] });
    expect(resolveDispatch(repo, "demo").context).toBeNull();
    expect(resolveFinishedActivePlan(repo, "demo")).toEqual({ planSlug: "demo-plan", planPath: "docs/plans/demo-plan.md", blockers: [] });
    expectManagedDocumentsContract(repo, "demo");
  });

  it("explains a stale pointer in a draft Plan, which only reads as competing once PROJECT.md names no Action", () => {
    const repo = fixture({ planStatus: "complete", statuses: ["done", "done"], otherPlan: { status: "draft", pointer: true } });
    expect(resolveDispatch(repo, "demo").blockers.some((blocker) => blocker.relativePath === "docs/plans/other-plan.md")).toBe(true);
    expect(resolveFinishedActivePlan(repo, "demo")?.blockers).toEqual([]);
    expectManagedDocumentsContract(repo, "demo");
  });

  it("still fails when another active Plan holds a pointer", () => {
    const repo = fixture({ planStatus: "complete", statuses: ["done", "done"], otherPlan: { status: "active", pointer: true } });
    expect(resolveFinishedActivePlan(repo, "demo")?.blockers).toEqual([
      expect.objectContaining({ relativePath: "docs/plans/other-plan.md", field: "current_action" })
    ]);
    expect(() => expectManagedDocumentsContract(repo, "demo")).toThrow();
  });

  it("does not apply while the Plan still has an unfinished Action", () => {
    const repo = fixture({ planStatus: "complete", statuses: ["done", "open"] });
    expect(resolveFinishedActivePlan(repo, "demo")).toBeNull();
    expect(() => expectManagedDocumentsContract(repo, "demo")).toThrow();
  });

  it("does not apply to an active Plan that merely lost its pointer", () => {
    const repo = fixture({ planStatus: "active", statuses: ["done", "open"] });
    expect(resolveDispatch(repo, "demo").blockers).toEqual([expect.objectContaining({ field: "current_action" })]);
    expect(resolveFinishedActivePlan(repo, "demo")).toBeNull();
    expect(() => expectManagedDocumentsContract(repo, "demo")).toThrow();
  });

  it("counts a deferral Decision scoped to this Plan as finishing its open Action", () => {
    const repo = fixture({ planStatus: "complete", statuses: ["done", "open"], deferSecond: { plan: "demo-plan" } });
    expect(resolveFinishedActivePlan(repo, "demo")?.blockers).toEqual([]);
  });

  it("ignores a deferral Decision scoped to another Plan with the same Action id", () => {
    const repo = fixture({ planStatus: "complete", statuses: ["done", "open"], deferSecond: { plan: "other-plan" },
      otherPlan: { status: "draft", pointer: false, actionId: "second" } });
    expect(resolveFinishedActivePlan(repo, "demo")).toBeNull();
    expect(() => expectManagedDocumentsContract(repo, "demo")).toThrow();
  });

  it("ignores an unscoped deferral Decision when another Plan has the same Action id", () => {
    const repo = fixture({ planStatus: "complete", statuses: ["done", "open"], deferSecond: { plan: null },
      otherPlan: { status: "draft", pointer: false, actionId: "second" } });
    expect(resolveFinishedActivePlan(repo, "demo")).toBeNull();
  });

  it("does not apply while PROJECT.md still names an Action", () => {
    const repo = fixture({ planStatus: "complete", statuses: ["done", "done"], projectPointer: "first" });
    expect(resolveFinishedActivePlan(repo, "demo")).toBeNull();
    expect(() => expectManagedDocumentsContract(repo, "demo")).toThrow();
  });
});

function fixture(options: {
  planStatus: "active" | "complete";
  statuses: [string, string];
  projectPointer?: string;
  otherPlan?: { status: "draft" | "active"; pointer: boolean; actionId?: string };
  /** An approved Decision deferring `second`, scoped to `plan` (null: no `plan:` field). */
  deferSecond?: { plan: string | null };
}): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-finished-plan-"));
  roots.push(repo);
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Complete work safely.", "milestone: Completion", "active_plan: demo-plan",
    ...(options.projectPointer ? [`current_action: ${options.projectPointer}`] : []),
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n"), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc("demo-plan", options.planStatus, null, [["first", options.statuses[0]], ["second", options.statuses[1]]]), "utf8");
  if (options.otherPlan) {
    writeFileSync(path.join(repo, "docs/plans/other-plan.md"),
      planDoc("other-plan", options.otherPlan.status, options.otherPlan.pointer ? "other-one" : null,
        [[options.otherPlan.actionId ?? "other-one", "open"]]), "utf8");
  }
  if (options.deferSecond) {
    mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
    writeFileSync(path.join(repo, "docs/decisions/0057-defer-second.md"), [
      "---", "arcadia: v1", "type: decision", 'id: "0057"', "slug: defer-second", "project: demo",
      "status: approved", "question: Defer the second Action?", "confidence: high",
      ...(options.deferSecond.plan ? [`plan: ${options.deferSecond.plan}`] : []),
      "action: second", "answer: Defer until later", "decided: 2026-09-01",
      "options:", "  - label: Defer until later", "    consequence: The second Action stops dispatching.",
      "    recommended: true", "    effect: defer",
      "  - label: Keep it dispatchable", "    consequence: It keeps dispatching.", "    recommended: false",
      "updated: 2026-09-01", "---", "", "# Decision 0057: Defer the second Action?", ""
    ].join("\n"), "utf8");
  }
  // Every case must fail (or pass) on its pointer state, never on a malformed fixture.
  const discovered = discoverDocs(repo);
  expect(discovered.errors).toEqual([]);
  expect(discovered.rejected).toEqual([]);
  return repo;
}

function planDoc(slug: string, status: string, pointer: string | null, actions: Array<[string, string]>): string {
  return ["---", "arcadia: v1", "type: plan", `slug: ${slug}`, "project: demo", `status: ${status}`,
    "milestone: Completion", ...(pointer ? [`current_action: ${pointer}`] : []), "token_impact: medium",
    "token_budget: Deterministic completion with one accepted evidence pass.",
    "recommended_model: gpt-5.6-sol", "updated: 2026-09-01", "actions:",
    ...actions.flatMap(([id, actionStatus]) => [
      `  - id: ${id}`, `    title: Action ${id}`, `    status: ${actionStatus}`,
      "    responsibility: agent", "    effort: session", `    next_action: Finish ${id}.`,
      `    expected_artifact: Proof of ${id}`, "    clarification: clarified", "    confidence: high",
      "    acceptance_criteria:", `      - Proof of ${id} exists.`, "    depends_on: []", "    decisions: []", "    references: []"
    ]),
    "questions: []", "---", "", `# ${slug}`, ""].join("\n");
}
