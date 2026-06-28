import path from "node:path";
import { createCodexPacket, selectAgentProfile } from "../codex/packets.js";
import { executionPlanNotFound, validationError, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  completeWorkItem,
  createArtifactRecord,
  createCodexInvocation,
  createExecutionPlan,
  getCodexInvocationForPlan,
  getProjectContext,
  getReviewItemForInvocation,
  getWorkItem,
  listWorkItems,
  updateWorkItem
} from "../db/repositories.js";
import {
  QUEUE_LABELS,
  WORK_CLASSIFICATION_LABELS
} from "../domain/constants.js";
import type { ExecutionPlanSummary, ExecutionRunSummary, WorkItemSummary } from "../domain/types.js";
import { ensureBuiltInSkills, planStepsForWorkItem } from "../execution/skills.js";
import { executePlan, resolvePlanForRun } from "../execution/runner.js";
import { queueApprovedPlanningRun } from "../execution/planningAuthorization.js";
import type { Phase3Registries } from "../intent/registries.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import type { ResolvedIntent } from "../intent/resolver.js";

export interface WorkListCommandData {
  workItems: WorkItemSummary[];
}

export interface WorkUpdateOptions {
  workspace: string;
  workId: string;
  queue?: string;
  classification?: string;
  nextAction?: string;
  status?: string;
}

export interface WorkUpdateCommandData {
  workItem: WorkItemSummary;
  updated: string[];
}

export interface WorkDoneCommandData {
  workItem: WorkItemSummary;
}

export interface WorkPlanCommandData {
  plan: ExecutionPlanSummary;
}

export interface WorkRunCommandData {
  run: ExecutionRunSummary;
  missionLogPath: string | null;
}

export function runWorkListCommand(options: { workspace: string }): CommandSuccess<WorkListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const workItems = withDatabase(workspacePath, listWorkItems);

  return createSuccess({
    command: "work.list",
    workspace: workspacePath,
    data: { workItems }
  });
}

export function runWorkUpdateCommand(options: WorkUpdateOptions): CommandSuccess<WorkUpdateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const updated = updatedFields(options);

  if (updated.length === 0) {
    throw validationError("At least one Action field is required.", { fields: updateableFields });
  }

  const workItem = withDatabase(workspacePath, (db) =>
    updateWorkItem(db, options.workId, {
      queue: options.queue,
      workClassification: options.classification,
      nextAction: options.nextAction,
      status: options.status
    })
  );

  if (!workItem) {
    throw workItemNotFound(options.workId);
  }

  return createSuccess({
    command: "work.update",
    workspace: workspacePath,
    data: { workItem, updated }
  });
}

export function runWorkDoneCommand(options: { workspace: string; workId: string }): CommandSuccess<WorkDoneCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const workItem = withDatabase(workspacePath, (db) => completeWorkItem(db, options.workId));

  if (!workItem) {
    throw workItemNotFound(options.workId);
  }

  return createSuccess({
    command: "work.done",
    workspace: workspacePath,
    data: { workItem }
  });
}

export function runWorkPlanCommand(options: { workspace: string; workId: string }): CommandSuccess<WorkPlanCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const plan = withDatabase(workspacePath, (db) => {
    ensureBuiltInSkills(db);
    const workItem = getWorkItem(db, options.workId);
    if (!workItem) {
      return null;
    }

    return createExecutionPlan(db, {
      workItemId: workItem.id,
      summary: `Execution plan for "${workItem.title}".`,
      steps: planStepsForWorkItem(workItem)
    });
  });

  if (!plan) {
    throw workItemNotFound(options.workId);
  }

  return createSuccess({
    command: "work.plan",
    workspace: workspacePath,
    data: { plan }
  });
}

export function runWorkRunCommand(options: {
  workspace: string;
  workId: string;
  plan?: string;
  allowCodexPlanning?: boolean;
  allowCodexBuild?: boolean;
  agentProfile?: string;
}): CommandSuccess<WorkRunCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const registries = options.allowCodexPlanning || options.allowCodexBuild
    ? loadPhase3Registries(workspacePath)
    : null;
  if (registries) {
    validatePhase3Registries(registries);
  }
  const result = withDatabase(workspacePath, (db) => {
    ensureBuiltInSkills(db);
    const workItem = getWorkItem(db, options.workId);
    if (!workItem) {
      return { missingWorkItem: true as const };
    }

    let plan = resolvePlanForRun(db, options.workId, options.plan);
    if (!plan && !options.plan) {
      plan = createExecutionPlan(db, {
        workItemId: workItem.id,
        summary: `Execution plan for "${workItem.title}".`,
        steps: planStepsForWorkItem(workItem)
      });
    }

    if (!plan) {
      return { missingPlan: true as const };
    }

    if (plan.steps.some((step) => step.executor_type === "codex_planning")) {
      if (!options.allowCodexPlanning) {
        throw validationError("Planning execution requires an approved Decision for this Action, plan, and packet.");
      }
      const invocation = getCodexInvocationForPlan(db, {
        workItemId: workItem.id,
        planId: plan.id,
        purpose: "planning"
      });
      const decision = invocation
        ? getReviewItemForInvocation(db, invocation.id, ["CodexPlanningRunApproval", "CodexPlanningRetryApproval"])
        : null;
      if (!decision || decision.status !== "approved") {
        throw validationError("Planning execution requires an approved Decision for this Action, plan, and packet.", {
          workItemId: workItem.id,
          planId: plan.id
        });
      }
      const queued = queueApprovedPlanningRun(db, workspacePath, {
        decisionId: decision.id,
        execute: true,
        executorName: options.agentProfile
      });
      if (!queued.run) {
        throw validationError("Approved planning Run could not be queued.");
      }
      return { run: queued.run, missionLogPath: queued.run.mission_log_path };
    }

    if (registries) {
      ensureCodexPacketsForPlan(db, workspacePath, workItem, plan, registries, {
        allowCodexPlanning: options.allowCodexPlanning,
        allowCodexBuild: options.allowCodexBuild
      });
    }

    return executePlan(db, workspacePath, plan, {
      allowCodexPlanning: options.allowCodexPlanning,
      allowCodexBuild: options.allowCodexBuild,
      agentProfile: options.agentProfile,
      codingAgentProfiles: registries?.codingAgents.profiles
    });
  });

  if ("missingWorkItem" in result) {
    throw workItemNotFound(options.workId);
  }

  if ("missingPlan" in result) {
    throw executionPlanNotFound(options.plan ?? "");
  }

  return createSuccess({
    command: "work.run",
    workspace: workspacePath,
    data: {
      run: result.run,
      missionLogPath: result.missionLogPath
    },
    artifacts: [
      ...(result.missionLogPath ? [path.join(workspacePath, result.missionLogPath)] : []),
      ...result.run.artifacts.flatMap((artifact) => artifact.path ? [path.join(workspacePath, artifact.path)] : [])
    ]
  });
}

export function renderWorkListSuccess(response: CommandSuccess<WorkListCommandData>): string[] {
  if (response.data.workItems.length === 0) {
    return ["No Actions yet."];
  }

  return response.data.workItems.flatMap((item) => renderWorkItem(item));
}

export function renderWorkUpdateSuccess(response: CommandSuccess<WorkUpdateCommandData>): string[] {
  return [
    `Updated Action: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Updated fields: ${response.data.updated.join(", ")}`,
    `Queue: ${response.data.workItem.queue}`,
    `Responsibility: ${WORK_CLASSIFICATION_LABELS[response.data.workItem.work_classification]}`,
    `Status: ${response.data.workItem.status}`,
    `Next action: ${response.data.workItem.next_action}`
  ];
}

export function renderWorkDoneSuccess(response: CommandSuccess<WorkDoneCommandData>): string[] {
  return [
    `Completed Action: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Status: ${response.data.workItem.status}`
  ];
}

export function renderWorkPlanSuccess(response: CommandSuccess<WorkPlanCommandData>): string[] {
  return [
    `Created workflow plan: ${response.data.plan.id}`,
    `Action: ${response.data.plan.work_item_id}`,
    `Status: ${response.data.plan.status}`,
    "Steps:",
    ...response.data.plan.steps.map((step) =>
      `  ${step.position}. ${step.title} (${step.executor_type}, safe: ${step.safe_to_run === 1 ? "yes" : "no"})`
    )
  ];
}

export function renderWorkRunSuccess(response: CommandSuccess<WorkRunCommandData>): string[] {
  return [
    `Created run: ${response.data.run.id}`,
    `Status: ${response.data.run.status}`,
    `Mission log: ${response.data.missionLogPath ?? "None"}`,
    "Steps:",
    ...response.data.run.steps.map((step) => `  ${step.status}: ${step.plan_step_title}`)
  ];
}

const updateableFields = ["queue", "classification", "nextAction", "status"] as const;

function updatedFields(options: WorkUpdateOptions): string[] {
  const fields: string[] = [];

  if (options.queue !== undefined) {
    fields.push("queue");
  }

  if (options.classification !== undefined) {
    fields.push("classification");
  }

  if (options.nextAction !== undefined) {
    fields.push("nextAction");
  }

  if (options.status !== undefined) {
    fields.push("status");
  }

  return fields;
}

function ensureCodexPacketsForPlan(
  db: Parameters<typeof getWorkItem>[0],
  workspacePath: string,
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary,
  registries: Phase3Registries,
  permissions: { allowCodexPlanning?: boolean; allowCodexBuild?: boolean }
): void {
  for (const step of plan.steps) {
    const purpose = step.executor_type === "codex_build"
      ? "build"
      : step.executor_type === "codex_planning"
        ? "planning"
        : null;

    if (!purpose) {
      continue;
    }

    const allowed = purpose === "build" ? permissions.allowCodexBuild : permissions.allowCodexPlanning;
    const existing = getCodexInvocationForPlan(db, { workItemId: workItem.id, planId: plan.id, purpose });
    if (!allowed || existing) {
      continue;
    }

    const agentProfile = selectAgentProfile(registries.codingAgents.profiles, purpose);
    const packet = createCodexPacket({
      workspace: workspacePath,
      request: workItem.raw_input,
      resolved: resolvedIntentForWorkPlan(workItem, plan, purpose),
      workItem,
      planId: plan.id,
      projectContext: workItem.project_id ? getProjectContext(db, workItem.project_id) : null,
      agentProfile
    });

    createCodexInvocation(db, {
      id: packet.invocationId,
      purpose: packet.purpose,
      agentProfile: packet.agentProfile.name,
      workspaceScope: packet.workspaceScope,
      command: packet.command,
      promptPath: packet.relativePromptPath,
      jsonlOutputPath: packet.relativeJsonlOutputPath,
      finalMessagePath: packet.relativeFinalMessagePath,
      status: "packet_created",
      workItemId: workItem.id,
      planId: plan.id,
      planStepId: step.id
    });

    createArtifactRecord(db, {
      projectId: workItem.project_id,
      workItemId: workItem.id,
      title: `Codex ${packet.purpose} packet: ${workItem.title}`,
      artifactType: "codex_prompt_packet",
      status: "drafted",
      path: packet.relativePromptPath
    });
  }
}

function resolvedIntentForWorkPlan(
  workItem: WorkItemSummary,
  plan: ExecutionPlanSummary,
  purpose: "planning" | "build"
): ResolvedIntent {
  return {
    intentId: purpose === "build" ? "codex_build" : "codex_plan",
    matched: false,
    title: workItem.title,
    outputKind: purpose === "build" ? "codex_build_packet" : "codex_planning_packet",
    queue: workItem.queue,
    workClassification: workItem.work_classification,
    nextAction: workItem.next_action,
    expectedArtifact: workItem.expected_artifact,
    skillSequence: plan.steps.map((step) => ({
      skillName: step.skill_name,
      title: step.title,
      command: step.command,
      executorType: step.executor_type,
      safeToRun: step.safe_to_run === 1,
      needsMark: step.needs_mark
    })),
    approvalGates: [],
    templates: [],
    slots: {},
    codexPurpose: purpose
  };
}

function renderWorkItem(item: WorkItemSummary): string[] {
  const project = item.project_name ? ` [${item.project_name}]` : "";
  const milestone = item.milestone_title ? ` (${item.milestone_title})` : "";

  return [
    `${item.title}${project}${milestone}`,
    `  ID: ${item.id}`,
    `  Queue: ${QUEUE_LABELS[item.queue]}`,
    `  Responsibility: ${WORK_CLASSIFICATION_LABELS[item.work_classification]}`,
    `  Status: ${item.status}`,
    `  Next action: ${item.next_action}`
  ];
}
