import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runReviewFlagAgentCommand, runReviewReassessCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import { buildAgentQueue } from "../src/dispatch/queue.js";
import {
  createReviewItem,
  getReviewItem,
  listAgentReviewFlaggedItems,
  listActionableReviewItems,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("review reassess", () => {
  it("withdraws a question from a plan that no longer governs the Project", () => {
    const fixture = setup("current-plan");

    const result = runReviewReassessCommand({ workspace: fixture.workspace, id: fixture.reviewSlug });

    expect(result.data.outcome).toBe("withdrawn");
    expect(result.data.summary).toContain("is not the Project's active plan");
    expect(withDatabase(fixture.workspace, (db) => getReviewItem(db, fixture.reviewId)?.status)).toBe("rejected");
    expect(withDatabase(fixture.workspace, (db) => listActionableReviewItems(db).map((item) => item.id))).not.toContain(fixture.reviewId);
  });

  it("keeps a question visible when the active plan still declares it", () => {
    const fixture = setup("old-plan");

    const result = runReviewReassessCommand({ workspace: fixture.workspace, id: fixture.reviewSlug });

    expect(result.data.outcome).toBe("still_declared");
    expect(result.data.summary).toContain("Still declared");
    expect(result.data.summary).toContain("semantic applicability was not evaluated");
    expect(withDatabase(fixture.workspace, (db) => getReviewItem(db, fixture.reviewId)?.status)).toBe("open");
  });

  it("parks a still-declared question for later agent review without starting a Run", () => {
    const fixture = setup("old-plan");

    const result = runReviewFlagAgentCommand({ workspace: fixture.workspace, id: fixture.reviewSlug });

    expect(result.data.outcome).toBe("flagged_for_agent_review");
    expect(result.data.summary).toContain("No Run started");
    expect(withDatabase(fixture.workspace, (db) => getReviewItem(db, fixture.reviewId)?.status)).toBe("deferred");
    expect(withDatabase(fixture.workspace, (db) => listActionableReviewItems(db).map((item) => item.id))).not.toContain(fixture.reviewId);
    expect(withDatabase(fixture.workspace, (db) => listAgentReviewFlaggedItems(db).map((item) => item.id))).toContain(fixture.reviewId);
    const queue = withDatabase(fixture.workspace, (db) => buildAgentQueue(db));
    expect(queue.flagged).toHaveLength(1);
    expect(queue.flagged[0]).toMatchObject({
      decisionId: fixture.reviewId,
      responsibility: "agent",
      status: "agent_review_flagged"
    });
    expect(queue.running).toHaveLength(0);
  });

  it("withdraws a disconnected question instead of flagging agent work", () => {
    const fixture = setup("current-plan");

    const result = runReviewFlagAgentCommand({ workspace: fixture.workspace, id: fixture.reviewSlug });

    expect(result.data.outcome).toBe("withdrawn");
    expect(withDatabase(fixture.workspace, (db) => listAgentReviewFlaggedItems(db))).toHaveLength(0);
  });

  it("leaves the question open when governing Project state cannot be verified", () => {
    const fixture = setup("current-plan");
    rmSync(path.join(fixture.repo, "PROJECT.md"));

    expect(() => runReviewReassessCommand({ workspace: fixture.workspace, id: fixture.reviewSlug }))
      .toThrow("Project document could not be resolved");
    expect(withDatabase(fixture.workspace, (db) => getReviewItem(db, fixture.reviewId)?.status)).toBe("open");
  });
});

function setup(activePlan: "current-plan" | "old-plan") {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-review-reassess-"));
  temporary.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  initWorkspace(workspace);
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument(activePlan));
  writeFileSync(path.join(repo, "docs", "plans", "current-plan.md"), planDocument("current-plan", []));
  writeFileSync(path.join(repo, "docs", "plans", "old-plan.md"), planDocument("old-plan", ["old-question"]));

  return withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Keep operator attention current.",
      status: "active",
      currentMilestone: "Current work",
      nextAction: "Do current work.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const review = createReviewItem(db, {
      projectId: project.id,
      decisionNeeded: "Does the old question still apply?",
      sourceInput: "docs/plans/old-plan.md (old-plan)",
      proposedAction: "Answer the old plan question.",
      resolvedIntent: "ActionClarification",
      confidenceLabel: "medium",
      confidence: 0,
      missingFields: ["missing-decision"],
      context: {
        schemaVersion: 1,
        docRef: "plan/old-plan?question=old-question",
        source: "docs/plans/old-plan.md"
      }
    });
    return { repo, workspace, reviewId: review.id, reviewSlug: review.slug ?? review.id };
  });
}

function projectDocument(activePlan: string): string {
  return `---
arcadia: v1
type: project
slug: demo
name: Demo
status: active
goal: Keep operator attention current.
active_plan: ${activePlan}
updated: 2026-08-30
---
`;
}

function planDocument(slug: string, questions: string[]): string {
  return `---
arcadia: v1
type: plan
slug: ${slug}
project: demo
status: active
milestone: Current work
token_impact: small
token_budget: Reassessment is deterministic.
recommended_model: gpt-5.6-terra
updated: 2026-08-30
actions: []
${questions.length ? `questions:\n${questions.map((id) => `  - id: ${id}\n    question: Does this still apply?\n    gap_type: missing-decision`).join("\n")}` : "questions: []"}
---
`;
}
