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
import { queueForWorkClassification, type BackBurnerFacetTag, type BackBurnerStatus, type WorkClassification } from "../domain/constants.js";
import type { BackBurnerItemSummary, WorkItem } from "../domain/types.js";

export interface BackBurnerListOptions {
  workspace: string;
  status?: BackBurnerStatus | "all";
  fired?: boolean;
  project?: string;
  tag?: BackBurnerFacetTag;
  groupBy?: "fired" | "project" | "tag" | "none";
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
  groups: Array<{ key: string; label: string; items: BackBurnerItemSummary[] }>;
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
  const status = options.status ?? (options.fired === true ? "opportunistic" : "incubating");
  const items = withDatabase(workspacePath, (db) => listBackBurnerItems(db, status, {
    fired: options.fired,
    project: options.project,
    tag: options.tag
  }));
  const groups = groupBackBurnerItems(items, options.groupBy ?? "fired");

  return createSuccess({
    command: "back-burner.list",
    workspace: workspacePath,
    data: {
      count: items.length,
      items,
      groups
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

    const projectId = options.project ?? item.project_id;
    if (projectId && !getProject(db, projectId)) {
      throw projectNotFound(projectId);
    }

    const workClassification = options.classification ?? "autonomous";
    const created = createWorkItemWithOptionalArtifact(db, {
      projectId,
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
        summary: "Back Burner item promoted to Action."
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

  for (const group of response.data.groups) {
    lines.push("", `${group.label} (${group.items.length})`);
    for (const item of group.items) {
      lines.push(`- ${item.id}: ${item.classification} (${item.effective_status})`);
      lines.push(`  Input: ${item.original_input}`);
      lines.push(`  Project: ${item.project_name ?? "Unscoped"}`);
      lines.push(`  Surface: ${formatSurfaceCondition(item)} — ${item.surface_fired ? "fired" : "not fired"}`);
      if (item.surface_warning) lines.push(`  Warning: ${item.surface_warning}`);
      lines.push(`  Tags: ${item.facet_tags.join(", ") || "None"}`);
      lines.push(`  Reason: ${item.reason}`);
      lines.push(`  Suggested next step: ${item.suggested_next_step ?? "None"}`);
    }
  }

  return lines;
}

export function renderBackBurnerShowSuccess(response: CommandSuccess<BackBurnerShowData>): string[] {
  const item = response.data.item;
  return [
    "Arcadia Back Burner",
    `ID: ${item.id}`,
    `Status: ${item.effective_status}`,
    `Stored status: ${item.status}`,
    `Intake category: ${item.classification}`,
    `Confidence: ${item.confidence.toFixed(2)}`,
    `Ingress source: ${item.ingress_source}`,
    `Project: ${item.project_name ?? "Unscoped"}`,
    `Source reference: ${item.source_ref ?? "None"}`,
    `Surface condition: ${formatSurfaceCondition(item)}`,
    `Surface fired: ${item.surface_fired ? "yes" : "no"}`,
    ...(item.surface_warning ? [`Surface warning: ${item.surface_warning}`] : []),
    `Tags: ${item.facet_tags.join(", ") || "None"}`,
    `Original input: ${item.original_input}`,
    `Reason: ${item.reason}`,
    `Suggested next step: ${item.suggested_next_step ?? "None"}`,
    `Promoted Action: ${item.promoted_work_item_id ?? "None"}`
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
    `Action: ${response.data.workItem.id}`,
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

function formatSurfaceCondition(item: BackBurnerItemSummary): string {
  const condition = item.surface_condition;
  if (condition.kind === "date") return `date ${condition.date}`;
  if (condition.kind === "dependency") return `dependency ${condition.workItemId} = ${condition.status}`;
  if (condition.kind === "predicate") return `predicate ${condition.name}`;
  return "manual";
}

function groupBackBurnerItems(
  items: BackBurnerItemSummary[],
  groupBy: NonNullable<BackBurnerListOptions["groupBy"]>
): BackBurnerListData["groups"] {
  if (groupBy === "none") return [{ key: "all", label: "Items", items }];
  const groups = new Map<string, BackBurnerItemSummary[]>();
  for (const item of items) {
    const keys = groupBy === "fired"
      ? [item.surface_warning ? "warning" : item.surface_fired ? "fired" : "waiting"]
      : groupBy === "project"
        ? [item.project_name ?? "Unscoped"]
        : item.facet_tags.length ? item.facet_tags : ["Untagged"];
    for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, groupedItems]) => ({
    key,
    label: groupBy === "fired"
      ? key === "fired" ? "Fired conditions" : key === "warning" ? "Condition warnings" : "Waiting"
      : key,
    items: groupedItems
  }));
}
