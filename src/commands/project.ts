import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { createProjectWithInitialWork, listProjectSummaries } from "../db/repositories.js";
import { WORK_CLASSIFICATION_LABELS } from "../domain/constants.js";
import type { ProjectSummary } from "../domain/types.js";
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

export function runProjectListCommand(options: { workspace: string }): CommandSuccess<ProjectListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const projects = withDatabase(workspacePath, listProjectSummaries);

  return createSuccess({
    command: "project.list",
    workspace: workspacePath,
    data: { projects }
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
