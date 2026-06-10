import path from "node:path";
import { withDatabase } from "../db/connection.js";
import {
  createMissionLog,
  getProject,
  listMilestonesForProject,
  listProjects
} from "../db/repositories.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";
import { promptForMissionLog } from "../prompts/index.js";
import { createId } from "../utils/id.js";
import { getWorkspacePaths, resolveWorkspacePath } from "../workspace/paths.js";

export async function runLogCreateCommand(options: { workspace: string }): Promise<void> {
  const workspacePath = resolveWorkspacePath(options.workspace);
  const { projects, milestones } = withDatabase(workspacePath, (db) => {
    const allProjects = listProjects(db);
    return {
      projects: allProjects,
      milestones: allProjects.flatMap((project) => listMilestonesForProject(db, project.id))
    };
  });

  const prompted = await promptForMissionLog(projects, milestones);
  const logId = createId("missionLog");
  const project = withDatabase(workspacePath, (db) => getProject(db, prompted.projectId));
  const markdownPath = buildMissionLogRelativePath(workspacePath, project?.name ?? "unassigned", logId);

  const missionLog = withDatabase(workspacePath, (db) =>
    createMissionLog(db, {
      id: logId,
      ...prompted,
      markdownPath
    })
  );

  const markdownProject = withDatabase(workspacePath, (db) => getProject(db, missionLog.project_id ?? ""));
  const markdownMilestone =
    missionLog.project_id && missionLog.milestone_id
      ? withDatabase(workspacePath, (db) =>
          listMilestonesForProject(db, missionLog.project_id ?? "").find(
            (milestone) => milestone.id === missionLog.milestone_id
          ) ?? null
        )
      : null;

  writeMissionLogMarkdown(workspacePath, {
    missionLog,
    project: markdownProject,
    milestone: markdownMilestone
  });

  console.log(`Mission log created: ${path.join(getWorkspacePaths(workspacePath).root, missionLog.markdown_path)}`);
}
