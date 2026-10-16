import type Database from "better-sqlite3";
import { attachMissionLogToExecutionRun, createMissionLog, getExecutionRun, getMilestone, getProject, getWorkItem, updateExecutionRunStatus, updateWorkItem } from "../db/repositories.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";
import { renderRunSummary } from "../markdown/executionArtifacts.js";
import { createId } from "../utils/id.js";

export function reduceExecutionOutcome(input: {
  exitStatus: number | null;
  validation: Array<{ exitStatus: number | null }>;
}): "completed" | "requires_review" | "failed" {
  if (input.exitStatus !== 0) {
    return "failed";
  }
  if (input.validation.some((validation) => validation.exitStatus !== 0)) {
    return "requires_review";
  }
  return "completed";
}

export function finalizeGenericRun(
  db: Database.Database,
  workspace: string,
  runId: string,
  status: "completed" | "requires_review" | "failed",
  summary: string,
  artifactImpact: string
): void {
  const run = getExecutionRun(db, runId);
  if (!run) {
    return;
  }
  const workItem = run.work_item_id ? getWorkItem(db, run.work_item_id) : null;
  const project = workItem?.project_id ? getProject(db, workItem.project_id) : null;
  const milestone = workItem?.milestone_id ? getMilestone(db, workItem.milestone_id) : null;
  const logId = createId("missionLog");
  const markdownPath = buildMissionLogRelativePath(workspace, project?.name ?? "execution", logId);
  const missionLog = createMissionLog(db, {
    id: logId,
    projectId: workItem?.project_id,
    milestoneId: workItem?.milestone_id,
    workPerformed: renderRunSummary(run),
    result: summary,
    blockers: status === "completed" ? "" : summary,
    nextAction: status === "completed"
      ? "Review the execution evidence and follow-up Decision."
      : status === "requires_review"
        ? "Review failed Validation and decide how to revise."
        : "Inspect diagnostics and request a new attempt.",
    artifactImpact,
    markdownPath
  });
  writeMissionLogMarkdown(workspace, { missionLog, project, milestone });
  attachMissionLogToExecutionRun(db, runId, missionLog.id);
  updateExecutionRunStatus(db, runId, status, { pid: null, summary });
  if (workItem) {
    updateWorkItem(db, workItem.id, status === "failed"
      ? { queue: "blocked", workClassification: "blocked", status: "blocked", nextAction: "Inspect the failed Run and request retry." }
      : status === "requires_review"
        ? { queue: "requires_review", workClassification: "requires_review", status: "in_progress", nextAction: "Review failed Validation." }
        : { queue: "requires_review", workClassification: "requires_review", status: "in_progress", nextAction: "Review the executor result." });
  }
}

export function finalizeWorkerFailure(
  db: Database.Database,
  workspace: string,
  runId: string,
  message: string
): void {
  finalizeGenericRun(db, workspace, runId, "failed", `Execution failed: ${message}`, "Diagnostic evidence retained.");
}

