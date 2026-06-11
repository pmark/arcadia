import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import type { AskCommandData, AskOptions } from "./ask.js";
import { renderAskSuccess, runAskCommand } from "./ask.js";
import { withDatabase } from "../db/connection.js";
import {
  createMissionLog,
  createMilestoneForProject,
  createWorkItemWithOptionalArtifact,
  getActiveMilestoneForProject,
  getProject,
  listProjects,
  listRecentMissionLogs,
  listWorkItems,
  updateMilestoneStatus,
  updateWorkItem,
  upsertProject
} from "../db/repositories.js";
import type { Milestone, MissionLog, Project, WorkItem } from "../domain/types.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";
import { initWorkspace } from "../workspace/initWorkspace.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

export const DOGFOOD_WORKSPACE = ".arcadia-workspace";
export const DOGFOOD_PROJECT_NAME = "Arcadia";
export const DOGFOOD_MISSION =
  "Build Arcadia into a local-first mission control system for sustaining progress across a portfolio of creative and software projects.";
export const DOGFOOD_GOAL =
  "Use Arcadia as the primary system for managing Arcadia development for 30 consecutive days.";
export const DOGFOOD_MILESTONE = "Complete the dogfooding workflow.";
export const DOGFOOD_NEXT_ACTION = "Use Arcadia ask to create and run Arcadia development work items.";
const DOGFOOD_LOG_RESULT = "Arcadia is now being dogfooded through its repo-local workspace.";

export interface DogfoodInitCommandData {
  workspacePath: string;
  project: Project;
  milestone: Milestone;
  workItem: WorkItem;
  missionLog: MissionLog;
  createdConfig: boolean;
}

export type DogfoodAskRunner = (options: AskOptions) => CommandSuccess<AskCommandData>;

export function dogfoodWorkspacePath(): string {
  return resolveWorkspacePath(DOGFOOD_WORKSPACE);
}

export function runDogfoodInitCommand(): CommandSuccess<DogfoodInitCommandData> {
  const initialized = initWorkspace(DOGFOOD_WORKSPACE);
  const data = withDatabase(initialized.workspacePath, (db) => {
    const project = upsertProject(db, {
      name: DOGFOOD_PROJECT_NAME,
      mission: DOGFOOD_MISSION,
      goal: DOGFOOD_GOAL,
      status: "active",
      currentMilestone: DOGFOOD_MILESTONE,
      nextAction: DOGFOOD_NEXT_ACTION,
      workClassification: "codex"
    });
    const milestone = ensureDogfoodMilestone(db, project.id);
    const workItem = ensureDogfoodWorkItem(db, project.id, milestone.id);
    const missionLog = ensureDogfoodMissionLog(db, initialized.workspacePath, project, milestone);

    return {
      workspacePath: initialized.workspacePath,
      project,
      milestone,
      workItem,
      missionLog,
      createdConfig: initialized.createdConfig
    };
  });

  return createSuccess({
    command: "dogfood.init",
    workspace: initialized.workspacePath,
    data,
    artifacts: [
      initialized.databasePath,
      initialized.configPath,
      path.join(initialized.workspacePath, data.missionLog.markdown_path)
    ]
  });
}

export function runDogfoodAskCommand(
  options: { request: string; runSafe?: boolean },
  askRunner: DogfoodAskRunner = runAskCommand
): CommandSuccess<AskCommandData> {
  const context = resolveDogfoodAskContext();
  return askRunner({
    workspace: DOGFOOD_WORKSPACE,
    request: options.request,
    project: context.projectId ?? undefined,
    milestone: context.milestoneId ?? undefined,
    runSafe: options.runSafe
  });
}

export function renderDogfoodInitSuccess(response: CommandSuccess<DogfoodInitCommandData>): string[] {
  return [
    `Initialized Arcadia dogfood workspace: ${response.data.workspacePath}`,
    `Project: ${response.data.project.name} (${response.data.project.status})`,
    `Goal: ${response.data.project.goal ?? "None"}`,
    `Milestone: ${response.data.milestone.title}`,
    `Next action: ${response.data.workItem.next_action}`,
    `Mission log: ${response.data.missionLog.markdown_path}`
  ];
}

export function renderDogfoodAskSuccess(response: CommandSuccess<AskCommandData>): string[] {
  return renderAskSuccess(response);
}

function ensureDogfoodMilestone(db: Parameters<typeof getProject>[0], projectId: string): Milestone {
  const active = getActiveMilestoneForProject(db, projectId);
  if (active?.title === DOGFOOD_MILESTONE) {
    return active;
  }

  if (active) {
    updateMilestoneStatus(db, active.id, "paused");
  }

  const created = createMilestoneForProject(db, projectId, DOGFOOD_MILESTONE, "active");
  if (!created) {
    throw new Error("Could not create dogfood milestone.");
  }

  return created;
}

function resolveDogfoodAskContext(): { projectId: string | null; milestoneId: string | null } {
  const { workspacePath } = resolveReadyWorkspace(DOGFOOD_WORKSPACE);
  return withDatabase(workspacePath, (db) => {
    const project = listProjects(db).find((candidate) => candidate.name === DOGFOOD_PROJECT_NAME);
    if (!project) {
      return { projectId: null, milestoneId: null };
    }

    return {
      projectId: project.id,
      milestoneId: getActiveMilestoneForProject(db, project.id)?.id ?? null
    };
  });
}

function ensureDogfoodWorkItem(db: Parameters<typeof getProject>[0], projectId: string, milestoneId: string): WorkItem {
  const existing = listWorkItems(db).find(
    (item) =>
      item.project_id === projectId &&
      item.milestone_id === milestoneId &&
      item.raw_input === DOGFOOD_NEXT_ACTION &&
      item.status !== "done"
  );
  if (existing) {
    const updated = updateWorkItem(db, existing.id, {
      queue: "work_queue",
      workClassification: "codex",
      nextAction: DOGFOOD_NEXT_ACTION,
      status: "open"
    });
    if (!updated) {
      throw new Error("Could not update dogfood work item.");
    }
    return updated;
  }

  return createWorkItemWithOptionalArtifact(db, {
    projectId,
    milestoneId,
    title: DOGFOOD_NEXT_ACTION,
    rawInput: DOGFOOD_NEXT_ACTION,
    queue: "work_queue",
    workClassification: "codex",
    nextAction: DOGFOOD_NEXT_ACTION
  }).workItem;
}

function ensureDogfoodMissionLog(
  db: Parameters<typeof getProject>[0],
  workspace: string,
  project: Project,
  milestone: Milestone
): MissionLog {
  const existing = listRecentMissionLogs(db, 100).find(
    (log) => log.project_id === project.id && log.result === DOGFOOD_LOG_RESULT
  );
  if (existing) {
    return existing;
  }

  const logId = "log_arcadia_dogfood_init";
  const markdownPath = buildMissionLogRelativePath(workspace, project.name, logId);
  const missionLog = createMissionLog(db, {
    id: logId,
    projectId: project.id,
    milestoneId: milestone.id,
    workPerformed: "Initialized the repo-local Arcadia dogfood workspace and seeded the Arcadia project.",
    result: DOGFOOD_LOG_RESULT,
    nextAction: DOGFOOD_NEXT_ACTION,
    artifactImpact: "Created .arcadia-workspace as the local dogfooding workspace.",
    markdownPath
  });
  writeMissionLogMarkdown(workspace, { missionLog, project, milestone });
  return missionLog;
}
