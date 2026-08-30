import { describe, expect, it } from "vitest";
import { buildNeedsYouBoard } from "./needs-you";
import type { AgentQueueEntry, DashboardAttentionItem, DashboardReviewItem } from "./types";

const NOW = Date.parse("2026-08-28T12:00:00.000Z");

function attentionItem(overrides: Partial<DashboardAttentionItem>): DashboardAttentionItem {
  return {
    id: "review:r1",
    kind: "review",
    severity: "action",
    projectName: "Sample Project",
    projectId: "proj-1",
    milestone: null,
    goal: null,
    outcome: null,
    status: "requires_review",
    statusLabel: "Requires Review",
    reason: "A Decision needs an answer.",
    workItemId: null,
    actionId: "action-1",
    workItemTitle: null,
    actionTitle: null,
    expectedArtifact: null,
    targetRepositoryRoot: null,
    relatedArtifactId: null,
    relatedArtifactTitle: null,
    relatedArtifactPath: null,
    finalArtifactPath: null,
    validationPath: null,
    relatedReviewId: "r1",
    relatedReviewSlug: "r1",
    relatedDecisionId: null,
    relatedDecisionSlug: null,
    relatedRunId: null,
    relatedCodexInvocationId: null,
    nextAction: "Answer the question.",
    interpretation: null,
    safetyBoundaries: [],
    responsibility: null,
    primaryActions: [],
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    ...overrides
  };
}

function reviewItem(overrides: Partial<DashboardReviewItem>): DashboardReviewItem {
  return {
    id: "r1",
    slug: "r1",
    decisionId: "d1",
    decisionSlug: "d1",
    displayId: "R1",
    workItemId: null,
    actionId: "action-1",
    projectId: "proj-1",
    project: "Sample Project",
    goal: null,
    outcome: null,
    status: "requires_review",
    statusLabel: "Requires Review",
    category: "decision",
    decisionNeeded: "What should happen next?",
    context: "",
    recommendation: null,
    proposedAction: "",
    missingFields: [],
    options: ["approve", "reject", "defer"],
    sourceInput: "",
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    resultingAskRequestId: null,
    contextJson: null,
    resolvedIntent: "ActionClarification",
    packetArtifactId: null,
    codexInvocationId: null,
    artifactPath: null,
    promptPath: null,
    finalMessagePath: null,
    validationPath: null,
    ...overrides
  };
}

function selectedAction(actionId: string): AgentQueueEntry {
  return {
    id: `ready:${actionId}`,
    state: "ready",
    attentionKind: null,
    selected: true,
    projectId: "proj-1",
    projectName: "Sample Project",
    projectSlug: "sample-project",
    repositoryRoot: "/tmp/sample-project",
    planSlug: "sample-plan",
    planPath: "docs/plans/sample-plan.md",
    actionId,
    actionTitle: actionId,
    responsibility: "codex",
    expectedArtifact: null,
    tokenImpact: null,
    tokenBudget: null,
    status: "ready",
    reason: "Ready.",
    nextAction: "Run it.",
    blockers: [],
    runId: null,
    decisionId: null,
    updatedAt: "2026-08-28T00:00:00.000Z"
  };
}

describe("buildNeedsYouBoard", () => {
  it("excludes deterministic blocked_work items and accounts for them separately", () => {
    const board = buildNeedsYouBoard(
      [
        attentionItem({ id: "review:r1" }),
        attentionItem({
          id: "blocked-work:bw1",
          kind: "blocked_work",
          severity: "blocked",
          relatedReviewId: null,
          actionId: "action-2"
        })
      ],
      [reviewItem({})]
    );

    expect(board.excluded).toHaveLength(1);
    expect(board.excluded[0]?.item.id).toBe("blocked-work:bw1");
    expect(board.excluded[0]?.exclusionReason).toMatch(/deterministic/i);
    expect(board.dominant?.item.id).toBe("review:r1");
  });

  it("ranks blocked severity above action severity of the same age", () => {
    const board = buildNeedsYouBoard([
      attentionItem({ id: "review:blocked", severity: "blocked", relatedReviewId: null, actionId: "action-a" }),
      attentionItem({ id: "review:action", severity: "action", relatedReviewId: null, actionId: "action-b" })
    ]);

    expect(board.dominant?.item.id).toBe("review:blocked");
    expect(board.queue.map((entry) => entry.item.id)).toEqual(["review:action"]);
  });

  it("ranks a resolvable Decision above a same-age blocked run that only points at it", () => {
    const board = buildNeedsYouBoard([
      attentionItem({
        id: "run:failed",
        kind: "run",
        severity: "blocked",
        relatedReviewId: null,
        actionId: "action-run"
      }),
      attentionItem({
        id: "review:retry",
        kind: "review",
        severity: "action",
        relatedReviewId: null,
        actionId: "action-retry"
      })
    ]);

    expect(board.dominant?.item.id).toBe("review:retry");
  });

  it("ranks an older item above a newer item of equal severity", () => {
    const board = buildNeedsYouBoard([
      attentionItem({ id: "review:old", createdAt: "2026-08-01T00:00:00.000Z", relatedReviewId: null, actionId: "action-a" }),
      attentionItem({ id: "review:new", createdAt: "2026-08-27T00:00:00.000Z", relatedReviewId: null, actionId: "action-b" })
    ]);

    expect(board.dominant?.item.id).toBe("review:old");
  });

  it("derives operator attention cost from the resolved intent of a joined review item", () => {
    const board = buildNeedsYouBoard(
      [attentionItem({ id: "review:r1", relatedReviewId: "r1" })],
      [reviewItem({ resolvedIntent: "CodexPlanningArtifactAcceptance" })]
    );

    expect(board.dominant?.attentionCost).toBe("long");
  });

  it("archives an old packet for a non-current Action but keeps the current Action's packet", () => {
    const board = buildNeedsYouBoard(
      [
        attentionItem({
          id: "codex:old",
          kind: "codex_packet",
          relatedReviewId: null,
          actionId: "old-action",
          createdAt: "2026-06-01T00:00:00.000Z"
        }),
        attentionItem({
          id: "codex:current",
          kind: "codex_packet",
          relatedReviewId: null,
          actionId: "current-action",
          createdAt: "2026-06-01T00:00:00.000Z"
        })
      ],
      [],
      [selectedAction("current-action")],
      NOW
    );

    expect(board.dominant?.item.id).toBe("codex:current");
    expect(board.excluded).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ id: "codex:old" }), exclusionReason: expect.stringMatching(/historical packet/i) })
    ]);
  });

  it("keeps only the newest packet for the same Action", () => {
    const board = buildNeedsYouBoard([
      attentionItem({
        id: "codex:older",
        kind: "codex_packet",
        relatedReviewId: null,
        actionId: "action-1",
        createdAt: "2026-08-27T00:00:00.000Z",
        updatedAt: "2026-08-27T00:00:00.000Z"
      }),
      attentionItem({
        id: "codex:newer",
        kind: "codex_packet",
        relatedReviewId: null,
        actionId: "action-1",
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z"
      })
    ], [], [], NOW);

    expect(board.dominant?.item.id).toBe("codex:newer");
    expect(board.excluded[0]?.exclusionReason).toMatch(/superseded/i);
  });

  it("archives a Run when its open Review already carries the Decision", () => {
    const board = buildNeedsYouBoard([
      attentionItem({ id: "review:retry", kind: "review", relatedRunId: "run-1" }),
      attentionItem({ id: "run:run-1", kind: "run", relatedReviewId: null, relatedRunId: "run-1" })
    ]);

    expect(board.dominant?.item.id).toBe("review:retry");
    expect(board.excluded[0]?.exclusionReason).toMatch(/review already carries/i);
  });

  it("archives a Run after its linked Review has been resolved", () => {
    const board = buildNeedsYouBoard([
      attentionItem({
        id: "run:resolved-review",
        kind: "run",
        relatedReviewId: "resolved-review",
        relatedRunId: "run-1",
        actionId: "action-1"
      })
    ]);

    expect(board.dominant).toBeNull();
    expect(board.excluded[0]?.exclusionReason).toMatch(/canonical decision record/i);
  });

  it("focuses a bounded set in project priority order and removes excluded Projects", () => {
    const board = buildNeedsYouBoard(
      [
        attentionItem({ id: "review:arcadia", projectName: "Arcadia", actionId: "arcadia" }),
        attentionItem({ id: "review:ppn-a", projectName: "Private Practice Now", actionId: "ppn-a" }),
        attentionItem({ id: "review:ppn-b", projectName: "Private Practice Now", actionId: "ppn-b" }),
        attentionItem({ id: "review:rebuster", projectName: "Rebuster", actionId: "rebuster" })
      ],
      [],
      [],
      NOW,
      { projectOrder: ["Private Practice Now", "Arcadia"], excludedProjects: ["Rebuster"], maxItems: 2 }
    );

    expect([board.dominant?.item.id, ...board.queue.map((entry) => entry.item.id)]).toEqual([
      "review:ppn-a",
      "review:ppn-b"
    ]);
    expect(board.excluded.map((entry) => entry.item.id)).toEqual(expect.arrayContaining(["review:rebuster", "review:arcadia"]));
  });

  it("returns an empty board with no dominant item when nothing needs the operator", () => {
    const board = buildNeedsYouBoard([]);
    expect(board.dominant).toBeNull();
    expect(board.queue).toHaveLength(0);
    expect(board.excluded).toHaveLength(0);
  });
});
