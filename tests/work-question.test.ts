import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  createReviewItem,
  createWorkItemWithOptionalArtifact,
  getWorkItem,
  listActionableReviewItems,
  setWorkItemDocRef
} from "../src/db/repositories.js";
import { ACTION_CLARIFICATION_INTENT } from "../src/commands/review.js";
import {
  runWorkResolveQuestionCommand,
  runWorkShowQuestionCommand
} from "../src/commands/workQuestion.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("showing an Action's blocking question", () => {
  it("reports resolvable false when the Action carries no open question", () => {
    const workspace = initializedWorkspace();
    const workItemId = withDatabase(workspace, (db) => {
      const { project } = createProjectWithInitialWork(db, seedProjectInput());
      const { workItem } = createWorkItemWithOptionalArtifact(db, seedWorkItemInput(project.id));
      return workItem.id;
    });

    const response = runWorkShowQuestionCommand({ workspace, workId: workItemId });
    expect(response.data.resolvable).toBe(false);
    expect(response.data.reviewItem).toBeNull();
  });

  it("finds the review item already open for the Action", () => {
    const workspace = initializedWorkspace();
    const workItemId = withDatabase(workspace, (db) => {
      const { project } = createProjectWithInitialWork(db, seedProjectInput());
      const { workItem } = createWorkItemWithOptionalArtifact(db, seedWorkItemInput(project.id));
      setWorkItemDocRef(db, workItem.id, "plan/some-plan#gate-action");
      db.prepare("UPDATE work_items SET clarification_status = 'question_open', open_question = ? WHERE id = ?").run(
        "Does the proposal ship as written?",
        workItem.id
      );
      createReviewItem(db, {
        workItemId: workItem.id,
        projectId: project.id,
        decisionNeeded: "Does the proposal ship as written?",
        recommendation: null,
        sourceInput: "test",
        proposedAction: "Answer it.",
        resolvedIntent: ACTION_CLARIFICATION_INTENT,
        confidenceLabel: "medium",
        confidence: 0,
        missingFields: []
      });
      return workItem.id;
    });

    const response = runWorkShowQuestionCommand({ workspace, workId: workItemId });
    expect(response.data.resolvable).toBe(true);
    expect(response.data.reviewItem?.status).toBe("open");
    expect(response.data.workItem.openQuestion).toBe("Does the proposal ship as written?");
  });
});

describe("resolving an Action's blocking question", () => {
  it("refuses when nothing is waiting on an answer", () => {
    const workspace = initializedWorkspace();
    const workItemId = withDatabase(workspace, (db) => {
      const { project } = createProjectWithInitialWork(db, seedProjectInput());
      const { workItem } = createWorkItemWithOptionalArtifact(db, seedWorkItemInput(project.id));
      return workItem.id;
    });

    expect(() => runWorkResolveQuestionCommand({ workspace, workId: workItemId, answer: "Yes." })).toThrow(
      /Nothing is waiting on an answer/
    );
  });

  it("opens the missing Decision itself, then records the answer against it", () => {
    // The exact gap that caused the confusion: an Action was set to
    // question_open with a recorded open_question but no review item was ever
    // created for it, so nothing existed for the operator to answer against.
    const workspace = initializedWorkspace();
    const workItemId = withDatabase(workspace, (db) => {
      const { project } = createProjectWithInitialWork(db, seedProjectInput());
      const { workItem } = createWorkItemWithOptionalArtifact(db, seedWorkItemInput(project.id));
      db.prepare("UPDATE work_items SET clarification_status = 'question_open', open_question = ?, gap_type = ? WHERE id = ?").run(
        "Does the proposal ship as written?",
        "missing-decision",
        workItem.id
      );
      return workItem.id;
    });

    const before = withDatabase(workspace, (db) => listActionableReviewItems(db));
    expect(before).toHaveLength(0);

    const response = runWorkResolveQuestionCommand({
      workspace,
      workId: workItemId,
      answer: "Yes, ship it as written."
    });

    expect(response.data.reviewItem.status).toBe("approved");
    expect(response.data.reviewItem.decisionNeeded).toBe("Does the proposal ship as written?");
    expect(response.data.workItem.clarification_status).toBe("unclarified");
    expect(response.data.workItem.open_question).toBeNull();

    const persisted = withDatabase(workspace, (db) => getWorkItem(db, workItemId));
    expect(persisted?.clarification_source).toMatch(/Yes, ship it as written\./);
  });

  it("reuses an already-open Decision rather than creating a second one", () => {
    const workspace = initializedWorkspace();
    const workItemId = withDatabase(workspace, (db) => {
      const { project } = createProjectWithInitialWork(db, seedProjectInput());
      const { workItem } = createWorkItemWithOptionalArtifact(db, seedWorkItemInput(project.id));
      setWorkItemDocRef(db, workItem.id, "plan/some-plan#gate-action");
      db.prepare("UPDATE work_items SET clarification_status = 'question_open', open_question = ? WHERE id = ?").run(
        "Does the proposal ship as written?",
        workItem.id
      );
      createReviewItem(db, {
        workItemId: workItem.id,
        projectId: project.id,
        decisionNeeded: "Does the proposal ship as written?",
        recommendation: null,
        sourceInput: "test",
        proposedAction: "Answer it.",
        resolvedIntent: ACTION_CLARIFICATION_INTENT,
        confidenceLabel: "medium",
        confidence: 0,
        missingFields: []
      });
      return workItem.id;
    });

    runWorkResolveQuestionCommand({ workspace, workId: workItemId, answer: "Yes." });

    const items = withDatabase(workspace, (db) => listActionableReviewItems(db));
    // Approving moves it out of open/deferred, so the actionable list should
    // now be empty rather than showing a leftover second Decision.
    expect(items).toHaveLength(0);
  });
});

function seedProjectInput() {
  return {
    name: "The Thing",
    mission: "Prove the thing works.",
    status: "active" as const,
    currentMilestone: "First milestone",
    nextAction: "Do the first thing.",
    workClassification: "codex" as const
  };
}

function seedWorkItemInput(projectId: string) {
  return {
    projectId,
    title: "Build the surface",
    rawInput: "Build the surface",
    queue: "work_queue" as const,
    workClassification: "codex" as const,
    nextAction: "Clarify the desired outcome or approve a Codex execution path."
  };
}

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-work-question-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}
