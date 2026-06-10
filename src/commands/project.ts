import { withDatabase } from "../db/connection.js";
import { createProjectWithInitialWork, listProjectSummaries } from "../db/repositories.js";
import { WORK_CLASSIFICATION_LABELS } from "../domain/constants.js";
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

export function runProjectListCommand(options: { workspace: string }): void {
  const workspacePath = resolveWorkspacePath(options.workspace);
  const projects = withDatabase(workspacePath, listProjectSummaries);

  if (projects.length === 0) {
    console.log("No projects yet.");
    return;
  }

  for (const project of projects) {
    const classification = project.work_classification
      ? WORK_CLASSIFICATION_LABELS[project.work_classification]
      : "Unclassified";
    console.log(`${project.name} (${project.status})`);
    console.log(`  Milestone: ${project.current_milestone ?? "None"}`);
    console.log(`  Next action: ${project.next_action ?? "None"}`);
    console.log(`  Work classification: ${classification}`);
  }
}
