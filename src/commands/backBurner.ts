import { validationError, projectNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createWorkItemWithOptionalArtifact,
  getBackBurnerItem,
  getProject,
  listBackBurnerItems,
  updateBackBurnerItem
} from "../db/repositories.js";
import { queueForWorkClassification, type BackBurnerStatus, type WorkClassification } from "../domain/constants.js";
import type { BackBurnerItemSummary, WorkItem } from "../domain/types.js";

export interface BackBurnerListOptions {
  workspace: string;
  status?: BackBurnerStatus | "all";
}

export interface BackBurnerShowOptions {
  workspace: string;
  id: string;
}

export interface BackBurnerArchiveOptions {
  workspace: string;
  id: string;
}

export interface BackBurnerPromoteOptions {
  workspace: string;
  id: string;
  title?: string;
  project?: string;
  nextAction?: string;
  classification?: WorkClassification;
}

export interface BackBurnerListData {
  count: number;
  items: BackBurnerItemSummary[];
}

export interface BackBurnerShowData {
  item: BackBurnerItemSummary;
}

export interface BackBurnerArchiveData {
  item: BackBurnerItemSummary;
  result: {
    status: "archived";
    summary: string;
  };
}

export interface BackBurnerPromoteData {
  item: BackBurnerItemSummary;
  workItem: WorkItem;
  result: {
    status: "promoted";
    summary: string;
  };
}

export function runBackBurnerListCommand(
  options: BackBurnerListOptions
): CommandSuccess<BackBurnerListData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const status = options.status ?? "incubating";
  const items = withDatabase(workspacePath, (db) => listBackBurnerItems(db, status));

  return createSuccess({
    command: "back-burner.list",
    workspace: workspacePath,
    data: {
      count: items.length,
      items
    }
  });
}

export function runBackBurnerShowCommand(
  options: BackBurnerShowOptions
): CommandSuccess<BackBurnerShowData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const item = withDatabase(workspacePath, (db) => requireBackBurnerItem(db, options.id));

  return createSuccess({
    command: "back-burner.show",
    workspace: workspacePath,
    data: { item }
  });
}

export function runBackBurnerArchiveCommand(
  options: BackBurnerArchiveOptions
): CommandSuccess<BackBurnerArchiveData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const item = withDatabase(workspacePath, (db) => {
    requireBackBurnerItem(db, options.id);
    const updated = updateBackBurnerItem(db, options.id, { status: "archived" });
    if (!updated) {
      throw validationError("Back Burner item was not found.", { id: options.id });
    }
    return updated;
  });

  return createSuccess({
    command: "back-burner.archive",
    workspace: workspacePath,
    data: {
      item,
      result: {
        status: "archived",
        summary: "Back Burner item archived."
      }
    }
  });
}

export function runBackBurnerPromoteCommand(
  options: BackBurnerPromoteOptions
): CommandSuccess<BackBurnerPromoteData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const result = withDatabase(workspacePath, (db) => {
    const item = requireBackBurnerItem(db, options.id);
    if (item.status === "promoted") {
      throw validationError("Back Burner item is already promoted.", { id: item.id });
    }

    if (options.project && !getProject(db, options.project)) {
      throw projectNotFound(options.project);
    }

    const workClassification = options.classification ?? "autonomous";
    const created = createWorkItemWithOptionalArtifact(db, {
      projectId: options.project ?? null,
      title: options.title?.trim() || titleFromBackBurnerItem(item),
      rawInput: item.original_input,
      queue: queueForWorkClassification(workClassification),
      workClassification,
      nextAction: options.nextAction?.trim() || item.suggested_next_step || "Clarify and execute this captured input."
    });
    const updated = updateBackBurnerItem(db, item.id, {
      status: "promoted",
      promotedWorkItemId: created.workItem.id
    });
    if (!updated) {
      throw validationError("Back Burner item was not found.", { id: item.id });
    }
    return { item: updated, workItem: created.workItem };
  });

  return createSuccess({
    command: "back-burner.promote",
    workspace: workspacePath,
    data: {
      item: result.item,
      workItem: result.workItem,
      result: {
        status: "promoted",
        summary: "Back Burner item promoted to work item."
      }
    }
  });
}

export function renderBackBurnerListSuccess(response: CommandSuccess<BackBurnerListData>): string[] {
  const lines = ["Arcadia Back Burner", `Items: ${response.data.count}`];
  if (response.data.items.length === 0) {
    lines.push("None");
    return lines;
  }

  for (const item of response.data.items) {
    lines.push("");
    lines.push(`- ${item.id}: ${item.classification} (${item.status})`);
    lines.push(`  Input: ${item.original_input}`);
    lines.push(`  Reason: ${item.reason}`);
    lines.push(`  Suggested next step: ${item.suggested_next_step ?? "None"}`);
  }

  return lines;
}

export function renderBackBurnerShowSuccess(response: CommandSuccess<BackBurnerShowData>): string[] {
  const item = response.data.item;
  return [
    "Arcadia Back Burner",
    `ID: ${item.id}`,
    `Status: ${item.status}`,
    `Classification: ${item.classification}`,
    `Confidence: ${item.confidence.toFixed(2)}`,
    `Ingress source: ${item.ingress_source}`,
    `Original input: ${item.original_input}`,
    `Reason: ${item.reason}`,
    `Suggested next step: ${item.suggested_next_step ?? "None"}`,
    `Promoted work item: ${item.promoted_work_item_id ?? "None"}`
  ];
}

export function renderBackBurnerArchiveSuccess(response: CommandSuccess<BackBurnerArchiveData>): string[] {
  return [
    "Back Burner item archived.",
    `ID: ${response.data.item.id}`,
    `Status: ${response.data.item.status}`
  ];
}

export function renderBackBurnerPromoteSuccess(response: CommandSuccess<BackBurnerPromoteData>): string[] {
  return [
    "Back Burner item promoted.",
    `ID: ${response.data.item.id}`,
    `Work item: ${response.data.workItem.id}`,
    `Title: ${response.data.workItem.title}`
  ];
}

function requireBackBurnerItem(db: Parameters<typeof getBackBurnerItem>[0], id: string): BackBurnerItemSummary {
  const item = getBackBurnerItem(db, id);
  if (!item) {
    throw validationError("Back Burner item was not found.", { id });
  }
  return item;
}

function titleFromBackBurnerItem(item: BackBurnerItemSummary): string {
  return item.original_input.split(/\r?\n/)[0]?.trim().slice(0, 120) || "Captured Back Burner item";
}
