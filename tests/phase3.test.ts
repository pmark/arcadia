import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderAskSuccess, runAskCommand } from "../src/commands/ask.js";
import { runInitCommand } from "../src/commands/init.js";
import { runCodexAssociateCommand, runCodexListCommand } from "../src/commands/codex.js";
import {
  runReviewApproveCommand,
  runReviewDeferCommand,
  runReviewRejectCommand,
  runReviewResolveReplyCommand,
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
  createWorkItemWithOptionalArtifact,
  createProjectWithInitialWork,
  getActiveMilestoneForProject,
  getBackBurnerItem,
  getReviewItem,
  listCodexTasks,
  listApprovalGatesForWorkItem,
  listCodexInvocationsForWorkItem,
  listBackBurnerItems,
  listReviewFeedback,
  listWorkItems,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { loadPhase3Registries, validatePhase3Registries } from "../src/intent/registries.js";
import { resolveIntent } from "../src/intent/resolver.js";
import { parseReviewResponse } from "../src/review/responseParser.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { goldenRequestExamples } from "./goldenRequests.js";

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
  it("parses review response shorthand in shared core code", () => {
    expect(parseReviewResponse("R12 A")).toMatchObject({
      reviewSlug: "R12",
      optionLetter: "A",
      hasReviewReference: true,
      hasResponse: true
    });
    expect(parseReviewResponse("approve R12")).toMatchObject({
      reviewSlug: "R12",
      decisionToken: "approve",
      hasReviewReference: true,
      hasResponse: true
    });
    expect(parseReviewResponse("review_abc123 wrong project")).toMatchObject({
      reviewId: "review_abc123",
      feedbackType: "wrong project",
      hasReviewReference: true,
      hasResponse: true
    });
    expect(parseReviewResponse("A")).toMatchObject({
      optionLetter: "A",
      hasReviewReference: false,
      hasResponse: true
    });
  });

  it("creates a plain project through the shared project creation path", () => {
    const workspace = initializedWorkspace();
    const paths = getWorkspacePaths(workspace);

    const result = runAskCommand({
      workspace,
      request: "Create a project called Boring Defaults."
    });

    expect(result.data.intake.resolvedIntent).toBe("CreateProject");
    expect(result.data.result.status).toBe("acted");
    expect(result.data.project?.name).toBe("Boring Defaults");
    expect(result.data.project?.slug).toBe("boring-defaults");
    expect(result.data.workItem?.next_action).toBe("Clarify the project mission and first concrete next action.");
    expect(existsSync(path.join(paths.projects, "boring-defaults", "PROJECT.md"))).toBe(true);

    withDatabase(workspace, (db) => {
      expect(countRows(db, "projects")).toBe(1);
      expect(countRows(db, "ask_requests")).toBe(1);
      expect(countRows(db, "mission_logs")).toBe(1);
    });
  });

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

  it("preserves low-confidence input in the Back Burner instead of invoking Codex", () => {
    const workspace = initializedWorkspace();

    const result = runAskCommand({
      workspace,
      request: "Improve the Rebuster candidate review flow."
    });

    expect(result.data.resolvedIntent.matched).toBe(false);
    expect(result.data.resolvedIntent.intentId).toBe("CaptureThought");
    expect(result.data.result.status).toBe("captured");
    expect(result.data.reviewItemId).toBeNull();
    expect(result.data.backBurnerItemId).toMatch(/^bb_/);
    expect(result.data.workItem).toBeNull();
    expect(result.data.plan).toBeNull();
    expect(result.data.codexInvocations).toHaveLength(0);

    const review = runReviewRequiredCommand({ workspace });
    expect(review.data.items).toEqual([]);
    const item = withDatabase(workspace, (db) => getBackBurnerItem(db, result.data.backBurnerItemId ?? ""));
    expect(item?.original_input).toBe("Improve the Rebuster candidate review flow.");
    expect(item?.status).toBe("incubating");
  });

  it("stewards direct project work, planning, vague ideas, clarification, and goal refinement", () => {
    const workspace = initializedWorkspace();
    const project = withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Rebuster",
        mission: "Help users turn product evidence into better shipping decisions.",
        goal: "Ship Pinterest publishing support.",
        status: "active",
        currentMilestone: "Pinterest publishing support",
        nextAction: "Define Pinterest support boundaries.",
        workClassification: "codex"
      });
      upsertProjectMetadata(db, {
        projectId: created.project.id,
        aliases: ["Rebuster"],
        repoPath: "/Users/pmark/Dev/MR/Rebuster/rebuster",
        validationCommands: ["pnpm test"]
      });
      return created;
    });

    const direct = runAskCommand({
      workspace,
      request: "Set current milestone for Rebuster to Pinterest automation."
    });
    expect(direct.data.stewardship.intentType).toBe("Project Work");
    expect(direct.data.stewardship.recommendedExecutionPath).toBe("Execute Directly");
    expect(direct.data.stewardship.planningRecommended).toBe(false);
    expect(direct.data.result.status).toBe("acted");

    const plan = runAskCommand({
      workspace,
      request: "Plan the Pinterest publishing rollout for Rebuster."
    });
    expect(plan.data.stewardship.intentType).toBe("Planning Request");
    expect(plan.data.stewardship.recommendedExecutionPath).toBe("Plan First");
    expect(plan.data.stewardship.relatedProject?.name).toBe("Rebuster");
    expect(plan.data.workItem?.project_id).toBe(project.project.id);
    expect(plan.data.plan?.steps[0].skill_name).toBe("codex_planning");
    expect(plan.data.codexInvocations[0].purpose).toBe("planning");
    expect(plan.data.stewardship.generatedCodexGoalText).toContain("Create a practical plan");

    const prompt = readFileSync(path.join(workspace, plan.data.codexInvocations[0].prompt_path), "utf8");
    expect(prompt).toContain("## Goal");
    expect(prompt).toContain("## Why This Matters");
    expect(prompt).toContain("## Current Milestone");
    expect(prompt).toContain("## Repository / Path Context");
    expect(prompt).toContain("## Constraints");
    expect(prompt).toContain("## Acceptance Criteria");
    expect(prompt).toContain("## Approval Boundaries");
    expect(prompt).toContain("## Expected Artifact");
    expect(prompt).toContain("## Repository Impact Assessment");
    expect(prompt).toContain("## Smallest Useful Follow-up Codex Goal");
    expect(prompt).toContain("## Execution Instruction");
    expect(prompt).toContain("Plan only. Do not make implementation changes.");
    expect(prompt).toContain("None required for planning-only packet creation.");
    expect(prompt).toContain("Validation strategy:");
    expect(prompt).toContain("## Operator Context");

    const vague = runAskCommand({
      workspace,
      request: "Maybe creator partnerships could help Rebuster someday."
    });
    expect(vague.data.stewardship.intentType).toBe("Back Burner Idea");
    expect(vague.data.stewardship.recommendedExecutionPath).toBe("Back Burner");
    expect(vague.data.result.status).toBe("captured");
    expect(vague.data.backBurnerItemId).toMatch(/^bb_/);

    const clarify = runAskCommand({
      workspace,
      request: "Build Pinterest support."
    });
    expect(clarify.data.stewardship.intentType).toBe("Project Work");
    expect(clarify.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    expect(clarify.data.stewardship.clarificationRequired).toBe(true);
    expect(clarify.data.result.status).toBe("requires_review");
    expect(clarify.data.reviewItemId).toMatch(/^review_/);

    const goal = runAskCommand({
      workspace,
      request: "Set goal for Rebuster to Ship creator partnership experiments."
    });
    expect(goal.data.stewardship.intentType).toBe("Goal Refinement");
    expect(goal.data.stewardship.relatedProject?.name).toBe("Rebuster");
    expect(goal.data.stewardship.relatedGoal).toBe("Ship Pinterest publishing support.");
    expect(goal.data.project?.goal).toBe("Ship creator partnership experiments");

    const storedStewardship = withDatabase(workspace, (db) =>
      db.prepare("SELECT stewardship_json FROM ask_requests WHERE id = ?").get(plan.data.ask?.id) as { stewardship_json: string }
    );
    expect(JSON.parse(storedStewardship.stewardship_json)).toMatchObject({
      intentType: "Planning Request",
      recommendedExecutionPath: "Plan First",
      generatedCodexGoalText: plan.data.stewardship.generatedCodexGoalText
    });
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
    expect(shown.data.item.slug).toMatch(/^R\d+$/);

    const approved = runReviewApproveCommand({ workspace, id: asked.data.reviewItemId });
    expect(approved.data.result.status).toBe("approved");
    expect(approved.data.approval?.workItem?.work_classification).toBe("codex");
    expect(approved.data.approval?.codexInvocations).toHaveLength(1);
    expect(approved.data.item.resultingAskRequestId).toBe(approved.data.approval?.ask.id);

    const stored = withDatabase(workspace, (db) => getReviewItem(db, asked.data.reviewItemId ?? ""));
    expect(stored?.resulting_ask_request_id).toBe(approved.data.approval?.ask.id);

    const open = runReviewRequiredCommand({ workspace });
    expect(open.data.items.map((item) => item.id)).not.toContain(asked.data.reviewItemId);
  });

  it("resolves Requires Review replies by option letter and slug", () => {
    const approveWorkspace = initializedWorkspace();
    const approveAsk = runAskCommand({ workspace: approveWorkspace, request: "Build Pinterest posting support for Unknown App." });
    const approveItem = runReviewRequiredCommand({ workspace: approveWorkspace }).data.items[0];
    expect(approveItem.slug).toMatch(/^R\d+$/);

    const approved = runReviewResolveReplyCommand({
      workspace: approveWorkspace,
      id: approveAsk.data.reviewItemId,
      reply: "A"
    });

    expect(approved.data.action).toBe("approved");
    expect(approved.data.selectedOption).toBe("approve");
    expect(approved.data.confirmation).toContain(`${approveItem.slug} approved`);

    const deferWorkspace = initializedWorkspace();
    runAskCommand({ workspace: deferWorkspace, request: "Build Pinterest posting support for Unknown App." });
    const deferItem = runReviewRequiredCommand({ workspace: deferWorkspace }).data.items[0];

    const deferred = runReviewResolveReplyCommand({
      workspace: deferWorkspace,
      reply: `${deferItem.slug} defer`
    });

    expect(deferred.data.action).toBe("deferred");
    expect(deferred.data.confirmation).toBe(`${deferItem.slug} deferred.`);
  });

  it("captures durable feedback from review replies", () => {
    const workspace = initializedWorkspace();
    runAskCommand({ workspace, request: "Build Pinterest posting support for Unknown App." });
    const item = runReviewRequiredCommand({ workspace }).data.items[0];

    const result = runReviewResolveReplyCommand({
      workspace,
      id: item.id,
      reply: "wrong project"
    });

    expect(result.data.action).toBe("feedback_captured");
    expect(result.data.confirmation).toBe(`Feedback captured for ${item.slug}: wrong project.`);
    withDatabase(workspace, (db) => {
      expect(countRows(db, "review_feedback")).toBe(1);
      const feedback = listReviewFeedback(db, item.id)[0];
      expect(feedback.review_slug).toBe(item.slug);
      expect(feedback.source_input).toBe("Build Pinterest posting support for Unknown App.");
      expect(feedback.proposed_interpretation).toContain("referenced project");
      expect(feedback.feedback_type).toBe("wrong project");
      expect(feedback.raw_reply).toBe("wrong project");
    });
  });

  it("routes review shorthand through ask without guessing bare replies", () => {
    const approveWorkspace = initializedWorkspace();
    runAskCommand({ workspace: approveWorkspace, request: "Build Pinterest posting support for Unknown App." });
    const approveItem = runReviewRequiredCommand({ workspace: approveWorkspace }).data.items[0];

    const approved = runAskCommand({
      workspace: approveWorkspace,
      request: `${approveItem.slug} approve`
    });

    expect(approved.data.result.status).toBe("acted");
    expect(approved.data.result.summary).toContain(`${approveItem.slug} approved`);
    expect(runReviewShowCommand({ workspace: approveWorkspace, id: approveItem.id }).data.item.status).toBe("approved");

    const deferWorkspace = initializedWorkspace();
    runAskCommand({ workspace: deferWorkspace, request: "Build Pinterest posting support for Unknown App." });
    const deferItem = runReviewRequiredCommand({ workspace: deferWorkspace }).data.items[0];
    const deferred = runAskCommand({
      workspace: deferWorkspace,
      request: `defer ${deferItem.slug}`
    });
    expect(deferred.data.result.summary).toBe(`${deferItem.slug} deferred.`);
    expect(runReviewShowCommand({ workspace: deferWorkspace, id: deferItem.id }).data.item.status).toBe("deferred");

    const feedbackWorkspace = initializedWorkspace();
    runAskCommand({ workspace: feedbackWorkspace, request: "Build Pinterest posting support for Unknown App." });
    const feedbackItem = runReviewRequiredCommand({ workspace: feedbackWorkspace }).data.items[0];
    const feedback = runAskCommand({
      workspace: feedbackWorkspace,
      request: `${feedbackItem.slug} wrong project`
    });
    expect(feedback.data.result.summary).toBe(`Feedback captured for ${feedbackItem.slug}: wrong project.`);
    withDatabase(feedbackWorkspace, (db) => {
      expect(listReviewFeedback(db, feedbackItem.id)[0].feedback_type).toBe("wrong project");
    });

    const bareWorkspace = initializedWorkspace();
    runAskCommand({ workspace: bareWorkspace, request: "Build Pinterest posting support for Unknown App." });
    const bare = runAskCommand({ workspace: bareWorkspace, request: "A" });
    expect(bare.data.result.status).toBe("captured");
    expect(bare.data.backBurnerItemId).toMatch(/^bb_/);
    expect(runReviewRequiredCommand({ workspace: bareWorkspace }).data.items).toHaveLength(1);
  });

  it("routes context-backed review replies through ask", () => {
    const workspace = initializedWorkspace();
    runAskCommand({ workspace, request: "Build Pinterest posting support for Unknown App." });
    const item = runReviewRequiredCommand({ workspace }).data.items[0];

    const result = runAskCommand({
      workspace,
      request: "A",
      adapterMetadata: { reviewId: item.id }
    });

    expect(result.data.result.summary).toContain(`${item.slug} approved`);
    expect(runReviewShowCommand({ workspace, id: item.id }).data.item.status).toBe("approved");
  });

  it("routes the Golden Request Suite through ask", () => {
    const workspace = initializedWorkspace();
    withDatabase(workspace, (db) => {
      const arcadia = createProjectWithInitialWork(db, {
        name: "Arcadia",
        mission: "Maintain momentum across creative projects.",
        goal: "Make ask the universal ingress router.",
        status: "active",
        currentMilestone: "Universal ask router",
        nextAction: "Implement shared ask routing.",
        workClassification: "codex"
      });
      upsertProjectMetadata(db, { projectId: arcadia.project.id, aliases: ["Arcadia"] });
      const rebuster = createProjectWithInitialWork(db, {
        name: "Rebuster",
        mission: "Help users turn product evidence into better shipping decisions.",
        goal: "Ship Pinterest publishing support.",
        status: "active",
        currentMilestone: "Pinterest publishing support",
        nextAction: "Define Pinterest support boundaries.",
        workClassification: "codex"
      });
      upsertProjectMetadata(db, { projectId: rebuster.project.id, aliases: ["Rebuster"] });
      const midiOpener = createProjectWithInitialWork(db, {
        name: "MIDI Opener",
        mission: "Make MIDI files easy to preview.",
        goal: "Improve playback and release operations.",
        status: "active",
        currentMilestone: "Playback reliability",
        nextAction: "Triage loop playback bugs.",
        workClassification: "codex"
      });
      upsertProjectMetadata(db, { projectId: midiOpener.project.id, aliases: ["MIDI Opener", "midi opener app"] });
    });

    for (const example of goldenRequestExamples) {
      const result = runAskCommand({ workspace, request: example.input });
      expect(result.data.intake.classification, example.name).toBe(example.expectedClassification);
      expect(result.data.intake.resolvedIntent, example.name).toBe(example.expectedIntent);
      expect(result.data.intake.project?.name ?? null, example.name).toBe(example.expectedProject);
      expect(result.data.result.status, example.name).toBe(example.expectedRoutingOutcome);

      if (example.expectedBackBurner) {
        expect(result.data.backBurnerItemId, example.name).toMatch(/^bb_/);
        expect(result.data.reviewItemId, example.name).toBeNull();
      } else {
        expect(result.data.backBurnerItemId, example.name).toBeNull();
        expect(result.data.reviewItemId, example.name).toMatch(/^review_/);
      }
    }
  });

  it("only shows actionable Requires Review records", () => {
    const workspace = initializedWorkspace();
    const legacy = withDatabase(workspace, (db) =>
      createWorkItemWithOptionalArtifact(db, {
        title: "Legacy ambiguous item",
        rawInput: "legacy ambiguous item",
        queue: "needs_mark",
        workClassification: "needs_mark",
        nextAction: "Clarify legacy item."
      }).workItem
    );
    const asked = runAskCommand({ workspace, request: "Build Pinterest posting support for Unknown App." });
    if (!asked.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }

    const review = runReviewRequiredCommand({ workspace });

    expect(review.data.items.map((item) => item.id)).toEqual([asked.data.reviewItemId]);
    expect(review.data.items.map((item) => item.id)).not.toContain(legacy.id);
    for (const item of review.data.items) {
      expect(item.options).toEqual(["approve", "reject", "defer"]);
      expect(runReviewShowCommand({ workspace, id: item.id }).data.item.id).toBe(item.id);
    }
  });

  it("supports every decision command for every shown Requires Review item shape", () => {
    for (const action of ["approve", "reject", "defer"] as const) {
      const workspace = initializedWorkspace();
      const asked = runAskCommand({ workspace, request: "Build Pinterest posting support for Unknown App." });
      if (!asked.data.reviewItemId) {
        throw new Error("Expected Requires Review item.");
      }
      const [item] = runReviewRequiredCommand({ workspace }).data.items;
      expect(item.id).toBe(asked.data.reviewItemId);

      const result =
        action === "approve"
          ? runReviewApproveCommand({ workspace, id: item.id })
          : action === "reject"
            ? runReviewRejectCommand({ workspace, id: item.id })
            : runReviewDeferCommand({ workspace, id: item.id });

      expect(result.data.result.status).toBe(action === "approve" ? "approved" : action === "reject" ? "rejected" : "deferred");
    }
  });

  it("approval resumes medium-confidence CreateWork as work instead of another review item", () => {
    const workspace = initializedWorkspace();
    const asked = runAskCommand({
      workspace,
      request: "Build Pinterest posting support for Unknown App."
    });
    expect(asked.data.result.status).toBe("requires_review");
    if (!asked.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }

    const approved = runReviewApproveCommand({ workspace, id: asked.data.reviewItemId });

    expect(approved.data.result.summary).toBe("Work item created.");
    expect(approved.data.approval?.workItem?.queue).toBe("work_queue");
    expect(approved.data.approval?.workItem?.work_classification).toBe("codex");
    expect(approved.data.approval?.reviewItemId).toBeNull();
  });

  it("rejects and defers Requires Review items without executing the proposed action", () => {
    const rejectedWorkspace = initializedWorkspace();
    const rejectedAsk = runAskCommand({ workspace: rejectedWorkspace, request: "Build Pinterest posting support for Unknown App." });
    if (!rejectedAsk.data.reviewItemId) {
      throw new Error("Expected rejected review item.");
    }

    const rejected = runReviewRejectCommand({ workspace: rejectedWorkspace, id: rejectedAsk.data.reviewItemId });
    expect(rejected.data.result.status).toBe("rejected");
    expect(rejected.data.approval).toBeNull();

    const deferredWorkspace = initializedWorkspace();
    const deferredAsk = runAskCommand({ workspace: deferredWorkspace, request: "Build Pinterest posting support for Unknown App." });
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
    expect(prompt).toContain("List changed files, validation commands run, and any commands that could not be run.");
  });

  it("defaults approved asks to the only active project in an Arcadia-profile workspace", () => {
    const workspace = createTempWorkspace();
    const initialized = runInitCommand(workspace, { profile: "arcadia" });

    const initial = runAskCommand({
      workspace,
      request: "Create a NextJS app called Arcadia Companion."
    });
    if (!initial.data.reviewItemId) {
      throw new Error("Expected Requires Review item.");
    }

    const approved = runReviewApproveCommand({ workspace, id: initial.data.reviewItemId });
    const result = approved.data.approval ?? (() => {
      throw new Error("Expected approval data.");
    })();

    expect(result.workItem?.project_id).toBe(initialized.data.seed?.project.id);
    expect(result.workItem?.project_name).toBe("Arcadia");
    expect(result.workItem?.milestone_id).toBe(initialized.data.seed?.milestone.id);
    expect(result.workItem?.milestone_title).toBe("Unify Arcadia onto the single workspace model.");
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

    expect(result.data.intake.resolvedIntent).toBe("UpdateEntityAttribute");
    expect(result.data.result.status).toBe("acted");
    expect(result.data.project?.id).toBe(created.project.id);
    expect(result.data.project?.goal).toBe("improve App Store conversion");
    expect(result.data.workItem).toBeNull();
  });

  it("extracts deterministic project goal updates from common command-shaped phrasings", () => {
    const workspace = createTempWorkspace();
    runInitCommand(workspace, { profile: "arcadia" });
    const goalPhrases = [
      "Set Arcadia goal: Perform basic operations",
      "Set Arcadia's goal to Perform basic operations",
      "Set Arcadia’s goal to Perform basic operations",
      "Set goal for Arcadia to Perform basic operations",
      "Set goal for the Arcadia project to Perform basic operations",
      "Set goal for the Arcadia project to: Perform basic operations",
      "Update Arcadia goal: Perform basic operations",
      "Change Arcadia goal to Perform basic operations",
      "Update the goal for Arcadia to Perform basic operations",
      "The goal for Arcadia is Perform basic operations"
    ];

    for (const request of goalPhrases) {
      const result = runAskCommand({ workspace, request });
      expect(result.data.intake.resolvedIntent).toBe("UpdateEntityAttribute");
      expect(result.data.intake.project?.name).toBe("Arcadia");
      expect(result.data.intake.extractedFields.attribute).toBe("goal");
      expect(result.data.intake.extractedFields.value).toBe("Perform basic operations");
      expect(result.data.intake.action).toMatchObject({
        kind: "update_entity_attribute",
        entityType: "project",
        entityName: "Arcadia",
        attribute: "goal",
        value: "Perform basic operations",
        safetyLevel: "safe_deterministic",
        deterministicHandler: "project.update.goal"
      });
      expect(result.data.project?.goal).toBe("Perform basic operations");
      expect(result.data.result.status).toBe("acted");
      expect(result.data.reviewItemId).toBeNull();
      expect(result.data.codexInvocations).toHaveLength(0);

      const output = renderAskSuccess(result);
      expect(output).toContain("Project: Arcadia");
      expect(output).toContain("Attribute: goal");
      expect(output).toContain("Value: Perform basic operations");
      expect(output).toContain("Result: Updated goal for Arcadia.");
    }
  });

  it("routes obvious natural-language deterministic requests before CaptureThought", () => {
    const workspace = createTempWorkspace();
    const initialized = runInitCommand(workspace, { profile: "arcadia" });
    const projectId = initialized.data.seed?.project.id ?? (() => {
      throw new Error("Expected seeded Arcadia project.");
    })();

    const examples = [
      {
        request: "Set goal for the Arcadia project to \"Perform basic operations\"",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Set goal for the Arcadia project to \"Perform basic operations\"" });
          expect(result.data.result.status).toBe("acted");
          expect(result.data.project?.goal).toBe("Perform basic operations");
          expect(result.data.codexInvocations).toHaveLength(0);
          expect(result.data.reviewItemId).toBeNull();
        }
      },
      {
        request: "Set Arcadia status: paused",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Set Arcadia status: paused" });
          expect(result.data.result.status).toBe("acted");
          expect(result.data.project?.status).toBe("paused");
          expect(result.data.codexInvocations).toHaveLength(0);
        }
      },
      {
        request: "Set Arcadia status to active",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Set Arcadia status to active" });
          expect(result.data.result.status).toBe("acted");
          expect(result.data.project?.status).toBe("active");
          expect(result.data.codexInvocations).toHaveLength(0);
        }
      },
      {
        request: "Set Arcadia mission: Keep creative projects moving.",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Set Arcadia mission: Keep creative projects moving." });
          expect(result.data.result.status).toBe("acted");
          expect(result.data.project?.mission).toBe("Keep creative projects moving");
          expect(result.data.reviewItemId).toBeNull();
        }
      },
      {
        request: "Update Arcadia current milestone: Deterministic natural-language routing.",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({
            workspace,
            request: "Update Arcadia current milestone: Deterministic natural-language routing."
          });
          expect(result.data.result.status).toBe("acted");
          const active = withDatabase(workspace, (db) => getActiveMilestoneForProject(db, projectId));
          expect(active?.title).toBe("Deterministic natural-language routing");
          expect(result.data.codexInvocations).toHaveLength(0);
        }
      },
      {
        request: "Set Arcadia next action: Run the deterministic routing smoke test.",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({
            workspace,
            request: "Set Arcadia next action: Run the deterministic routing smoke test."
          });
          expect(result.data.result.status).toBe("acted");
          const nextActions = withDatabase(workspace, (db) =>
            listWorkItems(db).filter((item) => item.project_id === projectId && item.status !== "done").map((item) => item.next_action)
          );
          expect(nextActions).toContain("Run the deterministic routing smoke test");
          expect(result.data.reviewItemId).toBeNull();
        }
      },
      {
        request: "Show project Arcadia",
        intent: "ShowProject",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Show project Arcadia" });
          expect(result.data.result.status).toBe("acted");
          expect(result.data.projectSummary?.name).toBe("Arcadia");
          expect(result.data.codexInvocations).toHaveLength(0);
        }
      },
      {
        request: "List projects",
        intent: "ListProjects",
        assert: () => {
          const result = runAskCommand({ workspace, request: "List projects" });
          expect(result.data.result.status).toBe("acted");
          expect(result.data.projects?.map((project) => project.name)).toContain("Arcadia");
          expect(result.data.reviewItemId).toBeNull();
        }
      },
      {
        request: "List review items",
        intent: "ReviewRequired",
        assert: () => {
          const result = runAskCommand({ workspace, request: "List review items" });
          expect(result.data.result.status).toBe("acted");
          expect(result.data.review?.count).toBe(0);
          expect(result.data.codexInvocations).toHaveLength(0);
        }
      },
      {
        request: "The goal for Arcadia is to simplify deterministic operations.",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "The goal for Arcadia is to simplify deterministic operations." });
          expect(result.data.result.status).toBe("acted");
          expect(result.data.project?.goal).toBe("simplify deterministic operations");
          expect(result.data.workItem).toBeNull();
        }
      },
      {
        request: "Improve the Rebuster candidate review flow.",
        intent: "CaptureThought",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Improve the Rebuster candidate review flow." });
          expect(result.data.result.status).toBe("captured");
          expect(result.data.intake.resolvedIntent).toBe("CaptureThought");
          expect(result.data.reviewItemId).toBeNull();
          expect(result.data.backBurnerItemId).toMatch(/^bb_/);
          expect(result.data.codexInvocations).toHaveLength(0);
        }
      },
      {
        request: "Set Arcadia goal:",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Set Arcadia goal:" });
          expect(result.data.result.status).toBe("requires_review");
          expect(result.data.intake.resolvedIntent).toBe("UpdateEntityAttribute");
          expect(result.data.intake.missingFields).toContain("attributeValue");
          expect(result.data.intake.proposedAction).toBe("Requires Review: missing attribute value.");
          expect(result.data.reviewItemId).toMatch(/^review_/);
          expect(result.data.codexInvocations).toHaveLength(0);
          const review = runReviewShowCommand({ workspace, id: result.data.reviewItemId ?? "" });
          expect(review.data.item.decisionNeeded).toBe("Requires Review: missing attribute value.");
        }
      },
      {
        request: "Set Arcadia priority to High",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Set Arcadia priority to High" });
          expect(result.data.result.status).toBe("requires_review");
          expect(result.data.intake.missingFields).toContain("attribute");
          expect(result.data.reviewItemId).toMatch(/^review_/);
          expect(result.data.codexInvocations).toHaveLength(0);
          const review = runReviewShowCommand({ workspace, id: result.data.reviewItemId ?? "" });
          expect(review.data.item.decisionNeeded).toBe("Requires Review: attribute ambiguous or missing.");
        }
      },
      {
        request: "Set Arcadia status to shipped",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Set Arcadia status to shipped" });
          expect(result.data.result.status).toBe("requires_review");
          expect(result.data.intake.missingFields).toContain("attributeValue");
          expect(result.data.intake.extractedFields.invalidReason).toContain("status must be one of");
          expect(result.data.reviewItemId).toMatch(/^review_/);
          expect(result.data.codexInvocations).toHaveLength(0);
          const review = runReviewShowCommand({ workspace, id: result.data.reviewItemId ?? "" });
          expect(review.data.item.decisionNeeded).toContain("Requires Review: invalid attribute value");
        }
      },
      {
        request: "Set Unknown App goal to Perform basic operations",
        intent: "UpdateEntityAttribute",
        assert: () => {
          const result = runAskCommand({ workspace, request: "Set Unknown App goal to Perform basic operations" });
          expect(result.data.result.status).toBe("requires_review");
          expect(result.data.intake.missingFields).toContain("project");
          expect(result.data.reviewItemId).toMatch(/^review_/);
          expect(result.data.codexInvocations).toHaveLength(0);
          const review = runReviewShowCommand({ workspace, id: result.data.reviewItemId ?? "" });
          expect(review.data.item.decisionNeeded).toBe("Requires Review: project ambiguous or missing.");
        }
      }
    ];

    for (const example of examples) {
      example.assert();
      const lastAskIntent = withDatabase(workspace, (db) =>
        db.prepare("SELECT resolved_intent FROM ask_requests ORDER BY created_at DESC LIMIT 1").get() as { resolved_intent: string }
      );
      expect(lastAskIntent.resolved_intent).toBe(example.intent);
    }
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
