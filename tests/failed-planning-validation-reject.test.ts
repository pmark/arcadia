import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runReviewRejectCommand } from "../src/commands/review.js";
import { createReviewItem, createWorkItemWithOptionalArtifact, getWorkItem } from "../src/db/repositories.js";
import { withDatabase } from "../src/db/connection.js";
import { planStepsForWorkItem } from "../src/execution/skills.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function failedValidationFixture(): { workspace: string; workItemId: string; reviewId: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-failed-validation-"));
  temporary.push(root);
  const workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  return withDatabase(workspace, (db) => {
    const { workItem } = createWorkItemWithOptionalArtifact(db, {
      title: "Clean up the preserve transport request",
      rawInput: "Clean up the preserve transport request",
      queue: "requires_review",
      workClassification: "requires_review",
      nextAction: "Revise the planning request or packet before creating a new Decision."
    });
    const review = createReviewItem(db, {
      workItemId: workItem.id,
      decisionNeeded: "Revise the Codex planning artifact before treating it as ready.",
      sourceInput: "planning validation",
      proposedAction: "Retry planning",
      resolvedIntent: "codex_planning_artifact_validation",
      confidenceLabel: "high",
      confidence: 1
    });
    return { workspace, workItemId: workItem.id, reviewId: review.id };
  });
}

describe("rejecting a failed planning validation Decision", () => {
  it("reopens the Action so a fresh planning packet can be prepared", () => {
    const fixture = failedValidationFixture();

    runReviewRejectCommand({ workspace: fixture.workspace, id: fixture.reviewId, feedback: "Put the whole plan in the final message." });

    const item = withDatabase(fixture.workspace, (db) => getWorkItem(db, fixture.workItemId))!;
    expect(item).toMatchObject({ queue: "work_queue", work_classification: "agent", status: "open" });
    expect(item.next_action).toContain("Put the whole plan in the final message.");
    // The regression: this used to be a lone operator "Surface required review" step.
    expect(planStepsForWorkItem(item).map((step) => step.executorType)).not.toEqual(["operator"]);
  });

  it("reopens the Action even when no feedback is given", () => {
    const fixture = failedValidationFixture();

    runReviewRejectCommand({ workspace: fixture.workspace, id: fixture.reviewId });

    const item = withDatabase(fixture.workspace, (db) => getWorkItem(db, fixture.workItemId))!;
    expect(item).toMatchObject({ queue: "work_queue", work_classification: "agent", status: "open" });
    expect(item.next_action).toContain("failed validation");
  });
});
