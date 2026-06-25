import path from "node:path";
import type Database from "better-sqlite3";
import {
  createMissionLog,
  createMilestoneForProject,
  createWorkItemWithOptionalArtifact,
  getActiveMilestoneForProject,
  listRecentMissionLogs,
  listWorkItems,
  updateMilestoneStatus,
  updateWorkItem,
  upsertProject
} from "../db/repositories.js";
import type { Milestone, MissionLog, Project, WorkItem } from "../domain/types.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";

export const ARCADIA_PROJECT_NAME = "Arcadia";
export const ARCADIA_PROJECT_MISSION =
  "Build Arcadia into a local-first mission control system for sustaining progress across a portfolio of creative and software projects.";
export const ARCADIA_PROJECT_GOAL =
  "Manage Arcadia development through the same workspace model used for every other project.";
export const ARCADIA_PROJECT_MILESTONE = "Unify Arcadia onto the single workspace model.";
export const ARCADIA_PROJECT_NEXT_ACTION = "Use Arcadia ask to create and run Arcadia development Actions.";

const ARCADIA_WORKSPACE_LOG_RESULT = "Arcadia is managed as a project in this workspace.";
const LEGACY_DOGFOOD_LOG_RESULT = "Arcadia is now being dogfooded through its repo-local workspace.";

export interface ArcadiaProjectSeedResult {
  project: Project;
  milestone: Milestone;
  workItem: WorkItem;
  missionLog: MissionLog;
}

export function seedArcadiaProject(db: Database.Database, workspace: string): ArcadiaProjectSeedResult {
  const project = upsertProject(db, {
    name: ARCADIA_PROJECT_NAME,
    mission: ARCADIA_PROJECT_MISSION,
    goal: ARCADIA_PROJECT_GOAL,
    status: "active",
    currentMilestone: ARCADIA_PROJECT_MILESTONE,
    nextAction: ARCADIA_PROJECT_NEXT_ACTION,
    workClassification: "codex"
  });
  const milestone = ensureArcadiaMilestone(db, project.id);
  const workItem = ensureArcadiaWorkItem(db, project.id, milestone.id);
  const missionLog = ensureArcadiaMissionLog(db, workspace, project, milestone);

  return { project, milestone, workItem, missionLog };
}

function ensureArcadiaMilestone(db: Database.Database, projectId: string): Milestone {
  const active = getActiveMilestoneForProject(db, projectId);
  if (active?.title === ARCADIA_PROJECT_MILESTONE) {
    return active;
  }

  if (active) {
    updateMilestoneStatus(db, active.id, "paused");
  }

  const created = createMilestoneForProject(db, projectId, ARCADIA_PROJECT_MILESTONE, "active");
  if (!created) {
    throw new Error("Could not create Arcadia milestone.");
  }

  return created;
}

function ensureArcadiaWorkItem(db: Database.Database, projectId: string, milestoneId: string): WorkItem {
  const existing = listWorkItems(db).find(
    (item) =>
      item.project_id === projectId &&
      item.milestone_id === milestoneId &&
      item.raw_input === ARCADIA_PROJECT_NEXT_ACTION &&
      item.status !== "done"
  );
  if (existing) {
    const updated = updateWorkItem(db, existing.id, {
      queue: "work_queue",
      workClassification: "codex",
      nextAction: ARCADIA_PROJECT_NEXT_ACTION,
      status: "open"
    });
    if (!updated) {
      throw new Error("Could not update Arcadia Action.");
    }
    return updated;
  }

  return createWorkItemWithOptionalArtifact(db, {
    projectId,
    milestoneId,
    title: ARCADIA_PROJECT_NEXT_ACTION,
    rawInput: ARCADIA_PROJECT_NEXT_ACTION,
    queue: "work_queue",
    workClassification: "codex",
    nextAction: ARCADIA_PROJECT_NEXT_ACTION
  }).workItem;
}

function ensureArcadiaMissionLog(
  db: Database.Database,
  workspace: string,
  project: Project,
  milestone: Milestone
): MissionLog {
  const existing = listRecentMissionLogs(db, 100).find(
    (log) =>
      log.project_id === project.id &&
      (log.result === ARCADIA_WORKSPACE_LOG_RESULT || log.result === LEGACY_DOGFOOD_LOG_RESULT)
  );
  if (existing) {
    return existing;
  }

  const logId = "log_arcadia_workspace_init";
  const markdownPath = buildMissionLogRelativePath(workspace, project.name, logId);
  const missionLog = createMissionLog(db, {
    id: logId,
    projectId: project.id,
    milestoneId: milestone.id,
    workPerformed: "Seeded Arcadia as a normal project in an Arcadia workspace.",
    result: ARCADIA_WORKSPACE_LOG_RESULT,
    nextAction: ARCADIA_PROJECT_NEXT_ACTION,
    artifactImpact: `Initialized the Arcadia project in ${path.basename(workspace)}.`,
    markdownPath
  });
  writeMissionLogMarkdown(workspace, { missionLog, project, milestone });
  return missionLog;
}
