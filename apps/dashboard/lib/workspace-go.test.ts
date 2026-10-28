import { describe, expect, it } from "vitest";
import type { ProjectContinuationResponse } from "./arcadia-cli";
import { createGoReadGate, goMove, goRelation, isContinuation } from "./workspace-go";

function continuation(overrides: Partial<ProjectContinuationResponse> = {}, responsibility = "agent"): ProjectContinuationResponse {
  return {
    context: {
      repoRoot: "/repo", projectSlug: "arcadia", projectName: "Arcadia", projectStatus: "active",
      activePlan: "go-plan", planPath: "docs/plans/go-plan.md", planStatus: "active", planTokenImpact: "medium", planTokenBudget: "",
      milestone: "Go orients one caller truthfully",
      action: {
        id: "reuse-go-context", title: "Reuse Go context", status: "open", responsibility, effort: "session",
        nextAction: "Bind continuation to the caller", expectedArtifact: "Evidence", clarification: "clarified", gapType: null,
        question: null, confidence: "high", source: null, dependsOn: [], acceptanceCriteria: ["REQ-004", "REQ-005"],
        decisions: [], references: [], execution: null, resolvedExecution: null
      },
      actionPath: "docs/plans/go-plan.md",
      requiredDecisions: [{ id: "d1", slug: "0144-scope", status: "answered", question: "Which scope?", resolved: true }],
      authorization: "A coding agent may implement this using normal repository authority."
    },
    blockers: [],
    operatorQuestion: null,
    dispatchable: true,
    projectId: "arcadia-id",
    repoRoot: "/repo",
    ...overrides
  };
}

describe("Go's move for the workspace", () => {
  it("renders Go's own dispatchable verdict as ready, with the Action's recorded details", () => {
    expect(goMove(continuation())).toEqual({
      kind: "ready", plan: "go-plan", milestone: "Go orients one caller truthfully",
      action: { id: "reuse-go-context", title: "Reuse Go context", next: "Bind continuation to the caller", artifact: "Evidence", acceptance: ["REQ-004", "REQ-005"], decisions: [{ slug: "0144-scope", question: "Which scope?", resolved: true }] }
    });
  });
  it("keeps Go's question and every blocker separate, each remedy with its own blocker", () => {
    const blockers = [
      { relativePath: "a.md", field: "depends_on", message: "Finish x first", remedy: "Complete x" },
      { relativePath: "b.md", field: "decisions", message: "Decision 0144 is open", remedy: "" }
    ];
    expect(goMove(continuation({ dispatchable: false, blockers, operatorQuestion: "Which scope?" }))).toMatchObject({
      kind: "gated", question: "Which scope?",
      blockers: [{ message: "Finish x first", remedy: "Complete x" }, { message: "Decision 0144 is open", remedy: null }]
    });
    expect(goMove(continuation({ dispatchable: false, operatorQuestion: "Which scope?" }))).toMatchObject({ kind: "gated", question: "Which scope?", blockers: [] });
  });
  it("says whose an unblocked Action is when it is not an agent's to take", () => {
    const authorization = "The operator must act, approve, or decide. A coding agent must not implement this.";
    const base = continuation({ dispatchable: false }, "requires_review");
    expect(goMove({ ...base, context: { ...base.context!, authorization } })).toMatchObject({ kind: "not-agent", responsibility: "requires_review", authorization });
  });
  it("reports no current Action without inventing one, keeping Go's question and blockers", () => {
    expect(goMove(continuation({ context: null, dispatchable: false }))).toEqual({ kind: "none", question: null, blockers: [] });
    expect(goMove(continuation({ context: null, dispatchable: false, operatorQuestion: "Choose the next Plan" }))).toMatchObject({ kind: "none", question: "Choose the next Plan" });
  });
  it("places the selection relative to Go's current work", () => {
    const move = goMove(continuation());
    expect(goRelation(move, { project: "arcadia" })).toBe("project");
    expect(goRelation(move, { project: "arcadia", plan: "go-plan" })).toBe("plan");
    expect(goRelation(move, { project: "arcadia", plan: "go-plan", action: "reuse-go-context" })).toBe("here");
    expect(goRelation(move, { project: "arcadia", plan: "go-plan", action: "other" })).toBe("same-plan");
    expect(goRelation(move, { project: "arcadia", plan: "draft-plan", action: "reuse-go-context" })).toBe("other-plan");
    expect(goRelation(goMove(continuation({ context: null })), { project: "arcadia", plan: "go-plan" })).toBe("project");
  });
  it("accepts only Go's resolution shape", () => {
    expect(isContinuation(continuation())).toBe(true);
    expect(isContinuation(continuation({ context: null, dispatchable: false }))).toBe(true);
    expect(isContinuation(null)).toBe(false);
    expect(isContinuation({ project: {} })).toBe(false);
    expect(isContinuation({ ...continuation(), dispatchable: "yes" })).toBe(false);
    expect(isContinuation({ ...continuation(), blockers: [{ remedy: "x" }] })).toBe(false);
    const base = continuation();
    expect(isContinuation({ ...base, context: { ...base.context!, action: undefined } })).toBe(false);
  });
});

describe("Go read gate", () => {
  it("starts one observer read per Project however often it is asked, including a doubled mount", () => {
    const gate = createGoReadGate(1000);
    expect(gate.begin("p", 0)).toBe(true);
    expect(gate.begin("p", 0)).toBe(false);
    expect(gate.begin("p", 0, true)).toBe(false);
    expect(gate.begin("q", 0)).toBe(true);
    gate.end("p", 10);
    expect(gate.begin("p", 500)).toBe(false);
    expect(gate.begin("p", 500, true)).toBe(true);
    gate.end("p", 600);
    expect(gate.begin("p", 1599)).toBe(false);
    expect(gate.begin("p", 1600)).toBe(true);
  });
});
