import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { projectNotFound } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { createProjectWithInitialWork, listProjectSummaries, updateProjectStatus } from "../db/repositories.js";
import { WORK_CLASSIFICATION_LABELS } from "../domain/constants.js";
import type { Project, ProjectSummary } from "../domain/types.js";
import { promptForProjectCreate } from "../prompts/index.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

export async function runProjectCreateCommand(options: { workspace: string }): Promise<void> {
  const workspacePath = resolveWorkspacePath(options.workspace);
  const input = await promptForProjectCreate();
  const result = withDatabase(workspacePath, (db) => createProjectWithInitialWork(db, input));

  console.log(`Created project: ${result.project.name}`);
  console.log(`Milestone: ${result.milestone.title}`);
  console.log(`Next action: ${result.workItem.next_action}`);
}

export interface ProjectListCommandData {
  projects: ProjectSummary[];
}

export interface ProjectUpdateCommandData {
  project: Project;
  updated: string[];
}

export function runProjectListCommand(options: { workspace: string }): CommandSuccess<ProjectListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const projects = withDatabase(workspacePath, listProjectSummaries);

  return createSuccess({
    command: "project.list",
    workspace: workspacePath,
    data: { projects }
  });
}

export function runProjectUpdateCommand(options: {
  workspace: string;
  projectId: string;
  status: string;
}): CommandSuccess<ProjectUpdateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const project = withDatabase(workspacePath, (db) => updateProjectStatus(db, options.projectId, options.status));

  if (!project) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "project.update",
    workspace: workspacePath,
    data: { project, updated: ["status"] }
  });
}

export function renderProjectListSuccess(response: CommandSuccess<ProjectListCommandData>): string[] {
  if (response.data.projects.length === 0) {
    return ["No projects yet."];
  }

  const lines: string[] = [];
  for (const project of response.data.projects) {
    const classification = project.work_classification
      ? WORK_CLASSIFICATION_LABELS[project.work_classification]
      : "Unclassified";
    lines.push(`${project.name} (${project.status})`);
    lines.push(`  Milestone: ${project.current_milestone ?? "None"}`);
    lines.push(`  Next action: ${project.next_action ?? "None"}`);
    lines.push(`  Work classification: ${classification}`);
  }

  return lines;
}

export function renderProjectUpdateSuccess(response: CommandSuccess<ProjectUpdateCommandData>): string[] {
  return [
    `Updated project: ${response.data.project.name}`,
    `ID: ${response.data.project.id}`,
    `Status: ${response.data.project.status}`
  ];
}
