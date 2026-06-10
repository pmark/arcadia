import { milestoneNotFound, projectNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { completeMilestone, createMilestoneForProject } from "../db/repositories.js";
import type { Milestone } from "../domain/types.js";

export interface MilestoneCreateCommandData {
  milestone: Milestone;
}

export interface MilestoneCompleteCommandData {
  milestone: Milestone;
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
