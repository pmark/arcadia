import { describe, expect, it } from "vitest";
import { buildNeedsYouBoard } from "./needs-you";
import type { DashboardAttentionItem, DashboardReviewItem } from "./types";

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

  it("returns an empty board with no dominant item when nothing needs the operator", () => {
    const board = buildNeedsYouBoard([]);
    expect(board.dominant).toBeNull();
    expect(board.queue).toHaveLength(0);
    expect(board.excluded).toHaveLength(0);
  });
});
