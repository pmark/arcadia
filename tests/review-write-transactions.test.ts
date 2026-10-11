import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runReviewApproveCommand,
  runReviewFlagAgentCommand,
  runReviewOpenCommand,
  runReviewReassessCommand
} from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createArtifactRecord,
  createExecutionPlan,
  createProjectWithInitialWork,
  createReviewItem,
  getReviewItem,
  getWorkItem,
  listReviewItems,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { ensureBuiltInSkills } from "../src/execution/skills.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { createInterleavedWriter } from "./support/interleavedWriter.js";

/**
 * Regression tests for #1106: every read-then-write transaction in
 * `src/commands/review.ts` must take the write lock before it reads, via
 * `writeTransaction`. Each test makes another connection try to commit after
 * the command's first in-transaction read (see `interleavedWriter.ts`):
 *
 * - IMMEDIATE (`writeTransaction`): the competing write is refused and the
 *   command succeeds.
 * - Deferred (`db.transaction()`): the competing write commits, and the
 *   command's own write then fails with "database is locked" -- the
 *   SQLITE_BUSY_SNAPSHOT race that broke review approve in #1102.
 *
 * `withDatabase` is wrapped so the command under test receives the proxied
 * connection; nothing else about it changes.
 */
const hook = vi.hoisted(() => ({ wrap: null as null | ((db: unknown) => unknown) }));

vi.mock("../src/db/connection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/connection.js")>();
  return {
    ...actual,
    withDatabase: <T>(workspace: string, callback: (db: Database.Database) => T): T =>
      actual.withDatabase(workspace, (db) => callback(hook.wrap ? (hook.wrap(db) as Database.Database) : db))
  };
});

const roots: string[] = [];

afterEach(() => {
  hook.wrap = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Runs `command` with a competing writer armed, and asserts the lock was held. */
function racing<T>(workspace: string, command: () => T, options: { transaction?: number } = {}): T {
  const writer = createInterleavedWriter(workspace, options);
  hook.wrap = (db) => writer.wrap(db as Database.Database);
  try {
    const result = command();
    // "refused" proves the interleave happened inside the transaction AND that
    // the write lock was already held there; "landed" is the deferred bug.
    expect(writer.outcome()).toBe("refused");
    return result;
  } finally {
    hook.wrap = null;
    writer.close();
  }
}

interface Fixture {
  workspace: string;
  repo: string;
  projectId: string;
  workItemId: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-review-tx-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(repo, { recursive: true });
  initWorkspace(workspace);
  return withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Transaction Demo",
      mission: "Keep review writes lock-safe.",
      goal: "Review commands survive concurrent writers.",
      status: "active",
      currentMilestone: "Lock safety",
      nextAction: "Prove review transactions are immediate.",
      workClassification: "requires_review"
    });
    upsertProjectMetadata(db, {
      projectId: created.project.id,
      repoPath: repo,
      repositoryUrl: "https://github.com/example/transaction-demo",
      validationCommands: []
    });
    return { workspace, repo, projectId: created.project.id, workItemId: created.workItem.id };
  });
}

describe("review write transactions take the write lock before reading (#1106)", () => {
  it("review open creates the clarification Decision under a competing writer", () => {
    const fx = fixture();

    const opened = racing(fx.workspace, () =>
      runReviewOpenCommand({ workspace: fx.workspace, workId: fx.workItemId, question: "Which sync should be fixed?" })
    );

    expect(opened.data.workItem.clarification_status).toBe("question_open");
    expect(withDatabase(fx.workspace, (db) => getReviewItem(db, opened.data.item.id))?.status).toBe("open");
  });

  it("review reassess records its outcome under a competing writer", () => {
    const fx = planFixture("old-plan");

    const result = racing(fx.workspace, () =>
      runReviewReassessCommand({ workspace: fx.workspace, id: fx.reviewId })
    );

    expect(result.data.outcome).toBe("still_declared");
    const context = JSON.parse(withDatabase(fx.workspace, (db) => getReviewItem(db, fx.reviewId))!.context_json);
    expect(context.reassessment.outcome).toBe("still_declared");
  });

  it("review reassess withdraws a disconnected question under a competing writer", () => {
    const fx = planFixture("current-plan");

    const result = racing(fx.workspace, () =>
      runReviewReassessCommand({ workspace: fx.workspace, id: fx.reviewId })
    );

    expect(result.data.outcome).toBe("withdrawn");
    expect(withDatabase(fx.workspace, (db) => getReviewItem(db, fx.reviewId))?.status).toBe("rejected");
  });

  it("review flag-agent defers the Decision under a competing writer", () => {
    const fx = planFixture("old-plan");

    // `flag-agent` reassesses first (its own transaction); arm on the second
    // transaction so the flag write itself is the one raced.
    const result = racing(
      fx.workspace,
      () => runReviewFlagAgentCommand({ workspace: fx.workspace, id: fx.reviewId }),
      { transaction: 2 }
    );

    expect(result.data.outcome).toBe("flagged_for_agent_review");
    expect(withDatabase(fx.workspace, (db) => getReviewItem(db, fx.reviewId))?.status).toBe("deferred");
  });

  it("approving a Project proposal queues its Run under a competing writer", () => {
    const fx = fixture();
    const decisionId = withDatabase(fx.workspace, (db) => {
      ensureBuiltInSkills(db);
      const plan = createExecutionPlan(db, {
        workItemId: fx.workItemId,
        summary: "Scaffold the Project.",
        steps: [{
          skillName: "codex_build",
          title: "Scaffold",
          command: null,
          executorType: "codex_build",
          safeToRun: false,
          needsOperator: null
        }]
      })!;
      return createReviewItem(db, {
        workItemId: fx.workItemId,
        planId: plan.id,
        projectId: fx.projectId,
        decisionNeeded: "Approve the Project proposal.",
        sourceInput: "fixture",
        proposedAction: "Scaffold the Project.",
        resolvedIntent: "ProjectProposalApproval",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: []
      }).id;
    });

    const approved = racing(fx.workspace, () =>
      runReviewApproveCommand({ workspace: fx.workspace, id: decisionId })
    );

    expect(approved.data.run?.id).toBeTruthy();
    expect(withDatabase(fx.workspace, (db) => getReviewItem(db, decisionId))?.status).toBe("approved");
  });

  it("accepting a planning Artifact records acceptance under a competing writer", () => {
    const fx = fixture();
    const decisionId = withDatabase(fx.workspace, (db) => {
      const artifact = createArtifactRecord(db, {
        projectId: fx.projectId,
        workItemId: fx.workItemId,
        title: "Planning Artifact",
        artifactType: "codex_planning_artifact",
        status: "drafted",
        path: "artifacts/plan.md"
      });
      return createReviewItem(db, {
        workItemId: fx.workItemId,
        projectId: fx.projectId,
        artifactId: artifact.id,
        decisionNeeded: "Accept the validated planning Artifact.",
        sourceInput: "fixture",
        proposedAction: "Accept the plan.",
        resolvedIntent: "CodexPlanningArtifactAcceptance",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: []
      }).id;
    });

    // The acceptance transaction is the only one this command opens.
    const approved = racing(fx.workspace, () =>
      runReviewApproveCommand({ workspace: fx.workspace, id: decisionId })
    );

    expect(approved.data.item.status).toBe("approved");
    expect(withDatabase(fx.workspace, (db) => getWorkItem(db, fx.workItemId))?.status).toBe("done");
  });

  it("approving a build packet without executing approves it under a competing writer and creates no execution follow-up", () => {
    const fx = fixture();
    const decisionId = withDatabase(fx.workspace, (db) =>
      createReviewItem(db, {
        workItemId: fx.workItemId,
        projectId: fx.projectId,
        decisionNeeded: "Approve the build packet.",
        sourceInput: "docs/plans/demo.md#action",
        proposedAction: "Build.",
        resolvedIntent: "CodexBuildPacketApproval",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: []
      }).id
    );

    const approved = racing(fx.workspace, () =>
      runReviewApproveCommand({ workspace: fx.workspace, id: decisionId, execute: false })
    );

    expect(approved.data.item.status).toBe("approved");
    const open = withDatabase(fx.workspace, (db) => listReviewItems(db, "open"));
    expect(open.some((item) => item.resolved_intent === "ReviewExecutionPending")).toBe(false);
  });

  it("answering a clarification Decision resets the Action under a competing writer", () => {
    // Unlike the sites above, this transaction's first statement is already a
    // write (`updateReviewItemStatus`), so it never held a read snapshot and
    // the deferred form was not exposed to SQLITE_BUSY_SNAPSHOT here. It is
    // converted for consistency and for the file write that follows inside it;
    // this test proves the converted path holds the lock and still commits,
    // but would also pass on a deferred transaction.
    const fx = fixture();
    const opened = runReviewOpenCommand({
      workspace: fx.workspace,
      workId: fx.workItemId,
      question: "Which sync should be fixed?"
    });

    const answered = racing(fx.workspace, () =>
      runReviewApproveCommand({ workspace: fx.workspace, id: opened.data.item.id, answer: "The nightly sync" })
    );

    expect(answered.data.item.status).toBe("approved");
    expect(withDatabase(fx.workspace, (db) => getWorkItem(db, fx.workItemId))?.clarification_status).toBe("unclarified");
  });
});

function planFixture(activePlan: "current-plan" | "old-plan"): Fixture & { reviewId: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-review-tx-plan-"));
  roots.push(root);
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
    return { workspace, repo, projectId: project.id, workItemId: "", reviewId: review.id };
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
