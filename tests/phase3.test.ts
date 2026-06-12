import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
import { runCodexAssociateCommand, runCodexListCommand } from "../src/commands/codex.js";
import {
  runReviewApproveCommand,
  runReviewDeferCommand,
  runReviewRejectCommand,
  runReviewRequiredCommand,
  runReviewShowCommand
} from "../src/commands/review.js";
import { runWorkRunCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import {
  countRows,
  createAskRequest,
  createApprovalGate,
  createCodexInvocation,
  createProjectWithInitialWork,
  listCodexTasks,
  listApprovalGatesForWorkItem,
  listCodexInvocationsForWorkItem,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { loadPhase3Registries, validatePhase3Registries } from "../src/intent/registries.js";
import { resolveIntent } from "../src/intent/resolver.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const workspaces: string[] = [];

afterEach(() => {
  delete process.env.ARCADIA_CODEX_CLOUD_FIXTURE;
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Codex Companion", () => {
  it("observes Codex tasks, associates them with projects, and logs completion transitions", () => {
    const workspace = initializedWorkspace();
    const created = withDatabase(workspace, (db) =>
      createProjectWithInitialWork(db, {
        name: "Companion Project",
        mission: "Verify Codex Companion.",
        status: "active",
        currentMilestone: "Observe Codex work",
        nextAction: "Associate Codex task",
        workClassification: "codex"
      })
    );

    process.env.ARCADIA_CODEX_CLOUD_FIXTURE = JSON.stringify({
      tasks: [{
        id: "task_cloud_1",
        title: "Implement companion",
        status: "running",
        url: "https://chatgpt.com/codex/tasks/task_cloud_1",
        updated_at: "2026-06-11T10:00:00.000Z",
        summary: "Working on Arcadia Codex Companion."
      }]
    });
    const observed = runCodexListCommand({ workspace, source: "cloud", activeOnly: true });
    expect(observed.data.tasks[0].source_task_id).toBe("task_cloud_1");
    expect(observed.data.tasks[0].project_name).toBeNull();

    const associated = runCodexAssociateCommand({
      workspace,
      taskId: "task_cloud_1",
      projectId: created.project.id,
      milestoneId: created.milestone.id
    });
    expect(associated.data.task.project_name).toBe("Companion Project");

    process.env.ARCADIA_CODEX_CLOUD_FIXTURE = JSON.stringify({
      tasks: [{
        id: "task_cloud_1",
        title: "Implement companion",
        status: "completed",
        url: "https://chatgpt.com/codex/tasks/task_cloud_1",
        updated_at: "2026-06-11T10:10:00.000Z",
        summary: "Implemented and verified Arcadia Codex Companion."
      }]
    });
    const completed = runCodexListCommand({ workspace, source: "cloud" });
    expect(completed.data.missionLogPaths).toHaveLength(1);
    expect(existsSync(completed.data.missionLogPaths[0])).toBe(true);

    withDatabase(workspace, (db) => {
      const [task] = listCodexTasks(db);
      expect(task.status).toBe("completed");
      expect(task.project_name).toBe("Companion Project");
      expect(task.mission_log_path).toMatch(/^mission_logs\//);
      expect(countRows(db, "mission_logs")).toBe(1);
    });
  });
});

describe("Phase 3 registries", () => {
  it("copies default registries into initialized workspaces", () => {
    const workspace = initializedWorkspace();
    const paths = getWorkspacePaths(workspace);

    expect(existsSync(paths.intentRegistry)).toBe(true);
    expect(existsSync(paths.templateRegistry)).toBe(true);
    expect(existsSync(paths.codingAgentProfiles)).toBe(true);
  });

  it("loads and resolves known natural-language intents deterministically", () => {
    const workspace = initializedWorkspace();
    const registries = loadPhase3Registries(workspace);

    validatePhase3Registries(registries);
    const resolved = resolveIntent("Create a new blog site named MartianRover Field Notes.", registries);

    expect(resolved.intentId).toBe("create_astro_blog");
    expect(resolved.matched).toBe(true);
    expect(resolved.slots.projectName).toBe("MartianRover Field Notes");
    expect(resolved.templates[0].id).toBe("astro_field_notes_cloudflare");
    expect(resolved.codexPurpose).toBe("build");
    expect(resolved.approvalGates.map((gate) => gate.gateType)).toContain("external_deployment");
  });
});

describe("Phase 3 audit records", () => {
  it("stores ask requests, approval gates, and codex invocation records", () => {
    const workspace = initializedWorkspace();

    withDatabase(workspace, (db) => {
      const ask = createAskRequest(db, {
        rawRequest: "Plan something",
        resolvedIntent: "codex_plan",
        registryVersion: 1,
        outputKind: "codex_planning_packet",
        status: "planned"
      });
      expect(ask.id).toMatch(/^ask_/);

      const gate = createApprovalGate(db, {
        gateType: "publication",
        reason: "Publication requires approval."
      });
      expect(gate.id).toMatch(/^gate_/);

      const invocation = createCodexInvocation(db, {
        purpose: "planning",
        agentProfile: "codex_planning",
        workspaceScope: workspace,
        command: "codex exec --json --sandbox read-only -",
        promptPath: "prompts/codex/example/prompt.md",
        jsonlOutputPath: "prompts/codex/example/output.jsonl",
        finalMessagePath: "prompts/codex/example/final.md"
      });
      expect(invocation.id).toMatch(/^codex_/);
      expect(countRows(db, "ask_requests")).toBe(1);
      expect(countRows(db, "approval_gates")).toBe(1);
      expect(countRows(db, "codex_invocations")).toBe(1);
    });
  });
});

describe("arcadia ask command", () => {
  it("creates a structured work item, execution plan, approval gates, and Codex build packet", () => {
    const workspace = initializedWorkspace();

    const initial = runAskCommand({
      workspace,
      request: "Create a new blog site named MartianRover Field Notes."
    });
    if (!initial.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }
    const approved = runReviewApproveCommand({ workspace, id: initial.data.reviewItemId });
    const result = approved.data.approval ?? (() => {
      throw new Error("Expected approval data.");
    })();

    expect(result.intake.resolvedIntent).toBe("InstantiateProject");
    expect(result.resolvedIntent.intentId).toBe("InstantiateProject");
    expect(result.workItem?.work_classification).toBe("codex");
    expect(result.plan?.steps[0].skill_name).toBe("codex_build");
    expect(result.approvalGates.map((gate) => gate.gate_type)).toContain("external_deployment");
    expect(result.codexInvocations).toHaveLength(1);

    const promptPath = path.join(workspace, result.codexInvocations[0].prompt_path);
    expect(existsSync(promptPath)).toBe(true);
    expect(readFileSync(promptPath, "utf8")).toContain("MartianRover Field Notes");

    withDatabase(workspace, (db) => {
      expect(countRows(db, "ask_requests")).toBe(2);
      expect(countRows(db, "approval_gates")).toBeGreaterThan(0);
      expect(countRows(db, "codex_invocations")).toBe(1);
      expect(listCodexInvocationsForWorkItem(db, result.workItem?.id ?? "")).toHaveLength(1);
      expect(listApprovalGatesForWorkItem(db, result.workItem?.id ?? "").length).toBeGreaterThan(0);
    });
  });

  it("preserves low-confidence input as Requires Review instead of invoking Codex", () => {
    const workspace = initializedWorkspace();

    const result = runAskCommand({
      workspace,
      request: "Improve the Rebuster candidate review flow."
    });

    expect(result.data.resolvedIntent.matched).toBe(false);
    expect(result.data.resolvedIntent.intentId).toBe("CaptureThought");
    expect(result.data.result.status).toBe("requires_review");
    expect(result.data.reviewItemId).toMatch(/^review_/);
    expect(result.data.workItem).toBeNull();
    expect(result.data.plan).toBeNull();
    expect(result.data.codexInvocations).toHaveLength(0);

    const review = runReviewRequiredCommand({ workspace });
    expect(review.data.items[0].id).toBe(result.data.reviewItemId);
    expect(review.data.items[0].sourceInput).toBe("Improve the Rebuster candidate review flow.");
  });

  it("approves a Requires Review item by replaying the intended ask workflow", () => {
    const workspace = initializedWorkspace();

    const asked = runAskCommand({
      workspace,
      request: "Create a new blog site named MartianRover Field Notes."
    });
    expect(asked.data.result.status).toBe("requires_review");
    if (!asked.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }

    const shown = runReviewShowCommand({ workspace, id: asked.data.reviewItemId });
    expect(shown.data.item.decisionNeeded).toContain("Approve or reject");

    const approved = runReviewApproveCommand({ workspace, id: asked.data.reviewItemId });
    expect(approved.data.result.status).toBe("approved");
    expect(approved.data.approval?.workItem?.work_classification).toBe("codex");
    expect(approved.data.approval?.codexInvocations).toHaveLength(1);

    const open = runReviewRequiredCommand({ workspace });
    expect(open.data.items.map((item) => item.id)).not.toContain(asked.data.reviewItemId);
  });

  it("rejects and defers Requires Review items without executing the proposed action", () => {
    const rejectedWorkspace = initializedWorkspace();
    const rejectedAsk = runAskCommand({ workspace: rejectedWorkspace, request: "Pinterest might help Rebuster." });
    if (!rejectedAsk.data.reviewItemId) {
      throw new Error("Expected rejected review item.");
    }

    const rejected = runReviewRejectCommand({ workspace: rejectedWorkspace, id: rejectedAsk.data.reviewItemId });
    expect(rejected.data.result.status).toBe("rejected");
    expect(rejected.data.approval).toBeNull();

    const deferredWorkspace = initializedWorkspace();
    const deferredAsk = runAskCommand({ workspace: deferredWorkspace, request: "Pinterest might help Rebuster." });
    if (!deferredAsk.data.reviewItemId) {
      throw new Error("Expected deferred review item.");
    }
    const deferred = runReviewDeferCommand({ workspace: deferredWorkspace, id: deferredAsk.data.reviewItemId });
    expect(deferred.data.result.status).toBe("deferred");
    expect(deferred.data.approval).toBeNull();
    expect(runReviewRequiredCommand({ workspace: deferredWorkspace }).data.items.map((item) => item.id)).toContain(
      deferredAsk.data.reviewItemId
    );
  });

  it("resolves Rebuster project metadata, attaches its active milestone, and writes packet context", () => {
    const workspace = initializedWorkspace();
    const project = withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Rebuster",
        mission: "Help users turn product evidence into better shipping decisions.",
        goal: "Ship Pinterest publishing support.",
        status: "active",
        currentMilestone: "Pinterest publishing support",
        nextAction: "Define Pinterest posting support boundaries.",
        expectedArtifact: "Pinterest implementation plan",
        workClassification: "codex"
      });
      upsertProjectMetadata(db, {
        projectId: created.project.id,
        aliases: ["Rebuster", "rebuster app"],
        repoPath: "/Users/pmark/Dev/MR/Rebuster/rebuster",
        statusSummary: "Active product repository with posting automation work in scope.",
        validationCommands: ["pnpm test", "pnpm lint"]
      });
      return created;
    });

    const initial = runAskCommand({
      workspace,
      request: "Build Pinterest posting support for Rebuster."
    });
    if (!initial.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }
    const approved = runReviewApproveCommand({ workspace, id: initial.data.reviewItemId });
    const result = approved.data.approval ?? (() => {
      throw new Error("Expected approval data.");
    })();

    expect(result.intake.resolvedIntent).toBe("CreateWork");
    expect(result.resolvedIntent.intentId).toBe("CreateWork");
    expect(result.resolvedIntent.matched).toBe(true);
    expect(result.workItem?.project_id).toBe(project.project.id);
    expect(result.workItem?.project_name).toBe("Rebuster");
    expect(result.workItem?.milestone_id).toBe(project.milestone.id);
    expect(result.workItem?.milestone_title).toBe("Pinterest publishing support");
    expect(result.codexInvocations[0].purpose).toBe("build");
    expect(result.codexInvocations[0].workspace_scope).toBe("/Users/pmark/Dev/MR/Rebuster/rebuster");
    expect(result.ask.prompt_packet_path).toBe(result.codexInvocations[0].prompt_path);
    expect(approved.artifacts).toContain(path.join(workspace, result.codexInvocations[0].prompt_path));
    expect(new Set(result.approvalGates.map((gate) => gate.gate_type))).toEqual(new Set([
      "credentials_required",
      "destructive_filesystem_changes",
      "publication",
      "send_email_or_messages"
    ]));

    const prompt = readFileSync(path.join(workspace, result.codexInvocations[0].prompt_path), "utf8");
    expect(prompt).toContain("## Target Project Context");
    expect(prompt).toContain("Project: Rebuster");
    expect(prompt).toContain("Goal: Ship Pinterest publishing support.");
    expect(prompt).toContain("Active milestone: Pinterest publishing support");
    expect(prompt).toContain("Work item milestone: Pinterest publishing support");
    expect(prompt).toContain("Target repository: /Users/pmark/Dev/MR/Rebuster/rebuster");
    expect(prompt).toContain("Project status summary: Active product repository with posting automation work in scope.");
    expect(prompt).toContain("Validation commands: pnpm test && pnpm lint");
    expect(prompt).toContain("Run validation command: pnpm test");
    expect(prompt).toContain("Run validation command: pnpm lint");
    expect(prompt).toContain("Do not publish, deploy, merge, delete, spend money, use credentials, access production data, or send messages.");
    expect(prompt).toContain("credential access, publication, and social posting/messaging require explicit approval");
    expect(prompt).toContain("## Final Reporting Requirements");
    expect(prompt).toContain("Summarize project, milestone, and repository scope.");
    expect(prompt).toContain("List validation results.");
  });

  it("updates a project goal through high-confidence intake routing", () => {
    const workspace = initializedWorkspace();
    const created = withDatabase(workspace, (db) =>
      createProjectWithInitialWork(db, {
        name: "MIDI Opener",
        mission: "Make MIDI files easy to preview.",
        goal: "Improve onboarding.",
        status: "active",
        currentMilestone: "Conversion",
        nextAction: "Review App Store funnel.",
        workClassification: "codex"
      })
    );

    const result = runAskCommand({
      workspace,
      request: "The goal for MIDI Opener is to improve App Store conversion."
    });

    expect(result.data.intake.resolvedIntent).toBe("UpdateGoal");
    expect(result.data.result.status).toBe("acted");
    expect(result.data.project?.id).toBe(created.project.id);
    expect(result.data.project?.goal).toBe("improve App Store conversion");
    expect(result.data.workItem).toBeNull();
  });

  it("runs an explicitly approved Codex build step through a configured fake agent", () => {
    const workspace = initializedWorkspace();
    const created = withDatabase(workspace, (db) =>
      createProjectWithInitialWork(db, {
        name: "Rebuster",
        mission: "Help users turn product evidence into better shipping decisions.",
        goal: "Improve candidate review.",
        status: "active",
        currentMilestone: "Candidate review",
        nextAction: "Define candidate review flow.",
        workClassification: "codex"
      })
    );
    const paths = getWorkspacePaths(workspace);
    const fakeAgent = path.join(workspace, "fake-codex-agent.cjs");
    writeFileSync(
      fakeAgent,
      "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fake codex final'}})));",
      "utf8"
    );
    writeFileSync(
      paths.codingAgentProfiles,
      `${JSON.stringify(
        {
          version: 1,
          profiles: [
            {
              name: "fake_build",
              provider: "fake-agent",
              package: "local",
              command: process.execPath,
              purpose: "build",
              sandbox: "workspace-write",
              args: [fakeAgent]
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const reviewAsk = runAskCommand({
      workspace,
      request: "Build candidate review flow for Rebuster."
    });
    if (!reviewAsk.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }
    const approved = runReviewApproveCommand({ workspace, id: reviewAsk.data.reviewItemId });
    const asked = approved.data.approval ?? (() => {
      throw new Error("Expected approval data.");
    })();
    expect(asked.workItem?.project_id).toBe(created.project.id);
    if (!asked.workItem || !asked.plan) {
      throw new Error("Expected ask to create a work item and plan.");
    }
    const run = runWorkRunCommand({
      workspace,
      workId: asked.workItem.id,
      plan: asked.plan.id,
      allowCodexBuild: true,
      agentProfile: "fake_build"
    });

    expect(run.data.run.status).toBe("completed");
    const invocation = withDatabase(workspace, (db) =>
      listCodexInvocationsForWorkItem(db, asked.workItem.id)[0]
    );
    expect(invocation.status).toBe("completed");
    expect(invocation.run_id).toBe(run.data.run.id);
    expect(readFileSync(path.join(workspace, invocation.jsonl_output_path), "utf8")).toContain("fake codex final");
    expect(readFileSync(path.join(workspace, invocation.final_message_path), "utf8")).toContain("fake codex final");
  });
});

function createTempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-phase3-test-"));
  workspaces.push(workspace);
  return workspace;
}

function initializedWorkspace(): string {
  const workspace = createTempWorkspace();
  initWorkspace(workspace);
  return workspace;
}
