import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentQueue } from "../src/dispatch/queue.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { runAdvanceQueueMakeNextCommand } from "../src/commands/advance.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-advance-queue-"));
  temporary.push(directory);
  return directory;
}

function writeDoc(repoRoot: string, relativePath: string, content: string): void {
  const absolute = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function projectDoc(): string {
  return [
    "---",
    "arcadia: v1",
    "type: project",
    "slug: demo",
    "name: Demo",
    "status: active",
    "goal: Exercise the Agent Queue.",
    "milestone: Queue milestone",
    "active_plan: queue-plan",
    "current_action: ship-it",
    "updated: 2026-08-02",
    "---",
    "",
    "# Demo",
    ""
  ].join("\n");
}

function planDoc(): string {
  return [
    "---",
    "arcadia: v1",
    "type: plan",
    "slug: queue-plan",
    "project: demo",
    "status: active",
    "milestone: Queue milestone",
    "token_impact: medium",
    "token_budget: One bounded implementation pass; validation is deterministic.",
    "recommended_model: gpt-5.6-terra",
    "current_action: ship-it",
    "updated: 2026-08-02",
    "actions:",
    "  - id: migrate",
    "    title: Prepare the queue fixture",
    "    status: open",
    "    responsibility: codex",
    "    next_action: Prepare the fixture.",
    "    expected_artifact: A prepared fixture",
    "    clarification: clarified",
    "    acceptance_criteria:",
    "      - The fixture is prepared.",
    "    depends_on: []",
    "  - id: ship-it",
    "    title: Ship the queue view",
    "    status: open",
    "    responsibility: codex",
    "    next_action: Implement the queue view.",
    "    expected_artifact: A visible queue view",
    "    clarification: clarified",
    "    acceptance_criteria:",
    "      - The queue is visible.",
    "    depends_on: [migrate]",
    "---",
    "",
    "# Queue plan",
    ""
  ].join("\n");
}

function queueWorkspace(repoRoot: string): string {
  const workspace = path.join(scratch(), "workspace");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Exercise the Agent Queue.",
      status: "active",
      currentMilestone: "Queue milestone",
      nextAction: "Implement the queue view.",
      workClassification: "codex"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
  });
  return workspace;
}

function commitFixture(repoRoot: string): void {
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "queue-test@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Queue Test"], { cwd: repoRoot });
  execFileSync("git", ["add", "PROJECT.md", "docs/plans/queue-plan.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "Add queue fixture"], { cwd: repoRoot });
}

describe("Agent Queue", () => {
  it("separates ready work from the current Action's document blocker", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc());
    writeDoc(repo, "docs/plans/queue-plan.md", planDoc());
    const workspace = queueWorkspace(repo);

    const queue = withDatabase(workspace, (db) => buildAgentQueue(db, { now: new Date("2026-08-02T12:00:00.000Z") }));

    expect(queue.counts.ready).toBe(1);
    expect(queue.ready[0]).toMatchObject({
      actionId: "migrate",
      selected: false,
      pointerAuthorized: false,
      reason: expect.stringContaining("waiting_for_pointer"),
      planSlug: "queue-plan",
      tokenImpact: "medium",
      tokenBudget: "One bounded implementation pass; validation is deterministic.",
      outcome: "Exercise the Agent Queue.",
      milestone: "Queue milestone",
      acceptanceCriteria: ["The fixture is prepared."],
      dependencies: [],
      decisions: []
    });
    expect(queue.counts.attention).toBe(1);
    expect(queue.attention[0]).toMatchObject({
      actionId: "ship-it",
      attentionKind: "document",
      reason: expect.stringContaining("Depends on")
    });
    expect(queue.attention[0].blockers[0]).toMatchObject({
      field: "actions.ship-it.depends_on",
      remedy: expect.stringContaining("migrate")
    });
    expect(queue.ordered.map((entry) => entry.orderKey)).toEqual(["demo/migrate", "demo/ship-it"]);
    expect(queue.unpositionedCount).toBe(2);
    expect(queue.orderValid).toBe(false);
    expect(queue.nextActionKey).toBeNull();
  });

  it("keeps a missing repository path visible as attention", () => {
    const workspace = path.join(scratch(), "workspace");
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      const project = upsertProject(db, {
        name: "Needs Repository",
        mission: "Exercise repository attention.",
        status: "active",
        currentMilestone: "Queue milestone",
        nextAction: "Configure the repository.",
        workClassification: "codex"
      });
      upsertProjectMetadata(db, { projectId: project.id, repoPath: path.join(workspace, "does-not-exist") });
    });

    const queue = withDatabase(workspace, (db) => buildAgentQueue(db));

    expect(queue.ready).toHaveLength(0);
    expect(queue.attention).toHaveLength(1);
    expect(queue.attention[0]).toMatchObject({
      attentionKind: "repository",
      reason: "Project repository path is missing or not a directory."
    });
  });

  it("skips an explicitly higher blocked Action without overriding the checked-in pointer", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc().replaceAll("current_action: ship-it", "current_action: migrate"));
    writeDoc(repo, "docs/plans/queue-plan.md", planDoc().replaceAll("current_action: ship-it", "current_action: migrate"));
    const workspace = queueWorkspace(repo);

    const queue = withDatabase(workspace, (db) => {
      arrangeActionOrder(db, {
        currentKeys: ["demo/migrate", "demo/ship-it"],
        order: ["demo/ship-it", "demo/migrate"],
        requestId: "blocked-first",
        apply: true
      });
      return buildAgentQueue(db);
    });

    expect(queue.orderValid).toBe(true);
    expect(queue.ordered.map((entry) => [entry.orderKey, entry.state])).toEqual([
      ["demo/ship-it", "attention"],
      ["demo/migrate", "ready"]
    ]);
    expect(queue.nextActionKey).toBe("demo/migrate");
    expect(queue.ready[0]).toMatchObject({ actionId: "migrate", pointerAuthorized: true });
    expect(queue.undoReceipt).toMatchObject({ requestId: "blocked-first", revisionAfter: 1, applied: true });
  });

  it("removes completed Actions and rejects newly discovered Actions without an explicit position", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc());
    writeDoc(repo, "docs/plans/queue-plan.md", planDoc());
    const workspace = queueWorkspace(repo);
    withDatabase(workspace, (db) => arrangeActionOrder(db, {
      currentKeys: ["demo/migrate", "demo/ship-it"],
      order: ["demo/migrate", "demo/ship-it"],
      requestId: "initial-order",
      apply: true
    }));

    writeDoc(repo, "docs/plans/queue-plan.md", planDoc().replace("    status: open\n    responsibility: codex", "    status: done\n    responsibility: codex"));
    const completed = withDatabase(workspace, (db) => buildAgentQueue(db));
    expect(completed.ordered.map((entry) => entry.orderKey)).toEqual(["demo/ship-it"]);
    expect(completed.orderValid).toBe(true);
    expect(completed.nextActionKey).toBe("demo/ship-it");

    const withNewAction = planDoc()
      .replace("    status: open\n    responsibility: codex", "    status: done\n    responsibility: codex")
      .replace("---\n\n# Queue plan", [
        "  - id: document-it",
        "    title: Document the queue",
        "    status: open",
        "    responsibility: codex",
        "    next_action: Write the queue guide.",
        "    expected_artifact: A queue guide",
        "    clarification: clarified",
        "    acceptance_criteria:",
        "      - The guide exists.",
        "    depends_on: []",
        "---",
        "",
        "# Queue plan"
      ].join("\n"));
    writeDoc(repo, "docs/plans/queue-plan.md", withNewAction);
    const inserted = withDatabase(workspace, (db) => buildAgentQueue(db));
    expect(inserted.ordered.map((entry) => entry.orderKey)).toEqual(["demo/ship-it", "demo/document-it"]);
    expect(inserted.unpositionedCount).toBe(1);
    expect(inserted.orderValid).toBe(false);
    expect(inserted.nextActionKey).toBeNull();
  });

  it("previews and applies the exact governed pointer transition", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc());
    writeDoc(repo, "docs/plans/queue-plan.md", planDoc());
    commitFixture(repo);
    const workspace = queueWorkspace(repo);
    withDatabase(workspace, (db) => arrangeActionOrder(db, {
      currentKeys: ["demo/migrate", "demo/ship-it"],
      order: ["demo/migrate", "demo/ship-it"],
      requestId: "pointer-order",
      apply: true
    }));

    const preview = runAdvanceQueueMakeNextCommand({
      workspace,
      actionKey: "demo/migrate",
      requestId: "pointer-1",
      revision: 1
    });
    expect(preview.data.receipt).toMatchObject({
      applied: false,
      previousAction: "ship-it",
      nextAction: "migrate"
    });
    expect(() => runAdvanceQueueMakeNextCommand({
      workspace,
      actionKey: "demo/migrate",
      requestId: "pointer-1",
      revision: 1,
      apply: true
    })).toThrow(/does not match the current preview/);

    const applied = runAdvanceQueueMakeNextCommand({
      workspace,
      actionKey: "demo/migrate",
      requestId: "pointer-1",
      revision: 1,
      previewFingerprint: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(applied.data.nextActionKey).toBe("demo/migrate");
    expect(applied.data.receipt.applied).toBe(true);
    expect(projectDoc().includes("current_action: ship-it")).toBe(true);
    expect(readFile(repo, "PROJECT.md")).toContain("current_action: migrate");
    expect(readFile(repo, "docs/plans/queue-plan.md")).toContain("current_action: migrate");

    const replay = runAdvanceQueueMakeNextCommand({
      workspace,
      actionKey: "demo/migrate",
      requestId: "pointer-1",
      revision: 1,
      previewFingerprint: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(replay.data.receipt).toEqual(applied.data.receipt);
  });
});

function readFile(root: string, relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}
