import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { milestoneNotFound, projectNotFound } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createWorkItemWithOptionalArtifact,
  getMilestone,
  getProject,
  listMilestonesForProject,
  listProjects
} from "../db/repositories.js";
import type { Artifact, Milestone, WorkItem } from "../domain/types.js";
import { WORK_CLASSIFICATION_LABELS, type QueueName, type WorkClassification } from "../domain/constants.js";
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

  console.log(`Added Action: ${result.workItem.title}`);
  console.log(`Queue: ${result.workItem.queue}`);
}

export interface InboxImportOptions {
  workspace: string;
  title: string;
  input: string;
  queue: QueueName;
  classification: WorkClassification;
  nextAction: string;
  project?: string;
  milestone?: string;
  expectedArtifact?: string;
}

export interface InboxImportCommandData {
  workItem: WorkItem;
  artifact: Artifact | null;
}

export function runInboxImportCommand(options: InboxImportOptions): CommandSuccess<InboxImportCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const result = withDatabase(workspacePath, (db) => {
    if (options.project && !getProject(db, options.project)) {
      throw projectNotFound(options.project);
    }

    if (options.milestone) {
      const milestone = getMilestone(db, options.milestone);
      if (!milestone) {
        throw milestoneNotFound(options.milestone);
      }

      if (options.project && milestone.project_id !== options.project) {
        throw milestoneNotFound(options.milestone);
      }
    }

    return createWorkItemWithOptionalArtifact(db, {
      projectId: options.project ?? null,
      milestoneId: options.milestone ?? null,
      title: options.title,
      rawInput: options.input,
      queue: options.queue,
      workClassification: options.classification,
      nextAction: options.nextAction,
      expectedArtifact: options.expectedArtifact
    });
  });

  return createSuccess({
    command: "inbox.import",
    workspace: workspacePath,
    data: result,
    artifacts: result.artifact?.path ? [result.artifact.path] : []
  });
}

export function renderInboxImportSuccess(response: CommandSuccess<InboxImportCommandData>): string[] {
  const lines = [
    `Imported Action: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Queue: ${response.data.workItem.queue}`,
    `Responsibility: ${WORK_CLASSIFICATION_LABELS[response.data.workItem.work_classification]}`
  ];

  if (response.data.artifact) {
    lines.push(`Artifact: ${response.data.artifact.title}`);
  }

  return lines;
}
