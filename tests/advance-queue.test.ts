import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentQueue } from "../src/dispatch/queue.js";
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
      selected: true,
      planSlug: "queue-plan",
      tokenImpact: "medium",
      tokenBudget: "One bounded implementation pass; validation is deterministic."
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
});
