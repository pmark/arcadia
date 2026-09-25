import { describe, expect, it } from "vitest";
import {
  classifyOperatorItems,
  operatorGateBlockers,
  type PendingAgentAskGateInput,
  type PendingDecisionGateInput
} from "../src/docs/operatorGate.js";

function decision(overrides: Partial<PendingDecisionGateInput> = {}): PendingDecisionGateInput {
  return {
    id: "0100",
    projectSlug: "demo",
    question: "Should we ship the fixture?",
    actionId: null,
    options: [{ label: "Ship it", consequence: "The fixture ships.", recommended: true }],
    updated: "2026-09-01",
    relativePath: "docs/decisions/0100-ship-the-fixture.md",
    ...overrides
  };
}

function ask(overrides: Partial<PendingAgentAskGateInput> = {}): PendingAgentAskGateInput {
  return {
    proposalId: "proposal-1",
    requestId: "request-1",
    projectSlug: "demo",
    desiredResult: "Amend the fixture Action.",
    actionIds: [],
    options: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

describe("classifyOperatorItems", () => {
  it("blocks on a Decision naming the selected Action, named exactly", () => {
    const result = classifyOperatorItems({
      projectSlug: "demo",
      selectedActionId: "define-contract",
      decisions: [decision({ id: "0100", actionId: "define-contract" })],
      agentAsks: []
    });

    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].id).toBe("0100");
    expect(result.blocking[0].kind).toBe("decision");
    expect(result.alerts).toHaveLength(0);
  });

  it("blocks on an Agent Ask naming the selected Action, named exactly", () => {
    const result = classifyOperatorItems({
      projectSlug: "demo",
      selectedActionId: "define-contract",
      decisions: [],
      agentAsks: [ask({ proposalId: "proposal-9", actionIds: ["define-contract"] })]
    });

    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].id).toBe("proposal-9");
    expect(result.blocking[0].kind).toBe("agent_ask");
    expect(result.alerts).toHaveLength(0);
  });

  it("treats a pending item naming a different Action as an alert, and dispatch is unaffected", () => {
    const result = classifyOperatorItems({
      projectSlug: "demo",
      selectedActionId: "define-contract",
      decisions: [decision({ id: "0101", actionId: "unrelated-action" })],
      agentAsks: [ask({ proposalId: "proposal-2", actionIds: ["also-unrelated"] })]
    });

    expect(result.blocking).toHaveLength(0);
    expect(result.alerts.map((item) => item.id).sort()).toEqual(["0101", "proposal-2"]);
  });

  it("adds neither section when there are no pending items", () => {
    const result = classifyOperatorItems({
      projectSlug: "demo",
      selectedActionId: "define-contract",
      decisions: [],
      agentAsks: []
    });

    expect(result.blocking).toHaveLength(0);
    expect(result.alerts).toHaveLength(0);
  });

  it("does not let a blocking item in one Project suppress dispatch for an unrelated Project", () => {
    const resultForProjectA = classifyOperatorItems({
      projectSlug: "project-a",
      selectedActionId: "define-contract",
      decisions: [decision({ id: "0102", projectSlug: "project-b", actionId: "define-contract" })],
      agentAsks: []
    });

    expect(resultForProjectA.blocking).toHaveLength(0);
    expect(resultForProjectA.alerts).toHaveLength(0);

    const resultForProjectB = classifyOperatorItems({
      projectSlug: "project-b",
      selectedActionId: "define-contract",
      decisions: [decision({ id: "0102", projectSlug: "project-b", actionId: "define-contract" })],
      agentAsks: []
    });

    expect(resultForProjectB.blocking).toHaveLength(1);
    expect(resultForProjectB.blocking[0].id).toBe("0102");
  });

  it("blocks on a Decision that is the reason no Action in the ready set is eligible, even when it names no Action the pointer selected", () => {
    const result = classifyOperatorItems({
      projectSlug: "demo",
      selectedActionId: "define-contract",
      blockingDecisionIds: ["0103"],
      decisions: [decision({ id: "0103", actionId: null })],
      agentAsks: []
    });

    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].id).toBe("0103");
  });
});

describe("operatorGateBlockers", () => {
  it("shapes a blocking item into the existing DispatchBlocker contract", () => {
    const result = classifyOperatorItems({
      projectSlug: "demo",
      selectedActionId: "define-contract",
      decisions: [decision({ id: "0104", actionId: "define-contract", relativePath: "docs/decisions/0104-ship-the-fixture.md" })],
      agentAsks: []
    });

    const blockers = operatorGateBlockers(result.blocking);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].relativePath).toBe("docs/decisions/0104-ship-the-fixture.md");
    expect(blockers[0].field).toBe("decision");
    expect(blockers[0].message).toContain("Ship it");
    expect(blockers[0].remedy).toContain("arcadia decision approve 0104");
  });
});
