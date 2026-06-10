import { validationError, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { completeWorkItem, listWorkItems, updateWorkItem } from "../db/repositories.js";
import {
  QUEUE_LABELS,
  WORK_CLASSIFICATION_LABELS
} from "../domain/constants.js";
import type { WorkItemSummary } from "../domain/types.js";

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
