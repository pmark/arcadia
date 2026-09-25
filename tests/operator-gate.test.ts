import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOperatorGate } from "../src/ask/operatorGate.js";
import { withReadOnlyDatabase } from "../src/db/connection.js";
import { resolveReadySet } from "../src/docs/dispatch.js";
import {
  classifyOperatorItems,
  operatorGateBlockers,
  type PendingAgentAskGateInput,
  type PendingDecisionGateInput
} from "../src/docs/operatorGate.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

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

  it("single-quotes a recommended answer label so an embedded quote cannot break or extend the shell command", () => {
    const result = classifyOperatorItems({
      projectSlug: "demo",
      selectedActionId: "define-contract",
      decisions: [
        decision({
          id: "0105",
          actionId: "define-contract",
          options: [{ label: `Ship it; rm -rf /tmp && echo 'done'`, consequence: "Adversarial label.", recommended: true }]
        })
      ],
      agentAsks: []
    });

    const [blocker] = operatorGateBlockers(result.blocking);
    expect(blocker.remedy).toBe(
      "arcadia decision approve 0105 --project demo --answer 'Ship it; rm -rf /tmp && echo '\\''done'\\'''"
    );
  });
});

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function tempRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-operator-gate-"));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function projectDoc(): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Prove the ready-set scoping.", "milestone: Prove it", "active_plan: main-plan",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

function planDoc(options: { shipItStatus?: "open" | "done"; currentAction?: string } = {}): string {
  return [
    "---", "arcadia: v1", "type: plan", "slug: main-plan", "project: demo", "status: active",
    "milestone: Prove it", `current_action: ${options.currentAction ?? "ship-it"}`, "token_impact: medium",
    "token_budget: One bounded pass.", "recommended_model: gpt-5.6-sol", "updated: 2026-09-01",
    "actions:",
    "  - id: ship-it", "    title: Ship the ready thing", `    status: ${options.shipItStatus ?? "open"}`, "    responsibility: agent",
    "    effort: session", "    next_action: Ship it.", "    expected_artifact: A ship receipt",
    "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - It ships.", "    depends_on: []", "    decisions: []",
    "    references: []",
    "  - id: second-step", "    title: Take the blocked second step", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Take the second step.",
    "    expected_artifact: A second receipt", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - The second step happens.", "    depends_on: []",
    "    decisions: [\"0001\"]", "    references: []",
    "questions: []", "---", "", "# Main plan", ""
  ].join("\n");
}

function blockingDecisionDoc(): string {
  return ["---", "arcadia: v1", "type: decision", "id: \"0001\"", "slug: block-second-step",
    "project: demo", "status: open", "question: Should the second step proceed?",
    "updated: 2026-09-01", "---", "", "# Decision", ""].join("\n");
}

describe("resolveOperatorGate ready-set scoping", () => {
  it("does not treat a Decision blocking one unready candidate as the reason nothing is eligible when another candidate is ready", () => {
    const root = tempRepo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", planDoc());
    write(root, "docs/decisions/0001-block-second-step.md", blockingDecisionDoc());
    const workspace = tempRepo();
    initWorkspace(workspace);

    const readySet = resolveReadySet(root, "demo");
    expect(readySet.ready.map((entry) => entry.actionId)).toEqual(["ship-it"]);

    const gate = withReadOnlyDatabase(workspace, (db) =>
      resolveOperatorGate({
        db,
        repoRoot: root,
        projectSlug: "demo",
        selectedActionId: "ship-it",
        readySetCandidates: readySet.candidates
      })
    );

    expect(gate.blocking).toHaveLength(0);
    expect(gate.alerts.map((item) => item.id)).toEqual(["0001"]);
  });

  it("blocks via the ready-set reason once nothing in the queue segment is eligible", () => {
    const root = tempRepo();
    write(root, "PROJECT.md", projectDoc());
    write(root, "docs/plans/main-plan.md", planDoc({ shipItStatus: "done", currentAction: "second-step" }));
    write(root, "docs/decisions/0001-block-second-step.md", blockingDecisionDoc());
    const workspace = tempRepo();
    initWorkspace(workspace);

    const readySet = resolveReadySet(root, "demo");
    expect(readySet.ready).toHaveLength(0);

    const gate = withReadOnlyDatabase(workspace, (db) =>
      resolveOperatorGate({
        db,
        repoRoot: root,
        projectSlug: "demo",
        selectedActionId: null,
        readySetCandidates: readySet.candidates
      })
    );

    expect(gate.blocking.map((item) => item.id)).toEqual(["0001"]);
  });
});
