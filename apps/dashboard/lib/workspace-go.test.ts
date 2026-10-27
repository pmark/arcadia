import { describe, expect, it } from "vitest";
import type { ProjectContinuationResponse } from "./arcadia-cli";
import { goMove, goRelation } from "./workspace-go";

function continuation(overrides: Partial<ProjectContinuationResponse> = {}): ProjectContinuationResponse {
  return {
    context: {
      repoRoot: "/repo", projectSlug: "arcadia", projectName: "Arcadia", projectStatus: "active",
      activePlan: "go-plan", planPath: "docs/plans/go-plan.md", planStatus: "active", planTokenImpact: "medium", planTokenBudget: "",
      milestone: "Go orients one caller truthfully",
      action: {
        id: "reuse-go-context", title: "Reuse Go context", status: "open", responsibility: "agent", effort: "session",
        nextAction: "Bind continuation to the caller", expectedArtifact: "Evidence", clarification: "clarified", gapType: null,
        question: null, confidence: "high", source: null, dependsOn: [], acceptanceCriteria: ["REQ-004", "REQ-005"],
        decisions: [], references: [], execution: null, resolvedExecution: null
      },
      actionPath: "docs/plans/go-plan.md",
      requiredDecisions: [{ id: "d1", slug: "0144-scope", status: "open", question: "Which scope?", resolved: false }],
      authorization: "operator"
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
      action: { id: "reuse-go-context", title: "Reuse Go context", next: "Bind continuation to the caller", artifact: "Evidence", acceptance: ["REQ-004", "REQ-005"], decisions: [{ slug: "0144-scope", question: "Which scope?", resolved: false }] }
    });
  });
  it("names Go's exact gate: the operator question first, else the first blocker and its remedy", () => {
    const blockers = [{ relativePath: "PROJECT.md", field: "current_action", message: "Action is blocked", remedy: "Resolve the blocker" }];
    expect(goMove(continuation({ dispatchable: false, blockers }))).toMatchObject({ kind: "gated", reason: "Action is blocked", remedy: "Resolve the blocker" });
    expect(goMove(continuation({ dispatchable: false, blockers, operatorQuestion: "Approve the scope?" }))).toMatchObject({ kind: "gated", reason: "Approve the scope?", remedy: "Resolve the blocker" });
    expect(goMove(continuation({ dispatchable: false }))).toMatchObject({ kind: "gated", reason: "Go reports this Action is not ready to dispatch.", remedy: null });
  });
  it("reports no current Action without inventing one", () => {
    expect(goMove(continuation({ context: null, dispatchable: false }))).toEqual({ kind: "none", reason: "Go found no current Action for this Project.", remedy: null });
    expect(goMove(continuation({ context: null, dispatchable: false, operatorQuestion: "Choose the next Plan" }))).toMatchObject({ kind: "none", reason: "Choose the next Plan" });
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
});
