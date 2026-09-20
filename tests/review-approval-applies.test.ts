import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDecisionNewCommand } from "../src/commands/decision.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import {
  createReviewItem,
  getReviewItem,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import type { ReviewItemSummary } from "../src/domain/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function workspaceWithProject(): { workspace: string; repoRoot: string; projectSlug: string; projectId: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-review-approval-"));
  temporary.push(root);
  const repoRoot = path.join(root, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const workspace = path.join(root, "ws");
  initWorkspace(workspace);
  const projectId = withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Exercise review approval.",
      status: "active",
      currentMilestone: "Initial",
      nextAction: "Start",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
    return project.id;
  });
  return { workspace, repoRoot, projectSlug: "demo", projectId };
}

/**
 * A clarification review item of the shape `docs sync` produces for a
 * checked-in Decision: it carries `doc_ref`, and no work item.
 */
function clarificationFor(
  workspace: string,
  projectId: string,
  docRef: string | null
): ReviewItemSummary {
  return withDatabase(workspace, (db) => {
    const item = createReviewItem(db, {
      projectId,
      decisionNeeded: "Which way should this go?",
      recommendation: "Option A",
      sourceInput: "test",
      proposedAction: "Answer it.",
      resolvedIntent: "ActionClarification",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: []
    });
    if (docRef) {
      db.prepare("UPDATE review_items SET doc_ref = ? WHERE id = ?").run(docRef, item.id);
    }
    return getReviewItem(db, item.id) as ReviewItemSummary;
  });
}

describe("review approve applies its effect or refuses", () => {
  // Issue #351. The approval used to write only the workspace database and
  // report success, leaving the checked-in Decision reading `status: open`.
  // That happened to Decisions 0058 and 0061 in production, and each needed a
  // manual repair nobody was prompted to make.

  it("writes the answer to the authoritative Decision document", () => {
    const { workspace, repoRoot, projectSlug, projectId } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "which-way", question: "Which way?" });
    const item = clarificationFor(workspace, projectId, "decision/which-way");

    const result = runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" });

    const document = readFileSync(path.join(repoRoot, "docs/decisions/0001-which-way.md"), "utf8");
    expect(document).toContain("status: approved");
    expect(document).toContain("answer: Go left");
    expect(document).not.toContain("status: open");
    expect(result.data.result.summary).toContain("0001-which-way.md");

    const stored = withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id));
    expect(stored?.status).toBe("approved");
    expect(stored?.decision_note).toBe("Go left");
  });

  it("answers an Arcadia-raised clarification that has no document, without inventing one", () => {
    // Arcadia raises clarifications of its own for an Action's open question.
    // Those have no checked-in Decision, so the database is the whole record
    // and there is nothing that could disagree with it. Refusing these would
    // break `work resolve-question` and the adapter reply path for no gain.
    const { workspace, projectId } = workspaceWithProject();
    const item = clarificationFor(workspace, projectId, null);

    const result = runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" });

    expect(result.data.result.summary).toContain("Clarification answered.");
    expect(result.data.result.summary).not.toContain("recorded in");
    const stored = withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id));
    expect(stored?.status).toBe("approved");
    expect(stored?.decision_note).toBe("Go left");
  });

  it("refuses, and leaves the item queued, when the named Decision document is missing from the repository", () => {
    const { workspace, projectId } = workspaceWithProject();
    const item = clarificationFor(workspace, projectId, "decision/never-written");

    expect(() => runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" }))
      .toThrow(/No decision file matches/);

    const stored = withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id));
    expect(stored?.status).toBe("open");
  });

  it("refuses an answer that is not one of the Decision's offered options, and changes nothing", () => {
    const { workspace, repoRoot, projectSlug, projectId } = workspaceWithProject();
    runDecisionNewCommand({
      workspace,
      project: projectSlug,
      slug: "offered-options",
      question: "Which option?",
      options: [
        { label: "Take the first", consequence: "The first happens." },
        { label: "Take the second", consequence: "The second happens.", recommended: true }
      ]
    });
    const item = clarificationFor(workspace, projectId, "decision/offered-options");

    expect(() => runReviewApproveCommand({ workspace, id: item.id, answer: "something else" }))
      .toThrow(/answer with one of their labels/);

    const document = readFileSync(path.join(repoRoot, "docs/decisions/0001-offered-options.md"), "utf8");
    expect(document).toContain("status: open");
    const stored = withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id));
    expect(stored?.status).toBe("open");
  });

  it("records an offered option verbatim rather than the caller's casing", () => {
    const { workspace, repoRoot, projectSlug, projectId } = workspaceWithProject();
    runDecisionNewCommand({
      workspace,
      project: projectSlug,
      slug: "verbatim",
      question: "Which option?",
      options: [
        { label: "Take the first", consequence: "The first happens.", recommended: true },
        { label: "Take the second", consequence: "The second happens." }
      ]
    });
    const item = clarificationFor(workspace, projectId, "decision/verbatim");

    runReviewApproveCommand({ workspace, id: item.id, answer: "take THE first" });

    const document = readFileSync(path.join(repoRoot, "docs/decisions/0001-verbatim.md"), "utf8");
    expect(document).toContain("answer: Take the first");
    const stored = withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id));
    expect(stored?.decision_note).toBe("Take the first");
  });

  it("does not report an Action transition when the item has no Action", () => {
    // The old summary was unconditional, so it claimed the Action was returned
    // to unclarified even for an item with no work item at all — which is how
    // Decision 0061's approval read, and it is not something that happened.
    const { workspace, projectSlug, projectId } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "no-action", question: "Which way?" });
    const item = clarificationFor(workspace, projectId, "decision/no-action");

    const result = runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" });

    expect(result.data.result.summary).not.toContain("returned to unclarified");
    expect(result.data.result.summary).toContain("No executor was invoked.");
  });
});
