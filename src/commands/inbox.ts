import { withDatabase } from "../db/connection.js";
import {
  createWorkItemWithOptionalArtifact,
  listMilestonesForProject,
  listProjects
} from "../db/repositories.js";
import type { Milestone } from "../domain/types.js";
import { promptForInboxItem } from "../prompts/index.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

export async function runInboxAddCommand(options: { workspace: string }): Promise<void> {
  const workspacePath = resolveWorkspacePath(options.workspace);
  const { projects, milestones } = withDatabase(workspacePath, (db) => {
    const allProjects = listProjects(db);
    const allMilestones: Milestone[] = [];
    for (const project of allProjects) {
      allMilestones.push(...listMilestonesForProject(db, project.id));
    }

    return { projects: allProjects, milestones: allMilestones };
  });

  const input = await promptForInboxItem(projects, milestones);
  const result = withDatabase(workspacePath, (db) => createWorkItemWithOptionalArtifact(db, input));

  console.log(`Added work item: ${result.workItem.title}`);
  console.log(`Queue: ${result.workItem.queue}`);
}
