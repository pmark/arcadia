import path from "node:path";
import type Database from "better-sqlite3";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { observeCodexTasks } from "../codex/observer.js";
import type { CodexTaskSummary, ObservedCodexTaskInput } from "../domain/types.js";
import { withDatabase } from "../db/connection.js";
import {
  associateCodexTask,
  attachMissionLogToCodexTask,
  createMissionLog,
  getCodexTask,
  getCodexTaskBySource,
  listCodexTasks,
  upsertObservedCodexTask
} from "../db/repositories.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";
import { createId } from "../utils/id.js";

export interface CodexListData {
  tasks: CodexTaskSummary[];
  observedCount: number;
  missionLogPaths: string[];
}

export interface CodexAssociateData {
  task: CodexTaskSummary;
}

export function runCodexSyncCommand(options: {
  workspace: string;
  source?: string;
  activeOnly?: boolean;
}): CommandSuccess<CodexListData> {
  const data = syncCodexTasks(options);
  return createSuccess({ command: "codex.sync", workspace: options.workspace, data, artifacts: data.missionLogPaths });
}

export function runCodexListCommand(options: {
  workspace: string;
  source?: string;
  activeOnly?: boolean;
  sync?: boolean;
}): CommandSuccess<CodexListData> {
  const data = options.sync === false
    ? withDatabase(options.workspace, (db) => ({
        tasks: listCodexTasks(db, { activeOnly: options.activeOnly }),
        observedCount: 0,
        missionLogPaths: []
      }))
    : syncCodexTasks(options);
  return createSuccess({ command: "codex.list", workspace: options.workspace, data, artifacts: data.missionLogPaths });
}

export function runCodexAssociateCommand(options: {
  workspace: string;
  taskId: string;
  projectId: string;
  milestoneId?: string | null;
}): CommandSuccess<CodexAssociateData> {
  const task = withDatabase(options.workspace, (db) => {
    const existing = resolveCodexTask(db, options.taskId);
    if (!existing) {
      throw new Error(`Codex task not found: ${options.taskId}`);
    }
    const associated = associateCodexTask(db, {
      taskId: existing.id,
      projectId: options.projectId,
      milestoneId: options.milestoneId
    });
    if (!associated) {
      throw new Error("Could not associate Codex task with project or milestone.");
    }
    return associated;
  });

  return createSuccess({ command: "codex.associate", workspace: options.workspace, data: { task } });
}

export function renderCodexListSuccess(response: CommandSuccess<CodexListData>): string[] {
  const data = response.data;
  const lines = [
    "Codex Companion",
    `Observed tasks: ${data.observedCount}`,
    `Visible tasks: ${data.tasks.length}`
  ];

  if (data.tasks.length === 0) {
    lines.push("No Codex tasks observed.");
    return lines;
  }

  for (const task of data.tasks) {
    lines.push(
      `- ${task.title} [${task.status}]`,
      `  Task: ${task.id} (${task.source}:${task.source_task_id})`,
      `  Project: ${task.project_name ?? "Unassociated"}`,
      `  Mission log: ${task.mission_log_path ?? "None"}`
    );
  }

  return lines;
}

export function renderCodexAssociateSuccess(response: CommandSuccess<CodexAssociateData>): string[] {
  const data = response.data;
  return [
    "Codex task associated",
    `Task: ${data.task.id}`,
    `Project: ${data.task.project_name ?? data.task.project_id ?? "Unassociated"}`,
    `Milestone: ${data.task.milestone_title ?? "None"}`
  ];
}

function syncCodexTasks(options: {
  workspace: string;
  source?: string;
  activeOnly?: boolean;
}): CodexListData {
  const observations = filterObservations(observeCodexTasks({
    includeCloud: options.source !== "local-goals",
    includeLocalGoals: options.source !== "cloud"
  }), options.source);

  return withDatabase(options.workspace, (db) => {
    const missionLogPaths: string[] = [];
    for (const observation of observations) {
      const synced = upsertObservedCodexTask(db, observation);
      if (shouldCreateCompletionMissionLog(synced.previousStatus, synced.task)) {
        const missionLogPath = createCodexTaskMissionLog(options.workspace, db, synced.task);
        if (missionLogPath) {
          missionLogPaths.push(missionLogPath);
        }
      }
    }

    return {
      tasks: listCodexTasks(db, { activeOnly: options.activeOnly }),
      observedCount: observations.length,
      missionLogPaths
    };
  });
}

function filterObservations(observations: ObservedCodexTaskInput[], source?: string): ObservedCodexTaskInput[] {
  if (!source || source === "all") {
    return observations;
  }
  if (source === "local-goals") {
    return observations.filter((task) => task.source === "local_goal");
  }
  if (source === "cloud") {
    return observations.filter((task) => task.source === "cloud_task");
  }
  throw new Error("Codex source must be one of: all, local-goals, cloud");
}

function resolveCodexTask(db: Database.Database, taskId: string): CodexTaskSummary | null {
  return getCodexTask(db, taskId) ?? getCodexTaskBySource(db, "local_goal", taskId) ?? getCodexTaskBySource(db, "cloud_task", taskId);
}

function shouldCreateCompletionMissionLog(previousStatus: string | null, task: CodexTaskSummary): boolean {
  return Boolean(
    task.project_id &&
    !task.mission_log_id &&
    previousStatus !== null &&
    !isSuccessfulStatus(previousStatus) &&
    isSuccessfulStatus(task.status)
  );
}

function createCodexTaskMissionLog(workspace: string, db: Database.Database, task: CodexTaskSummary): string | null {
  if (!task.project_id || task.mission_log_id) {
    return null;
  }

  const logId = createId("missionLog");
  const markdownPath = buildMissionLogRelativePath(workspace, task.project_name ?? "Codex", logId);
  const missionLog = createMissionLog(db, {
    id: logId,
    projectId: task.project_id,
    milestoneId: task.milestone_id,
    workPerformed: `Observed Codex task completion: ${task.title}`,
    result: task.summary ?? `Codex task ${task.source_task_id} completed with status ${task.status}.`,
    blockers: "",
    nextAction: "Review the completed Codex work and decide the next Arcadia action.",
    artifactImpact: task.url ? `Codex task URL: ${task.url}` : `Codex source: ${task.source}:${task.source_task_id}`,
    markdownPath
  });
  writeMissionLogMarkdown(workspace, {
    missionLog,
    project: {
      id: task.project_id,
      name: task.project_name ?? "Codex",
      slug: task.project_name?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "codex",
      mission: "",
      goal: null,
      status: "active",
      created_at: task.created_at,
      updated_at: task.updated_at
    },
    milestone: task.milestone_id && task.milestone_title
      ? {
          id: task.milestone_id,
          project_id: task.project_id,
          title: task.milestone_title,
          status: "active",
          created_at: task.created_at,
          updated_at: task.updated_at
        }
      : null
  });
  attachMissionLogToCodexTask(db, task.id, missionLog.id);
  return path.join(workspace, markdownPath);
}

function isSuccessfulStatus(status: string): boolean {
  return ["complete", "completed", "succeeded", "success"].includes(status.toLowerCase());
}
