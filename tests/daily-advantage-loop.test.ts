import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runReviewApproveCommand, runReviewRequiredCommand } from "../src/commands/review.js";
import { runWorkPlanCommand } from "../src/commands/work.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import {
  countRows,
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact,
  getWorkItem,
  listReviewItems,
  updateWorkItem,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Daily Advantage existing-Action planning preparation", () => {
  it("creates one packet-bound Decision for the original eligible Rebuster Action without execution", () => {
    const fixture = createRebusterFixture();
    const initialState = planningState(fixture.workspace, fixture.workItemId);
    const initialSnapshot = buildDashboardSnapshot({ workspace: fixture.workspace });
    expect(initialSnapshot.dailyAdvantage).toMatchObject({
      actionId: fixture.workItemId,
      projectId: fixture.projectId,
      projectName: "Rebuster",
      milestoneId: fixture.milestoneId,
      milestoneTitle: "Correct text layout in generated videos",
      actionTitle: expect.stringContaining("Eyes on the Prize"),
      expectedArtifact: fixture.expectedArtifact,
      repositoryPath: fixture.repo,
      status: "ready",
      statusLabel: "Ready to Prepare",
      decisionId: null
    });
    expect(initialSnapshot.dailyAdvantage?.whyItMatters).toContain("active “Correct text layout in generated videos” Milestone");
    expect(initialSnapshot.dailyAdvantage?.whyNow).toContain("newest eligible Action");
    expect(planningState(fixture.workspace, fixture.workItemId).counts).toEqual(initialState.counts);

    const prepared = runWorkPlanCommand({ workspace: fixture.workspace, workId: fixture.workItemId });

    expect(prepared.data.reused).toBe(false);
    expect(prepared.data.plan).toMatchObject({ work_item_id: fixture.workItemId, status: "planned" });
    expect(prepared.data.plan.steps).toHaveLength(1);
    expect(prepared.data.plan.steps[0]).toMatchObject({ executor_type: "codex_planning", safe_to_run: 0 });
    expect(prepared.data.codexInvocation).toMatchObject({
      purpose: "planning",
      status: "packet_created",
      work_item_id: fixture.workItemId,
      plan_id: prepared.data.plan.id,
      plan_step_id: prepared.data.plan.steps[0]?.id
    });
    expect(prepared.data.packetArtifact).toMatchObject({
      project_id: fixture.projectId,
      work_item_id: fixture.workItemId,
      artifact_type: "codex_prompt_packet",
      status: "drafted"
    });
    expect(prepared.data.planningDecision).toMatchObject({
      status: "open",
      resolved_intent: "CodexPlanningRunApproval",
      project_id: fixture.projectId,
      work_item_id: fixture.workItemId,
      plan_id: prepared.data.plan.id,
      artifact_id: prepared.data.packetArtifact?.id,
      codex_invocation_id: prepared.data.codexInvocation?.id
    });

    const context = JSON.parse(prepared.data.planningDecision!.context_json) as Record<string, unknown>;
    expect(context).toMatchObject({
      originatingActionId: fixture.workItemId,
      expectedArtifact: fixture.expectedArtifact,
      approvalAuthorizes: "One managed read-only Codex planning Run for this exact packet.",
      responsibility: "needs_mark"
    });
    expect(context.preparationSource).toBe("existing_action");
    expect(context.packetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(context.safetyBoundaries).toEqual(expect.arrayContaining([
      "No implementation or repository writes",
      "No publishing",
      "No credential use",
      "No destructive actions"
    ]));

    const review = runReviewRequiredCommand({ workspace: fixture.workspace });
    expect(review.data.items).toHaveLength(1);
    expect(review.data.items[0]).toMatchObject({
      id: prepared.data.planningDecision?.id,
      project: "Rebuster",
      workItemId: fixture.workItemId,
      actionId: fixture.workItemId,
      packetArtifactId: prepared.data.packetArtifact?.id,
      codexInvocationId: prepared.data.codexInvocation?.id
    });
    expect(review.data.items[0]?.decisionNeeded).toContain("existing Action");
    expect(review.data.items[0]?.recommendation).toContain("read-only planning Run");

    const state = planningState(fixture.workspace, fixture.workItemId);
    expect(state.counts).toEqual({ actions: 1, plans: 1, invocations: 1, decisions: 1, runs: 0, artifacts: 3 });
    expect(state.action).toMatchObject({
      id: fixture.workItemId,
      queue: "needs_mark",
      work_classification: "needs_mark",
      status: "open",
      expected_artifact: fixture.expectedArtifact
    });
    expect(state.action?.next_action).toBe("Review the planning packet and approve, reject, or defer its Decision.");

    const promptPath = path.join(fixture.workspace, prepared.data.codexInvocation!.prompt_path);
    const finalPath = path.join(fixture.workspace, prepared.data.codexInvocation!.final_message_path);
    const metadataPath = path.join(path.dirname(promptPath), "metadata.json");
    expect(existsSync(promptPath)).toBe(true);
    expect(readFileSync(promptPath, "utf8")).toContain(fixture.expectedArtifact);
    expect(readFileSync(finalPath, "utf8")).toBe("Codex has not been invoked yet.\n");
    expect(JSON.parse(readFileSync(metadataPath, "utf8"))).toMatchObject({
      invocationId: prepared.data.codexInvocation?.id,
      workItemId: fixture.workItemId,
      planId: prepared.data.plan.id,
      project: { id: fixture.projectId, name: "Rebuster", repoPath: fixture.repo }
    });

    const preparedSnapshot = buildDashboardSnapshot({ workspace: fixture.workspace });
    expect(preparedSnapshot.dailyAdvantage).toMatchObject({
      actionId: fixture.workItemId,
      status: "prepared",
      statusLabel: "Decision Ready",
      decisionId: prepared.data.planningDecision?.id,
      decisionSlug: prepared.data.planningDecision?.slug,
      packetPath: prepared.data.packetArtifact?.path
    });
    expect(preparedSnapshot.dailyAdvantage?.whyNow).toContain("Finish this Decision");
  });

  it("prepares a Claude Code packet when the Action requests the Claude planning profile", () => {
    const fixture = createRebusterFixture();

    const prepared = runWorkPlanCommand({
      workspace: fixture.workspace,
      workId: fixture.workItemId,
      agentProfile: "claude_planning"
    });

    expect(prepared.data.codexInvocation).toMatchObject({
      agent_profile: "claude_planning",
      purpose: "planning",
      status: "packet_created"
    });
    expect(prepared.data.codexInvocation?.command).toContain("claude --print --output-format json");
    expect(prepared.data.codexInvocation?.command).not.toContain("--output-last-message");
    expect(prepared.data.packetArtifact?.title).toContain("Claude Code planning packet");

    const promptPath = path.join(fixture.workspace, prepared.data.codexInvocation!.prompt_path);
    const finalPath = path.join(fixture.workspace, prepared.data.codexInvocation!.final_message_path);
    expect(readFileSync(promptPath, "utf8")).toContain("# Arcadia Claude Code Planning Packet");
    expect(readFileSync(finalPath, "utf8")).toBe("Claude Code has not been invoked yet.\n");

    const context = JSON.parse(prepared.data.planningDecision!.context_json) as Record<string, unknown>;
    expect(context.approvalAuthorizes).toBe("One managed read-only Claude Code planning Run for this exact packet.");
  });

  it("is idempotent for repeated preparation of the same Action", () => {
    const fixture = createRebusterFixture();
    const first = runWorkPlanCommand({ workspace: fixture.workspace, workId: fixture.workItemId });
    const second = runWorkPlanCommand({ workspace: fixture.workspace, workId: fixture.workItemId });

    expect(second.data.reused).toBe(true);
    expect(second.data.plan.id).toBe(first.data.plan.id);
    expect(second.data.codexInvocation?.id).toBe(first.data.codexInvocation?.id);
    expect(second.data.packetArtifact?.id).toBe(first.data.packetArtifact?.id);
    expect(second.data.planningDecision?.id).toBe(first.data.planningDecision?.id);
    expect(planningState(fixture.workspace, fixture.workItemId).counts).toEqual({
      actions: 1,
      plans: 1,
      invocations: 1,
      decisions: 1,
      runs: 0,
      artifacts: 3
    });
  });

  it("rejects completed and blocked Actions with precise reasons", () => {
    const completed = createRebusterFixture();
    withDatabase(completed.workspace, (db) => updateWorkItem(db, completed.workItemId, { status: "done" }));
    expect(() => runWorkPlanCommand({ workspace: completed.workspace, workId: completed.workItemId }))
      .toThrow("Completed Action cannot be prepared for planning.");

    const blocked = createRebusterFixture();
    withDatabase(blocked.workspace, (db) => updateWorkItem(db, blocked.workItemId, {
      queue: "blocked",
      workClassification: "blocked",
      status: "blocked"
    }));
    expect(() => runWorkPlanCommand({ workspace: blocked.workspace, workId: blocked.workItemId }))
      .toThrow("Blocked Action cannot be prepared for planning.");
  });

  it("rejects missing Project, repository, and expected-Artifact context", () => {
    const noProject = createWorkspace();
    const noProjectAction = withDatabase(noProject.workspace, (db) => createWorkItemWithOptionalArtifact(db, {
      title: "Prepare a bounded layout remediation plan",
      rawInput: "Prepare a bounded layout remediation plan for Eyes on the Prize.",
      queue: "work_queue",
      workClassification: "codex",
      nextAction: "Prepare a bounded layout remediation plan.",
      expectedArtifact: "Layout remediation plan"
    }).workItem);
    expect(() => runWorkPlanCommand({ workspace: noProject.workspace, workId: noProjectAction.id }))
      .toThrow("Action must belong to a Project before planning preparation.");

    const noRepo = createRebusterFixture({ repoPath: null });
    expect(() => runWorkPlanCommand({ workspace: noRepo.workspace, workId: noRepo.workItemId }))
      .toThrow("Action Project repository path is required before planning preparation.");

    const noArtifact = createRebusterFixture({ expectedArtifact: null });
    expect(() => runWorkPlanCommand({ workspace: noArtifact.workspace, workId: noArtifact.workItemId }))
      .toThrow("Action expected planning Artifact is required before planning preparation.");
  });

  it("rejects an Action that already has managed planning execution underway", () => {
    const fixture = createRebusterFixture();
    const prepared = runWorkPlanCommand({ workspace: fixture.workspace, workId: fixture.workItemId });
    const approved = runReviewApproveCommand({
      workspace: fixture.workspace,
      id: prepared.data.planningDecision!.id
    });
    expect(approved.data.run?.id).toBeTruthy();

    expect(() => runWorkPlanCommand({ workspace: fixture.workspace, workId: fixture.workItemId }))
      .toThrow("Action already has managed planning execution underway.");
    const state = planningState(fixture.workspace, fixture.workItemId);
    expect(state.counts.runs).toBe(1);
    expect(state.invocationStatus).toBe("packet_created");
  });

  it("selects one newest eligible Action deterministically without writing SQLite state", () => {
    const fixture = createRebusterFixture();
    const second = withDatabase(fixture.workspace, (db) => {
      const created = createWorkItemWithOptionalArtifact(db, {
        projectId: fixture.projectId,
        milestoneId: fixture.milestoneId,
        title: "Map the single-line answer layout boundary",
        rawInput: "Map the single-line answer layout boundary.",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Prepare a bounded typography layout plan.",
        expectedArtifact: "Single-line typography boundary plan"
      }).workItem;
      db.prepare("UPDATE work_items SET created_at = ? WHERE id = ?").run("2026-07-18T12:00:00.000Z", fixture.workItemId);
      db.prepare("UPDATE work_items SET created_at = ? WHERE id = ?").run("2026-07-18T13:00:00.000Z", created.id);
      return created;
    });
    const before = withDatabase(fixture.workspace, (db) => ({
      plans: countRows(db, "execution_plans"),
      decisions: countRows(db, "review_items"),
      invocations: countRows(db, "codex_invocations"),
      runs: countRows(db, "execution_runs"),
      artifacts: countRows(db, "artifacts")
    }));

    const first = buildDashboardSnapshot({ workspace: fixture.workspace });
    const repeated = buildDashboardSnapshot({ workspace: fixture.workspace });
    expect(first.dailyAdvantage?.actionId).toBe(second.id);
    expect(repeated.dailyAdvantage).toEqual(first.dailyAdvantage);
    expect(withDatabase(fixture.workspace, (db) => ({
      plans: countRows(db, "execution_plans"),
      decisions: countRows(db, "review_items"),
      invocations: countRows(db, "codex_invocations"),
      runs: countRows(db, "execution_runs"),
      artifacts: countRows(db, "artifacts")
    }))).toEqual(before);
  });
});

interface FixtureOptions {
  repoPath?: string | null;
  expectedArtifact?: string | null;
}

function createRebusterFixture(options: FixtureOptions = {}) {
  const createdWorkspace = createWorkspace();
  const expectedArtifact = options.expectedArtifact === undefined
    ? "Eyes on the Prize layout remediation plan with regression-test acceptance criteria"
    : options.expectedArtifact;
  const created = withDatabase(createdWorkspace.workspace, (db) => {
    const bundle = createProjectWithInitialWork(db, {
      name: "Rebuster",
      mission: "Create clear, high-quality rebus puzzle videos.",
      goal: "Make generated rebus video layouts reliable.",
      status: "active",
      currentMilestone: "Correct text layout in generated videos",
      nextAction: "Prepare a bounded remediation plan for the Eyes on the Prize text layout bug.",
      expectedArtifact: expectedArtifact ?? undefined,
      workClassification: "codex"
    });
    upsertProjectMetadata(db, {
      projectId: bundle.project.id,
      aliases: ["Rebuster Studio"],
      repoPath: options.repoPath === undefined ? createdWorkspace.repo : options.repoPath,
      statusSummary: "The lower text line is rendered above the upper line for one real puzzle.",
      validationCommands: ["pnpm test -- --runInBand layout"]
    });
    return bundle;
  });
  return {
    ...createdWorkspace,
    projectId: created.project.id,
    milestoneId: created.milestone.id,
    workItemId: created.workItem.id,
    expectedArtifact
  };
}

function createWorkspace(): { workspace: string; repo: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-daily-advantage-"));
  roots.push(workspace);
  const repo = path.join(workspace, "rebuster-repo");
  mkdirSync(repo, { recursive: true });
  initWorkspace(workspace);
  return { workspace, repo };
}

function planningState(workspace: string, workItemId: string) {
  return withDatabase(workspace, (db) => {
    const invocation = db.prepare(
      "SELECT status FROM codex_invocations WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(workItemId) as { status: string } | undefined;
    return {
      action: getWorkItem(db, workItemId),
      invocationStatus: invocation?.status ?? null,
      counts: {
        actions: countRows(db, "work_items"),
        plans: countRows(db, "execution_plans"),
        invocations: countRows(db, "codex_invocations"),
        decisions: listReviewItems(db, "all").length,
        runs: countRows(db, "execution_runs"),
        artifacts: countRows(db, "artifacts")
      }
    };
  });
}
