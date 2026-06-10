import { existsSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  attachMissionLogToExecutionRun,
  buildStatusReportData,
  buildWeeklyReviewData,
  createArtifactRecord,
  createExecutionRun,
  createMissionLog,
  getExecutionPlan,
  getMilestone,
  getProject,
  getWorkItem,
  updateWorkItem
} from "../db/repositories.js";
import type {
  Artifact,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  ExecutionRunStep,
  WorkItemSummary
} from "../domain/types.js";
import { writeMissionLogMarkdown, buildMissionLogRelativePath } from "../markdown/missionLog.js";
import { renderRunSummary, writePublicationPacket, writeSpecificationArtifact } from "../markdown/executionArtifacts.js";
import { writeStatusReport } from "../markdown/statusReport.js";
import { writeWeeklyReviewReport } from "../markdown/weeklyReview.js";
import { createId } from "../utils/id.js";
import { localDateStamp } from "../utils/time.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";

export interface ExecutionResult {
  run: ExecutionRunSummary;
  missionLogPath: string | null;
}

type RunStepInput = Parameters<typeof createExecutionRun>[1]["steps"][number];

export function executePlan(db: Database.Database, workspace: string, plan: ExecutionPlanSummary): ExecutionResult {
  const workItem = getWorkItem(db, plan.work_item_id);
  if (!workItem) {
    throw new Error(`Work item is required: ${plan.work_item_id}`);
  }

  const stepResults: RunStepInput[] = [];
  const artifacts: Artifact[] = [];
  let runStatus: "completed" | "needs_mark" | "failed" = "completed";

  for (const step of plan.steps) {
    if (step.executor_type !== "deterministic" || step.safe_to_run !== 1) {
      stepResults.push({
        planStepId: step.id,
        status: "needs_mark",
        command: step.command,
        output: step.needs_mark ?? "This step requires Mark or Codex.",
        error: step.needs_mark ?? "Execution paused for explicit input.",
        artifactPath: null
      });
      runStatus = "needs_mark";
      break;
    }

    try {
      const executed = executeDeterministicStep(db, workspace, workItem, step.skill_name);
      if (executed.artifact) {
        artifacts.push(executed.artifact);
      }
      stepResults.push({
        planStepId: step.id,
        status: "completed",
        command: step.command,
        output: executed.output,
        error: null,
        artifactPath: executed.artifact?.path ?? null
      });
    } catch (error) {
      stepResults.push({
        planStepId: step.id,
        status: "failed",
        command: step.command,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        artifactPath: null
      });
      runStatus = "failed";
      break;
    }
  }

  const run = createExecutionRun(db, {
    workItemId: workItem.id,
    planId: plan.id,
    status: runStatus,
    summary: summaryForRunStatus(runStatus, workItem),
    steps: stepResults,
    artifactIds: artifacts.map((artifact) => artifact.id)
  });

  if (!run) {
    throw new Error("Execution run could not be created.");
  }

  const missionLog = createRunMissionLog(db, workspace, workItem, run, runStatus, artifacts);
  const updatedRun = attachMissionLogToExecutionRun(db, run.id, missionLog.id);

  if (runStatus === "completed") {
    updateWorkItem(db, workItem.id, { status: "done" });
  } else if (runStatus === "needs_mark") {
    updateWorkItem(db, workItem.id, {
      queue: "needs_mark",
      workClassification: "needs_mark",
      nextAction: "Review the execution run and provide the required input."
    });
  } else {
    updateWorkItem(db, workItem.id, {
      queue: "blocked",
      workClassification: "blocked",
      status: "blocked",
      nextAction: "Review the failed execution run."
    });
  }

  return {
    run: updatedRun ?? run,
    missionLogPath: missionLog.markdown_path
  };
}

export function resolvePlanForRun(
  db: Database.Database,
  workItemId: string,
  planId: string | undefined
): ExecutionPlanSummary | null {
  if (planId) {
    const plan = getExecutionPlan(db, planId);
    return plan?.work_item_id === workItemId ? plan : null;
  }

  const row = db
    .prepare("SELECT id FROM execution_plans WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(workItemId) as { id: string } | undefined;

  return row ? getExecutionPlan(db, row.id) : null;
}

function executeDeterministicStep(
  db: Database.Database,
  workspace: string,
  workItem: WorkItemSummary,
  skillName: string
): { output: string; artifact: Artifact | null } {
  switch (skillName) {
    case "validate_workspace_repository":
      return { output: validateWorkspace(workspace), artifact: null };
    case "generate_status_report": {
      const reportPath = writeStatusReport(workspace, buildStatusReportData(db, workspace));
      return { output: `Status report written: ${reportPath}`, artifact: null };
    }
    case "generate_weekly_review": {
      const until = localDateStamp();
      const since = localDateStamp(addDays(new Date(), -6));
      const reportPath = writeWeeklyReviewReport(workspace, buildWeeklyReviewData(db, workspace, { since, until }));
      return { output: `Weekly review written: ${reportPath}`, artifact: null };
    }
    case "prepare_publication_packet": {
      const absolutePath = writePublicationPacket(workspace, workItem);
      const artifact = createArtifactRecord(db, {
        projectId: workItem.project_id,
        workItemId: workItem.id,
        title: `Publication packet: ${workItem.title}`,
        artifactType: "publication_packet",
        status: "drafted",
        path: toWorkspaceRelativePath(workspace, absolutePath)
      });
      return { output: `Publication packet written: ${absolutePath}`, artifact };
    }
    case "generate_specification_artifact": {
      const absolutePath = writeSpecificationArtifact(workspace, workItem);
      const artifact = createArtifactRecord(db, {
        projectId: workItem.project_id,
        workItemId: workItem.id,
        title: `Specification: ${workItem.title}`,
        artifactType: "specification",
        status: "drafted",
        path: toWorkspaceRelativePath(workspace, absolutePath)
      });
      return { output: `Specification written: ${absolutePath}`, artifact };
    }
    case "create_mission_log_from_run":
      return { output: "Mission log will be written from the final run outcome.", artifact: null };
    default:
      throw new Error(`Unsupported deterministic skill: ${skillName}`);
  }
}

function createRunMissionLog(
  db: Database.Database,
  workspace: string,
  workItem: WorkItemSummary,
  run: ExecutionRunSummary,
  runStatus: "completed" | "needs_mark" | "failed",
  artifacts: Artifact[]
) {
  const project = workItem.project_id ? getProject(db, workItem.project_id) : null;
  const milestone = workItem.milestone_id ? getMilestone(db, workItem.milestone_id) : null;
  const logId = createId("missionLog");
  const markdownPath = buildMissionLogRelativePath(workspace, project?.name ?? "execution", logId);
  const missionLog = createMissionLog(db, {
    id: logId,
    projectId: workItem.project_id,
    milestoneId: workItem.milestone_id,
    workPerformed: renderRunSummary(run),
    result: summaryForRunStatus(runStatus, workItem),
    blockers: runStatus === "completed" ? "" : "Execution requires review before it can continue.",
    nextAction: nextActionForRunStatus(runStatus),
    artifactImpact: artifacts.length > 0
      ? artifacts.map((artifact) => artifact.path ?? artifact.title).join(", ")
      : "Execution run recorded.",
    markdownPath
  });
  writeMissionLogMarkdown(workspace, { missionLog, project, milestone });
  return missionLog;
}

function validateWorkspace(workspace: string): string {
  const paths = getWorkspacePaths(workspace);
  const requiredPaths = [paths.configFile, paths.databaseFile, paths.projects, paths.artifacts, paths.missionLogs];
  const missing = requiredPaths.filter((requiredPath) => !existsSync(requiredPath));

  if (missing.length > 0) {
    throw new Error(`Workspace validation failed. Missing: ${missing.join(", ")}`);
  }

  return "Workspace validation passed.";
}

function summaryForRunStatus(status: "completed" | "needs_mark" | "failed", workItem: WorkItemSummary): string {
  if (status === "completed") {
    return `Completed deterministic execution for "${workItem.title}".`;
  }

  if (status === "needs_mark") {
    return `Paused execution for "${workItem.title}" because Mark input is required.`;
  }

  return `Execution failed for "${workItem.title}".`;
}

function nextActionForRunStatus(status: "completed" | "needs_mark" | "failed"): string {
  if (status === "completed") {
    return "Review the generated run record and artifacts.";
  }

  if (status === "needs_mark") {
    return "Mark must review the run and provide the required input.";
  }

  return "Inspect the failed run record and decide whether to retry or revise the work item.";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
