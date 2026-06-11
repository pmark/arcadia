import { milestoneNotFound, projectNotFound, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { completeMilestone, createMilestoneForProject, listMilestones } from "../db/repositories.js";
import type { Milestone, MilestoneSummary } from "../domain/types.js";

export interface MilestoneCreateCommandData {
  milestone: Milestone;
}

export interface MilestoneCompleteCommandData {
  milestone: Milestone;
}

export interface MilestoneListCommandData {
  milestones: MilestoneSummary[];
}

export function runMilestoneListCommand(options: {
  workspace: string;
  status?: string;
  limit?: string | number;
}): CommandSuccess<MilestoneListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const limit = parseLimit(options.limit);
  const milestones = withDatabase(workspacePath, (db) => listMilestones(db, {
    status: options.status,
    limit
  }));

  return createSuccess({
    command: "milestone.list",
    workspace: workspacePath,
    data: { milestones }
  });
}

export function runMilestoneCreateCommand(options: {
  workspace: string;
  projectId: string;
  title: string;
}): CommandSuccess<MilestoneCreateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const milestone = withDatabase(workspacePath, (db) => createMilestoneForProject(db, options.projectId, options.title));

  if (!milestone) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "milestone.create",
    workspace: workspacePath,
    data: { milestone }
  });
}

export function runMilestoneCompleteCommand(options: {
  workspace: string;
  milestoneId: string;
}): CommandSuccess<MilestoneCompleteCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const milestone = withDatabase(workspacePath, (db) => completeMilestone(db, options.milestoneId));

  if (!milestone) {
    throw milestoneNotFound(options.milestoneId);
  }

  return createSuccess({
    command: "milestone.complete",
    workspace: workspacePath,
    data: { milestone }
  });
}

export function renderMilestoneListSuccess(response: CommandSuccess<MilestoneListCommandData>): string[] {
  if (response.data.milestones.length === 0) {
    return ["No milestones found."];
  }

  return response.data.milestones.map((milestone) =>
    `${milestone.id}: ${milestone.title} [${milestone.project_name}] (${milestone.status})`
  );
}

export function renderMilestoneCreateSuccess(response: CommandSuccess<MilestoneCreateCommandData>): string[] {
  return [
    `Created milestone: ${response.data.milestone.title}`,
    `ID: ${response.data.milestone.id}`,
    `Project: ${response.data.milestone.project_id}`,
    `Status: ${response.data.milestone.status}`
  ];
}

export function renderMilestoneCompleteSuccess(response: CommandSuccess<MilestoneCompleteCommandData>): string[] {
  return [
    `Completed milestone: ${response.data.milestone.title}`,
    `ID: ${response.data.milestone.id}`,
    `Status: ${response.data.milestone.status}`
  ];
}

function parseLimit(raw: string | number | undefined): number {
  if (raw === undefined) {
    return 10;
  }

  const value = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw validationError("Limit must be an integer from 1 to 50.", { limit: raw });
  }

  return value;
}
