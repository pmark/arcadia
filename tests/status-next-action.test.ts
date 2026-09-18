import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runStatusCommand } from "../src/commands/status.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, createWorkItemWithOptionalArtifact, listProjectSummaries } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-status-next-action-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

describe("status report next Actions", () => {
  /**
   * The report used to answer "what is next" with the most recently *touched*
   * open Action, so the newest row won regardless of whether it could be
   * started. That named blocked and superseded work on the one surface an
   * operator orients from, which is worse than naming nothing at all.
   */
  it("does not name the most recently touched Action just because it is newest", () => {
    const workspace = tempWorkspace();

    withDatabase(workspace, (db) => {
      const bundle = createProjectWithInitialWork(db, {
        name: "Fixture",
        mission: "Prove the status report resolves next Actions through dispatch.",
        status: "active",
        currentMilestone: "First milestone",
        nextAction: "The genuinely first action",
        workClassification: "agent"
      });

      createWorkItemWithOptionalArtifact(db, {
        projectId: bundle.project.id,
        title: "Touched last",
        rawInput: "Touched last",
        queue: "work_queue",
        workClassification: "agent",
        nextAction: "The most recently touched action"
      });
    });

    const response = runStatusCommand({ workspace });
    const project = response.data.projects.find((candidate) => candidate.name === "Fixture");

    expect(project).toBeDefined();
    expect(project?.nextAction).not.toBe("The most recently touched action");
  });

  /**
   * When dispatch has nothing eligible, saying so and naming the blocker beats
   * falling back to a startable-looking Action the operator cannot actually run.
   */
  it("reports the blocker when no Action is ready", () => {
    const workspace = tempWorkspace();

    withDatabase(workspace, (db) => {
      createProjectWithInitialWork(db, {
        name: "No repository",
        mission: "A Project with no repository path cannot dispatch anything.",
        status: "active",
        currentMilestone: "First milestone",
        nextAction: "Something that looks startable",
        workClassification: "agent"
      });
    });

    const response = runStatusCommand({ workspace });
    const project = response.data.projects.find((candidate) => candidate.name === "No repository");

    expect(project?.nextAction).toMatch(/^Nothing ready/);
    expect(project?.nextAction).not.toBe("Something that looks startable");
  });

  /**
   * A Project's reported responsibility is "the most recent unfinished Action",
   * and two Actions created in the same millisecond used to make that an
   * arbitrary choice: `ORDER BY updated_at DESC, created_at DESC LIMIT 1` with
   * no further tiebreak lets SQLite return either row. The margin in practice
   * is one millisecond, so it held under a quiet test run and flipped under a
   * loaded CI shard -- which is how it was found, as an unrelated dashboard
   * assertion failing on a machine that happened to be busy.
   */
  it("reports the later Action's responsibility when two Actions share a timestamp exactly", () => {
    const workspace = tempWorkspace();

    const projectId = withDatabase(workspace, (db) => {
      const bundle = createProjectWithInitialWork(db, {
        name: "Same millisecond",
        mission: "Two Actions, one timestamp.",
        status: "active",
        currentMilestone: "First milestone",
        nextAction: "The earlier action",
        workClassification: "agent"
      });
      createWorkItemWithOptionalArtifact(db, {
        projectId: bundle.project.id,
        title: "Decision pending",
        rawInput: "Decision pending",
        queue: "requires_review",
        workClassification: "requires_review",
        nextAction: "The later action"
      });
      // Force the tie the clock only sometimes produces.
      db.prepare("UPDATE work_items SET created_at = ?, updated_at = ? WHERE project_id = ?")
        .run("2026-09-18T00:00:00.000Z", "2026-09-18T00:00:00.000Z", bundle.project.id);
      return bundle.project.id;
    });

    // Re-read repeatedly: an arbitrary tiebreak can agree by luck once.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const summary = withDatabase(workspace, (db) =>
        listProjectSummaries(db).find((candidate) => candidate.id === projectId)
      );
      expect(summary?.work_classification).toBe("requires_review");
      expect(summary?.responsibility).toBe("requires_review");
    }
  });
});
