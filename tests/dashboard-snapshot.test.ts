import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAttentionCommand, runDashboardSnapshotCommand } from "../src/commands/dashboard.js";
import { runReviewRequiredCommand } from "../src/commands/review.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createExecutionPlan,
  createExecutionRun,
  createArtifactRecord,
  createBackBurnerItem,
  createCodexInvocation,
  createProjectWithInitialWork,
  createReviewItem,
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
      ensureBuiltInSkills(db);
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

      createReviewItem(db, {
        projectId: active.project.id,
        decisionNeeded: "Approve or reject the dashboard release boundary.",
        recommendation: "Approve the release boundary.",
        sourceInput: "Ship the dashboard review flow.",
        proposedAction: "Create review controls for the dashboard.",
        resolvedIntent: "CreateWork",
        confidenceLabel: "medium",
        confidence: 0.62,
        missingFields: ["release boundary"]
      });

      createBackBurnerItem(db, {
        originalInput: "Pinterest might help Rebuster.",
        ingressSource: "cli.ask",
        classification: "Idea",
        confidence: 0.35,
        reason: "Exploratory idea.",
        status: "opportunistic",
        suggestedNextStep: "Leave incubating until it becomes concrete."
      });

      const workItem = getWorkItem(db, active.workItem.id);
      expect(workItem).not.toBeNull();
      const plan = createExecutionPlan(db, {
        workItemId: active.workItem.id,
        summary: "Codex build packet review.",
        steps: planStepsForWorkItem(workItem!)
      });
      expect(plan).not.toBeNull();
      createCodexInvocation(db, {
        id: "codex_packet_pinterest",
        purpose: "build",
        agentProfile: "codex",
        workspaceScope: workspace,
        command: "codex --cd . -",
        promptPath: "prompts/codex/codex_packet_pinterest/prompt.md",
        jsonlOutputPath: "prompts/codex/codex_packet_pinterest/output.jsonl",
        finalMessagePath: "prompts/codex/codex_packet_pinterest/final.md",
        status: "packet_created",
        workItemId: active.workItem.id,
        planId: plan!.id,
        planStepId: plan!.steps.find((step) => step.executor_type === "codex_build")?.id ?? plan!.steps[0].id
      });
      createArtifactRecord(db, {
        projectId: active.project.id,
        workItemId: active.workItem.id,
        title: "Codex build packet: Pinterest publishing",
        artifactType: "codex_prompt_packet",
        status: "drafted",
        path: "prompts/codex/codex_packet_pinterest/prompt.md"
      });
    });

    expect(existsSync(paths.statusReport)).toBe(false);

    const snapshot = buildDashboardSnapshot({ workspace });
    const cliReview = runReviewRequiredCommand({ workspace });

    expect(snapshot.counts.activeProjects).toBe(1);
    expect(snapshot.counts.pausedProjects).toBe(1);
    expect(snapshot.counts.incubatingProjects).toBe(1);
    expect(snapshot.counts.requiresReview).toBe(1);
    expect(snapshot.counts.attention).toBeGreaterThanOrEqual(2);
    expect(snapshot.counts.backBurner).toBe(1);
    expect(snapshot.requiresReviewItems.map((item) => item.id)).toEqual(cliReview.data.items.map((item) => item.id));
    expect(snapshot.attentionItems.some((item) => item.relatedArtifactPath?.includes("codex_packet_pinterest"))).toBe(
      true
    );
    expect(snapshot.activityEvents.map((event) => event.eventType)).toContain("codex_packet_created");
    expect(snapshot.activityEvents.map((event) => event.eventType)).toContain("routed_to_review");
    expect(snapshot.backBurnerItems[0]).toMatchObject({
      originalInput: "Pinterest might help Rebuster.",
      classification: "Idea",
      status: "opportunistic"
    });
    expect(snapshot.requiresReviewItems[0].sourceInput).toBe("Ship the dashboard review flow.");
    expect(snapshot.requiresReviewItems[0].missingFields).toEqual(["release boundary"]);
    expect(snapshot.projects.find((project) => project.name === "Active Project")?.lastArtifact?.title).toBe(
      "Codex build packet: Pinterest publishing"
    );
    expect(snapshot.recentArtifacts.map((artifact) => artifact.title)).toContain("Dashboard v0");
    expect(snapshot.currentMilestones.map((milestone) => milestone.title)).toContain("Ship Mission Control");
    const attention = runAttentionCommand({ workspace });
    expect(attention.data.items.map((item) => item.id)).toEqual(snapshot.attentionItems.map((item) => item.id));
    expect(attention.data.items.find((item) => item.kind === "codex_packet")?.nextAction).toContain(
      "arcadia work run"
    );
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

      createReviewItem(db, {
        decisionNeeded: "Approve or reject the surfaced review.",
        sourceInput: "Review boundary",
        proposedAction: "Surface a Requires Review item.",
        resolvedIntent: "ReviewRequired",
        confidenceLabel: "medium",
        confidence: 0.7
      });
    });

    const response = runDashboardSnapshotCommand({ workspace });
    const snapshot = response.data.snapshot;
    const labels = [
      ...snapshot.projects.flatMap((project) => [project.statusLabel, project.workClassificationLabel ?? ""]),
      ...snapshot.requiresReviewItems.map((item) => item.statusLabel),
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
