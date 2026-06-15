import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
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
  upsertProjectMetadata,
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
        goal: "Ship a managed dashboard workflow.",
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
      upsertProjectMetadata(db, {
        projectId: active.project.id,
        aliases: ["active"],
        repoPath: "/Users/pmark/Dev/MR/ActiveProject/repo",
        statusSummary: "Dashboard test repository.",
        validationCommands: ["pnpm test"]
      });

      createWorkItemWithOptionalArtifact(db, {
        projectId: active.project.id,
        milestoneId: active.milestone.id,
        title: "Decision pending",
        rawInput: "Decision pending",
        queue: "requires_review",
        workClassification: "requires_review",
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
        summary: "Codex planning packet review.",
        steps: planStepsForWorkItem(workItem!)
      });
      expect(plan).not.toBeNull();
      createCodexInvocation(db, {
        id: "codex_packet_pinterest",
        purpose: "planning",
        agentProfile: "codex",
        workspaceScope: "/Users/pmark/Dev/MR/ActiveProject/repo",
        command: "codex --cd /Users/pmark/Dev/MR/ActiveProject/repo -",
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
        title: "Codex planning packet: Pinterest publishing",
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
      "Codex planning packet: Pinterest publishing"
    );
    expect(snapshot.recentArtifacts.map((artifact) => artifact.title)).toContain("Dashboard v0");
    expect(snapshot.currentMilestones.map((milestone) => milestone.title)).toContain("Ship Mission Control");
    const attention = runAttentionCommand({ workspace });
    expect(attention.data.items.map((item) => item.id)).toEqual(snapshot.attentionItems.map((item) => item.id));
    expect(attention.data.items.find((item) => item.kind === "codex_packet")?.nextAction).toContain(
      "arcadia work run"
    );
    const codexCard = snapshot.attentionItems.find((item) => item.kind === "codex_packet");
    expect(codexCard).toMatchObject({
      projectName: "Active Project",
      milestone: "Ship Mission Control",
      goal: "Ship a managed dashboard workflow.",
      status: "packet_created",
      statusLabel: "Packet Created",
      expectedArtifact: "Dashboard v0",
      targetRepositoryRoot: "/Users/pmark/Dev/MR/ActiveProject/repo",
      relatedArtifactPath: "prompts/codex/codex_packet_pinterest/prompt.md",
      finalArtifactPath: "prompts/codex/codex_packet_pinterest/final.md",
      validationPath: "prompts/codex/codex_packet_pinterest/planning-validation.json"
    });
    expect(codexCard?.primaryActions.map((action) => action.label)).toEqual([
      "View Packet",
      "Approve & Run",
      "View Final Artifact",
      "View Validation"
    ]);
    expect(existsSync(paths.statusReport)).toBe(false);
  });

  it("uses Requires Review for all UI-facing labels", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      ensureBuiltInSkills(db);
      const created = createWorkItemWithOptionalArtifact(db, {
        title: "Review boundary",
        rawInput: "Review boundary",
        queue: "requires_review",
        workClassification: "requires_review",
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
        status: "requires_review",
        summary: "Paused for review.",
        steps: [
          {
            planStepId: plan!.steps[0].id,
            status: "requires_review",
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

  it("surfaces missing project repository path as a blocking setup issue", () => {
    const workspace = initializedWorkspace();
    withDatabase(workspace, (db) => {
      createProjectWithInitialWork(db, {
        name: "Repo Setup Project",
        mission: "Require explicit repository setup.",
        goal: "Run project Codex work only in the configured repository.",
        status: "active",
        currentMilestone: "Repository setup",
        nextAction: "Set repository path.",
        workClassification: "codex"
      });
    });

    const ask = runAskCommand({
      workspace,
      request: "Plan repository setup validation for Repo Setup Project."
    });
    expect(ask.data.result.status).toBe("requires_review");

    const snapshot = buildDashboardSnapshot({ workspace });
    const blocker = snapshot.attentionItems.find((item) =>
      item.reason.includes("This project needs a repository path before Arcadia can run Codex on its files.")
    );

    expect(blocker).toMatchObject({
      kind: "review",
      severity: "action",
      projectName: "Repo Setup Project",
      reason: "Requires Review: This project needs a repository path before Arcadia can run Codex on its files.",
      targetRepositoryRoot: null
    });
  });

  it("keeps legacy project Codex packets readable without treating workspace scope as runnable", () => {
    const workspace = initializedWorkspace();
    withDatabase(workspace, (db) => {
      ensureBuiltInSkills(db);
      const created = createProjectWithInitialWork(db, {
        name: "Legacy Packet Project",
        mission: "Keep old packet records inspectable.",
        goal: "Avoid workspace fallback for project Codex work.",
        status: "active",
        currentMilestone: "Packet audit",
        nextAction: "Set repository path.",
        workClassification: "codex"
      });
      const workItem = getWorkItem(db, created.workItem.id);
      expect(workItem).not.toBeNull();
      const plan = createExecutionPlan(db, {
        workItemId: created.workItem.id,
        summary: "Legacy packet.",
        steps: planStepsForWorkItem(workItem!)
      });
      expect(plan).not.toBeNull();
      createCodexInvocation(db, {
        id: "codex_legacy_workspace_scope",
        purpose: "planning",
        agentProfile: "codex",
        workspaceScope: workspace,
        command: `codex --cd ${workspace} -`,
        promptPath: "prompts/codex/codex_legacy_workspace_scope/prompt.md",
        jsonlOutputPath: "prompts/codex/codex_legacy_workspace_scope/output.jsonl",
        finalMessagePath: "prompts/codex/codex_legacy_workspace_scope/final.md",
        status: "packet_created",
        workItemId: created.workItem.id,
        planId: plan!.id,
        planStepId: plan!.steps[0].id
      });
    });

    const snapshot = buildDashboardSnapshot({ workspace });
    const card = snapshot.attentionItems.find((item) => item.relatedCodexInvocationId === "codex_legacy_workspace_scope");

    expect(card).toMatchObject({
      kind: "codex_packet",
      severity: "blocked",
      reason: "This project needs a repository path before Arcadia can run Codex on its files.",
      targetRepositoryRoot: null
    });
    expect(card?.primaryActions.map((action) => action.label)).not.toContain("Approve & Run");
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
