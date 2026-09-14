import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
import { runAttentionCommand, runDashboardSnapshotCommand } from "../src/commands/dashboard.js";
import { runReviewRequiredCommand } from "../src/commands/review.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import { recordDispatchEvent } from "../src/docs/journal.js";
import {
  createExecutionPlan,
  createExecutionRun,
  createArtifactRecord,
  createBackBurnerItem,
  createCodexInvocation,
  createProjectWithInitialWork,
  createReviewItem,
  createWorkItemWithOptionalArtifact,
  getProjectMetadata,
  getWorkItem,
  setWorkItemDocRef,
  upsertProjectMetadata,
  updateProjectStatus
} from "../src/db/repositories.js";
import { ensureBuiltInSkills, planStepsForWorkItem } from "../src/execution/skills.js";
import { CODEX_REPO_PATH_REQUIRED_MESSAGE, updateProjectSetup } from "../src/projects/setup.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("dashboard snapshot", () => {
  it("retains managed identities for queued Runs outside the recent snapshot window", () => {
    const workspace = initializedWorkspace();
    const workId = withDatabase(workspace, (db) => {
      ensureBuiltInSkills(db);
      const created = createProjectWithInitialWork(db, {
        name: "Old active Run", mission: "Keep active work visible.", status: "active",
        currentMilestone: "Proof", nextAction: "Build proof", workClassification: "agent"
      });
      setWorkItemDocRef(db, created.workItem.id, "plan/old-plan#still-running");
      const work = getWorkItem(db, created.workItem.id)!;
      const plan = createExecutionPlan(db, { workItemId: work.id, summary: "Old work", steps: planStepsForWorkItem(work) })!;
      createExecutionRun(db, { workItemId: work.id, planId: plan.id, status: "running", summary: "Still running", steps: [] });
      return work.id;
    });
    const snapshot = buildDashboardSnapshot({ workspace, runLimit: 0, artifactLimit: 0 });
    expect(snapshot.recentRuns).toEqual([]);
    expect(snapshot.managedActions).toContainEqual(expect.objectContaining({ workItemId: workId, planSlug: "old-plan", actionId: "still-running" }));
  });

  it("keeps an old still-active Run visible past more than ten newer terminal Runs", () => {
    const workspace = initializedWorkspace();
    const runIds = withDatabase(workspace, (db) => {
      ensureBuiltInSkills(db);
      const created = createProjectWithInitialWork(db, {
        name: "Long-running work", mission: "Never truncate an active Run.", status: "active",
        currentMilestone: "Proof", nextAction: "Build proof", workClassification: "agent"
      });
      const work = getWorkItem(db, created.workItem.id)!;
      const plan = createExecutionPlan(db, { workItemId: work.id, summary: "Old work", steps: planStepsForWorkItem(work) })!;
      const oldRun = createExecutionRun(db, { workItemId: work.id, planId: plan.id, status: "running", summary: "Still running after a long time", steps: [] })!;
      db.prepare("UPDATE execution_runs SET updated_at = ?, created_at = ? WHERE id = ?")
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", oldRun.id);

      for (let index = 0; index < 11; index += 1) {
        createExecutionRun(db, { workItemId: work.id, planId: plan.id, status: "completed", summary: `Newer terminal Run ${index}`, steps: [] });
      }

      return { old: oldRun.id };
    });

    const snapshot = buildDashboardSnapshot({ workspace, runLimit: 10 });
    expect(snapshot.recentRuns.map((run) => run.id)).not.toContain(runIds.old);
    expect(snapshot.activeExecutionRuns.map((run) => run.id)).toContain(runIds.old);
    expect(snapshot.counts.activeRuns).toBe(1);
    expect(snapshot.agentQueue.running.some((entry) => entry.runId === runIds.old)).toBe(true);
  });

  it("shows every agent Session lease across the portfolio, including one a Project's repository scan cannot reach", () => {
    const workspace = initializedWorkspace();
    const ids = withDatabase(workspace, (db) => {
      ensureBuiltInSkills(db);
      const created = createProjectWithInitialWork(db, {
        name: "No repository path yet", mission: "Prove Sessions never disappear.", status: "active",
        currentMilestone: "Proof", nextAction: "Build proof", workClassification: "agent"
      });
      const work = getWorkItem(db, created.workItem.id)!;
      // Deliberately no upsertProjectMetadata repo_path: buildAgentQueue's
      // per-Project scan bails out before it ever looks at Sessions, so a
      // lease here is only visible through the portfolio-wide Session query.
      createCodexInvocation(db, {
        id: "packet_lease_proof", purpose: "build", agentProfile: "claude_build", workspaceScope: "/tmp/lease-proof",
        command: "claude", promptPath: "prompts/lease-proof/prompt.md", jsonlOutputPath: "prompts/lease-proof/output.jsonl",
        finalMessagePath: "prompts/lease-proof/final.md", status: "packet_created", workItemId: work.id
      });
      db.prepare(
        `INSERT INTO agent_sessions (
          id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id,
          packet_id, packet_path, packet_sha256, authorizing_decisions_json, execution_profile_json,
          provider_profile, provider, model, effort, provider_mapping_id, provider_binding_id,
          base_revision, branch, worktree_path, provider_session_id, display_name, terminal_transport,
          tmux_session_name, host, status, prepared_at, started_at, ended_at, exit_status, created_at, updated_at
        ) VALUES (
          @id, @project_id, @project_slug, @repository_path, @plan_path, @plan_slug, @action_id, @work_item_id,
          @packet_id, @packet_path, @packet_sha256, @authorizing_decisions_json, @execution_profile_json,
          @provider_profile, @provider, @model, @effort, @provider_mapping_id, @provider_binding_id,
          @base_revision, @branch, @worktree_path, @provider_session_id, @display_name, @terminal_transport,
          @tmux_session_name, @host, @status, @prepared_at, @started_at, @ended_at, @exit_status, @created_at, @updated_at
        )`
      ).run({
        id: "session_lease_proof", project_id: created.project.id, project_slug: created.project.slug,
        repository_path: "/tmp/lease-proof-repo", plan_path: "docs/plans/lease-proof.md", plan_slug: "lease-proof",
        action_id: "build-proof", work_item_id: work.id, packet_id: "packet_lease_proof",
        packet_path: "prompts/lease-proof/prompt.md", packet_sha256: "sha", authorizing_decisions_json: "[]",
        execution_profile_json: null, provider_profile: "claude_build", provider: "claude-code-cli", model: "sonnet",
        effort: "high", provider_mapping_id: null, provider_binding_id: null, base_revision: "0000000",
        branch: "claude/lease-proof", worktree_path: "/tmp/lease-proof-worktree", provider_session_id: "native-session-id",
        display_name: "Lease proof", terminal_transport: "tmux", tmux_session_name: "arcadia-lease-proof",
        host: "proof-host.local", status: "running", prepared_at: "2026-01-01T00:00:00.000Z", started_at: "2026-01-01T00:00:01.000Z",
        ended_at: null, exit_status: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:01.000Z"
      });
      return { project: created.project.id, work: work.id };
    });

    const snapshot = buildDashboardSnapshot({ workspace });
    const session = snapshot.activeAgentSessions.find((entry) => entry.id === "session_lease_proof");
    expect(session).toMatchObject({
      projectId: ids.project,
      actionId: "build-proof",
      host: "proof-host.local",
      provider: "claude-code-cli",
      model: "sonnet",
      status: "running",
      live: false,
      reattachCommand: "tmux attach-session -t arcadia-lease-proof",
      phoneLimitationNotice: expect.stringContaining("phone-only client cannot execute it")
    });
    expect(snapshot.agentQueue.running.some((entry) => entry.id === "session:session_lease_proof")).toBe(true);
  });

  it("carries database-to-managed identities for Decisions, Runs, and Artifacts", () => {
    const workspace = initializedWorkspace();
    const ids = withDatabase(workspace, (db) => {
      ensureBuiltInSkills(db);
      const created = createProjectWithInitialWork(db, {
        name: "Identity proof", mission: "Keep links truthful.", status: "active",
        currentMilestone: "Proof", nextAction: "Build proof", workClassification: "agent"
      });
      setWorkItemDocRef(db, created.workItem.id, "plan/identity-plan#build-proof");
      const work = getWorkItem(db, created.workItem.id)!;
      const plan = createExecutionPlan(db, { workItemId: work.id, summary: "Prove identity", steps: planStepsForWorkItem(work) })!;
      const run = createExecutionRun(db, { workItemId: work.id, planId: plan.id, status: "completed", summary: "Proof", steps: [] })!;
      const artifact = createArtifactRecord(db, { projectId: created.project.id, workItemId: work.id, title: "Proof", artifactType: "report", status: "ready", path: "proof.md" });
      const decision = createReviewItem(db, {
        projectId: created.project.id, workItemId: work.id, decisionNeeded: "Accept proof", sourceInput: "Proof",
        proposedAction: "Review proof", resolvedIntent: "CandidateQaSignoff", confidenceLabel: "high", confidence: 1
      });
      return { project: created.project.id, work: work.id, run: run.id, artifact: artifact.id, decision: decision.id };
    });
    const snapshot = buildDashboardSnapshot({ workspace });
    expect(snapshot.managedActions).toContainEqual({ workItemId: ids.work, projectId: ids.project, planSlug: "identity-plan", actionId: "build-proof" });
    expect(snapshot.recentRuns.find((run) => run.id === ids.run)?.workItemId).toBe(ids.work);
    expect(snapshot.recentArtifacts.find((artifact) => artifact.id === ids.artifact)?.workItemId).toBe(ids.work);
    expect(snapshot.requiresReviewItems.find((decision) => decision.id === ids.decision)?.actionId).toBe(ids.work);
  });
  it("reads the optional workspace Review focus", () => {
    const workspace = initializedWorkspace();
    const configPath = getWorkspacePaths(workspace).configFile;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    writeFileSync(configPath, `${JSON.stringify({
      ...config,
      reviewFocus: {
        projectOrder: ["Private Practice Now", "Arcadia"],
        excludedProjects: ["Rebuster"],
        maxItems: 5
      }
    }, null, 2)}\n`);

    expect(buildDashboardSnapshot({ workspace }).reviewFocus).toEqual({
      projectOrder: ["Private Practice Now", "Arcadia"],
      excludedProjects: ["Rebuster"],
      maxItems: 5
    });
  });

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
        workClassification: "agent"
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
    const activeProject = snapshot.projects.find((project) => project.name === "Active Project");
    expect(activeProject).toMatchObject({
      repoPath: "/Users/pmark/Dev/MR/ActiveProject/repo",
      validationCommands: ["pnpm test"],
      setupWarnings: [],
      lastArtifact: expect.objectContaining({ title: "Codex planning packet: Pinterest publishing" })
    });
    expect(snapshot.recentArtifacts.map((artifact) => artifact.title)).toContain("Dashboard v0");
    expect(snapshot.recentArtifacts.find((artifact) => artifact.title === "Dashboard v0")?.projectId).toBe(
      activeProject?.id
    );
    expect(snapshot.currentMilestones.map((milestone) => milestone.title)).toContain("Ship Mission Control");
    const attention = runAttentionCommand({ workspace });
    expect(attention.data.items.map((item) => item.id)).toEqual(snapshot.attentionItems.map((item) => item.id));
    expect(attention.data.items.find((item) => item.kind === "codex_packet")?.nextAction).toContain(
      "arcadia work run"
    );
    const codexCard = snapshot.attentionItems.find((item) => item.kind === "codex_packet");
    expect(codexCard).toMatchObject({
      projectId: activeProject?.id,
      projectName: "Active Project",
      milestone: "Ship Mission Control",
      goal: "Ship a managed dashboard workflow.",
      outcome: "Ship a managed dashboard workflow.",
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
    expect(activeProject).toMatchObject({
      goal: "Ship a managed dashboard workflow.",
      outcome: "Ship a managed dashboard workflow.",
      workClassification: "requires_review",
      responsibility: "requires_review",
      workClassificationLabel: "Requires Review",
      responsibilityLabel: "Requires Review"
    });
    expect(snapshot.requiresReviewItems[0]).toMatchObject({
      decisionId: snapshot.requiresReviewItems[0].id,
      decisionSlug: snapshot.requiresReviewItems[0].slug,
      outcome: "Ship a managed dashboard workflow."
    });
    expect(existsSync(paths.statusReport)).toBe(false);
  });

  it("surfaces the dispatch journal's tally, without running anything", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const blocker = (field: string) => ({
        relativePath: "docs/plans/p.md",
        field,
        message: "m",
        remedy: "r"
      });
      recordDispatchEvent(db, {
        command: "next",
        dispatchable: false,
        blockers: [blocker("actions.a.depends_on")],
        operatorQuestion: null
      });
      recordDispatchEvent(db, {
        command: "next",
        dispatchable: false,
        blockers: [blocker("actions.a.depends_on"), blocker("current_action")],
        operatorQuestion: null
      });
      recordDispatchEvent(db, {
        command: "next",
        dispatchable: true,
        blockers: [],
        operatorQuestion: null
      });
    });

    const snapshot = buildDashboardSnapshot({ workspace });

    expect(snapshot.dispatchJournal).toEqual({
      totalResolutions: 3,
      refused: 2,
      mostFrequentBlockingField: { field: "actions.a.depends_on", resolutions: 2 }
    });
  });

  it("reports an empty dispatch journal as zero, not absent", () => {
    const workspace = initializedWorkspace();

    const snapshot = buildDashboardSnapshot({ workspace });

    expect(snapshot.dispatchJournal).toEqual({
      totalResolutions: 0,
      refused: 0,
      mostFrequentBlockingField: null
    });
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
    let projectId = "";
    withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Repo Setup Project",
        mission: "Require explicit repository setup.",
        goal: "Run project Codex work only in the configured repository.",
        status: "active",
        currentMilestone: "Repository setup",
        nextAction: "Set repository path.",
        workClassification: "agent"
      });
      projectId = created.project.id;
    });

    const ask = runAskCommand({
      workspace,
      request: "Plan repository setup validation for Repo Setup Project."
    });
    expect(ask.data.result.status).toBe("requires_review");

    const snapshot = buildDashboardSnapshot({ workspace });
    const project = snapshot.projects.find((item) => item.id === projectId);
    expect(project?.setupWarnings).toEqual([CODEX_REPO_PATH_REQUIRED_MESSAGE]);

    const blocker = snapshot.attentionItems.find((item) => item.reason.includes(CODEX_REPO_PATH_REQUIRED_MESSAGE));

    expect(blocker).toMatchObject({
      kind: "review",
      severity: "action",
      projectId,
      projectName: "Repo Setup Project",
      reason: `Requires Review: ${CODEX_REPO_PATH_REQUIRED_MESSAGE}`,
      targetRepositoryRoot: null
    });
    expect(blocker?.primaryActions).toContainEqual(
      expect.objectContaining({
        label: "Set Repository Path",
        href: `/projects/${projectId}`
      })
    );

    withDatabase(workspace, (db) => {
      const result = updateProjectSetup(db, {
        projectId,
        repoPath: "/Users/pmark/Dev/MR/RepoSetup/repo",
        validationCommands: ["pnpm test", "", "pnpm lint"],
        mission: "Keep project setup explicit.",
        status: "active"
      });
      expect(result?.updated).toEqual(["mission", "status", "repoPath", "validationCommands"]);
    });

    const updatedMetadata = withDatabase(workspace, (db) => getProjectMetadata(db, projectId));
    expect(updatedMetadata?.repo_path).toBe("/Users/pmark/Dev/MR/RepoSetup/repo");
    expect(JSON.parse(updatedMetadata?.validation_commands ?? "[]")).toEqual(["pnpm test", "pnpm lint"]);

    const updatedSnapshot = buildDashboardSnapshot({ workspace });
    expect(updatedSnapshot.projects.find((item) => item.id === projectId)?.setupWarnings).toEqual([]);
    expect(updatedSnapshot.requiresReviewItems).toHaveLength(1);

    withDatabase(workspace, (db) => {
      updateProjectSetup(db, { projectId, repoPath: "" });
    });
    const clearedSnapshot = buildDashboardSnapshot({ workspace });
    expect(clearedSnapshot.projects.find((item) => item.id === projectId)?.setupWarnings).toEqual([
      CODEX_REPO_PATH_REQUIRED_MESSAGE
    ]);
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
        workClassification: "agent"
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
      reason: CODEX_REPO_PATH_REQUIRED_MESSAGE,
      targetRepositoryRoot: null
    });
    expect(card?.primaryActions).toContainEqual(
      expect.objectContaining({
        label: "Set Repository Path",
        href: expect.stringMatching(/^\/projects\/proj_/)
      })
    );
    expect(card?.primaryActions.map((action) => action.label)).not.toContain("Approve & Run");
  });

  it("uses direct shared persistence for the Dashboard project update route", () => {
    const routeSource = readFileSync(
      path.join(process.cwd(), "apps/dashboard/app/api/projects/[id]/route.ts"),
      "utf8"
    );

    expect(routeSource).toContain("updateProjectSetup");
    expect(routeSource).toContain("withDatabase");
    expect(routeSource).not.toContain("runArcadiaCliJson");
    expect(routeSource).not.toContain("arcadia-cli");
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
