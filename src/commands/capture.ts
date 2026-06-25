import { milestoneNotFound, projectNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { createWorkItemWithOptionalArtifact, getMilestone, getProject } from "../db/repositories.js";
import type { Artifact, WorkItem } from "../domain/types.js";
import { WORK_CLASSIFICATION_LABELS, type WorkClassification } from "../domain/constants.js";
import { classifyCapturedIntent } from "../execution/skills.js";

export interface CaptureOptions {
  workspace: string;
  text: string;
  project?: string;
  milestone?: string;
  expectedArtifact?: string;
}

export interface CaptureCommandData {
  workItem: WorkItem;
  artifact: Artifact | null;
  matchedSkillName: string | null;
}

export function runCaptureCommand(options: CaptureOptions): CommandSuccess<CaptureCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const classification = classifyCapturedIntent(options.text);
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
      title: classification.title,
      rawInput: options.text,
      queue: classification.queue,
      workClassification: classification.workClassification,
      nextAction: classification.nextAction,
      expectedArtifact: options.expectedArtifact
    });
  });

  return createSuccess({
    command: "capture",
    workspace: workspacePath,
    data: {
      workItem: result.workItem,
      artifact: result.artifact,
      matchedSkillName: classification.matchedSkillName
    },
    artifacts: result.artifact?.path ? [result.artifact.path] : []
  });
}

export function renderCaptureSuccess(response: CommandSuccess<CaptureCommandData>): string[] {
  return [
    `Captured Action: ${response.data.workItem.title}`,
    `ID: ${response.data.workItem.id}`,
    `Queue: ${response.data.workItem.queue}`,
    `Responsibility: ${WORK_CLASSIFICATION_LABELS[response.data.workItem.work_classification as WorkClassification]}`,
    `Matched skill: ${response.data.matchedSkillName ?? "None"}`
  ];
}
