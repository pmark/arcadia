import path from "node:path";
import { executionPlanNotFound, validationError, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  completeWorkItem,
  createExecutionPlan,
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
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";

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
    throw validationError("At least one work item field is required.", { fields: updateableFields });
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
    return ["No work items yet."];
  }

  return response.data.workItems.flatMap((item) => renderWorkItem(item));
}

export function renderWorkUpdateSuccess(response: CommandSuccess<WorkUpdateCommandData>): string[] {
  return [
    `Updated work item: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Updated fields: ${response.data.updated.join(", ")}`,
    `Queue: ${response.data.workItem.queue}`,
    `Work classification: ${response.data.workItem.work_classification}`,
    `Status: ${response.data.workItem.status}`,
    `Next action: ${response.data.workItem.next_action}`
  ];
}

export function renderWorkDoneSuccess(response: CommandSuccess<WorkDoneCommandData>): string[] {
  return [
    `Completed work item: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Status: ${response.data.workItem.status}`
  ];
}

export function renderWorkPlanSuccess(response: CommandSuccess<WorkPlanCommandData>): string[] {
  return [
    `Created execution plan: ${response.data.plan.id}`,
    `Work item: ${response.data.plan.work_item_id}`,
    `Status: ${response.data.plan.status}`,
    "Steps:",
    ...response.data.plan.steps.map((step) =>
      `  ${step.position}. ${step.title} (${step.executor_type}, safe: ${step.safe_to_run === 1 ? "yes" : "no"})`
    )
  ];
}

export function renderWorkRunSuccess(response: CommandSuccess<WorkRunCommandData>): string[] {
  return [
    `Created execution run: ${response.data.run.id}`,
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

function renderWorkItem(item: WorkItemSummary): string[] {
  const project = item.project_name ? ` [${item.project_name}]` : "";
  const milestone = item.milestone_title ? ` (${item.milestone_title})` : "";

  return [
    `${item.title}${project}${milestone}`,
    `  ID: ${item.id}`,
    `  Queue: ${QUEUE_LABELS[item.queue]}`,
    `  Work classification: ${WORK_CLASSIFICATION_LABELS[item.work_classification]}`,
    `  Status: ${item.status}`,
    `  Next action: ${item.next_action}`
  ];
}
