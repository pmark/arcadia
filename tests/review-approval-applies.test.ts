import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const failure = vi.hoisted(() => ({ afterCallback: false }));

// Lets one test make the database step fail after the transaction body (and
// so the Decision commit) has run, as a DB COMMIT failure would.
vi.mock("../src/db/connection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/connection.js")>();
  return {
    ...actual,
    writeTransaction: <T,>(db: Parameters<typeof actual.writeTransaction>[0], callback: () => T): T =>
      actual.writeTransaction(db, () => {
        const result = callback();
        if (failure.afterCallback) throw new Error("simulated database commit failure");
        return result;
      })
  };
});
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
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "review-test@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Review Test"], { cwd: repoRoot });
  writeFileSync(path.join(repoRoot, "README.md"), "demo\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: repoRoot });
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

  it.each(["plan/not-a-decision", "proposal/not-a-decision", "decision/"]) (
    "refuses a malformed nonempty Decision doc_ref: %s",
    (docRef) => {
      const { workspace, projectId } = workspaceWithProject();
      const item = clarificationFor(workspace, projectId, docRef);

      expect(() => runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" }))
        .toThrow(/doc_ref must be a decision\/<slug>/);

      const stored = withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id));
      expect(stored?.status).toBe("open");
    }
  );

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

  // Live defect 2026-10-09/10: a Decision answered from Discord or /review left
  // docs/decisions/<n>.md modified but uncommitted in the checkout.
  it("commits the Decision answer, leaving a clean tree and one new commit", () => {
    const { workspace, repoRoot, projectSlug, projectId } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "commit-me", question: "Which way?" });
    execFileSync("git", ["add", "docs"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-qm", "raise decision"], { cwd: repoRoot });
    const item = clarificationFor(workspace, projectId, "decision/commit-me");

    runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" });

    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
    expect(status).toBe("");
    const log = execFileSync("git", ["log", "-1", "--format=%B"], { cwd: repoRoot, encoding: "utf8" });
    expect(log).toContain("chore(arcadia): answer Decision 0001");
    expect(log).toContain("docs/decisions/0001-commit-me.md: recorded the answer.");
    expect(log).toContain("Written by `arcadia review approve`");
    const count = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    expect(count).toBe("3");
  });

  it("keeps the committed answer when the database step fails after the commit, and a retry closes the item", () => {
    const { workspace, repoRoot, projectSlug, projectId } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "db-fails", question: "Which way?" });
    execFileSync("git", ["add", "docs"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-qm", "raise decision"], { cwd: repoRoot });
    const item = clarificationFor(workspace, projectId, "decision/db-fails");

    failure.afterCallback = true;
    try {
      expect(() => runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" }))
        .toThrow(/simulated database commit failure/);
    } finally {
      failure.afterCallback = false;
    }

    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" })).toBe("");
    expect(readFileSync(path.join(repoRoot, "docs/decisions/0001-db-fails.md"), "utf8")).toContain("answer: Go left");
    expect(withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id))?.status).toBe("open");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });

    runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" });

    expect(withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id))?.status).toBe("approved");
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" })).toBe(head);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" })).toBe("");
  });

  it("restores the file, surfaces the error and leaves the item open when the commit fails", () => {
    const { workspace, repoRoot, projectSlug, projectId } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "hook-blocked", question: "Which way?" });
    execFileSync("git", ["add", "docs"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-qm", "raise decision"], { cwd: repoRoot });
    const hook = path.join(repoRoot, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho blocked >&2\nexit 1\n", "utf8");
    chmodSync(hook, 0o755);
    const item = clarificationFor(workspace, projectId, "decision/hook-blocked");

    expect(() => runReviewApproveCommand({ workspace, id: item.id, answer: "Go left" }))
      .toThrow(/could not be committed/);

    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
    expect(status).toBe("");
    const document = readFileSync(path.join(repoRoot, "docs/decisions/0001-hook-blocked.md"), "utf8");
    expect(document).toContain("status: open");
    const stored = withReadOnlyDatabase(workspace, (db) => getReviewItem(db, item.id));
    expect(stored?.status).toBe("open");
  });
});
