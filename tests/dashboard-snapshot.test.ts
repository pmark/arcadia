import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDashboardSnapshotCommand } from "../src/commands/dashboard.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createExecutionPlan,
  createExecutionRun,
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact,
  getWorkItem,
  updateProjectStatus
} from "../src/db/repositories.js";
import { ensureBuiltInSkills, planStepsForWorkItem } from "../src/execution/skills.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("dashboard snapshot", () => {
  it("builds a read-only dashboard snapshot without writing the status report", () => {
    const workspace = initializedWorkspace();
    const paths = getWorkspacePaths(workspace);

    withDatabase(workspace, (db) => {
      const active = createProjectWithInitialWork(db, {
        name: "Active Project",
        mission: "Keep momentum visible.",
        status: "active",
        currentMilestone: "Ship Mission Control",
        nextAction: "Open the local dashboard",
        expectedArtifact: "Dashboard v0",
        workClassification: "codex"
      });
      const paused = createProjectWithInitialWork(db, {
        name: "Paused Project",
        mission: "Wait for external timing.",
        status: "active",
        currentMilestone: "Hold",
        nextAction: "Revisit later",
        workClassification: "autonomous"
      });
      const incubating = createProjectWithInitialWork(db, {
        name: "Incubating Project",
        mission: "Explore a possible direction.",
        status: "active",
        currentMilestone: "Collect signals",
        nextAction: "Capture one more note",
        workClassification: "autonomous"
      });

      updateProjectStatus(db, paused.project.id, "paused");
      updateProjectStatus(db, incubating.project.id, "incubating");

      createWorkItemWithOptionalArtifact(db, {
        projectId: active.project.id,
        milestoneId: active.milestone.id,
        title: "Decision pending",
        rawInput: "Decision pending",
        queue: "needs_mark",
        workClassification: "needs_mark",
        nextAction: "Choose the dashboard release boundary"
      });
    });

    expect(existsSync(paths.statusReport)).toBe(false);

    const snapshot = buildDashboardSnapshot({ workspace });

    expect(snapshot.counts.activeProjects).toBe(1);
    expect(snapshot.counts.pausedProjects).toBe(1);
    expect(snapshot.counts.incubatingProjects).toBe(1);
    expect(snapshot.counts.requiresReview).toBe(1);
    expect(snapshot.projects.find((project) => project.name === "Active Project")?.lastArtifact?.title).toBe(
      "Dashboard v0"
    );
    expect(snapshot.currentMilestones.map((milestone) => milestone.title)).toContain("Ship Mission Control");
    expect(existsSync(paths.statusReport)).toBe(false);
  });

  it("uses Requires Review for all UI-facing labels", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      ensureBuiltInSkills(db);
      const created = createWorkItemWithOptionalArtifact(db, {
        title: "Review boundary",
        rawInput: "Review boundary",
        queue: "needs_mark",
        workClassification: "needs_mark",
        nextAction: "Pick the release boundary"
      });
      const workItem = getWorkItem(db, created.workItem.id);
      expect(workItem).not.toBeNull();
      const plan = createExecutionPlan(db, {
        workItemId: created.workItem.id,
        summary: "Pause for review.",
        steps: planStepsForWorkItem(workItem!)
      });
      expect(plan).not.toBeNull();
      const run = createExecutionRun(db, {
        workItemId: created.workItem.id,
        planId: plan!.id,
        status: "needs_mark",
        summary: "Paused for review.",
        steps: [
          {
            planStepId: plan!.steps[0].id,
            status: "needs_mark",
            output: "Requires review",
            error: "Requires review"
          }
        ]
      });
      expect(run).not.toBeNull();
    });

    const response = runDashboardSnapshotCommand({ workspace });
    const snapshot = response.data.snapshot;
    const labels = [
      ...snapshot.projects.flatMap((project) => [project.statusLabel, project.workClassificationLabel ?? ""]),
      ...snapshot.requiresReviewItems.flatMap((item) => [
        item.queueLabel,
        item.workClassificationLabel,
        item.statusLabel
      ]),
      ...snapshot.recentRuns.map((run) => run.statusLabel)
    ].join("\n");

    expect(response.command).toBe("dashboard.snapshot");
    expect(response.artifacts).toEqual([]);
    expect(labels).toContain("Requires Review");
    expect(labels).not.toContain("Needs Mark");
  });
});

function createTempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-dashboard-test-"));
  workspaces.push(workspace);
  return workspace;
}

function initializedWorkspace(): string {
  const workspace = createTempWorkspace();
  initWorkspace(workspace);
  return workspace;
}
