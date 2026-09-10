import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runStatusCommand } from "../src/commands/status.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, createWorkItemWithOptionalArtifact } from "../src/db/repositories.js";
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
});
