import { existsSync } from "node:fs";
import path from "node:path";
import { executionRunNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createReviewItem,
  findFollowUpReviewForRun,
  getExecutionRun,
  getReviewItem,
  listExecutionRuns,
  listReviewItems,
  updateWorkItem
} from "../db/repositories.js";
import { isRequiresReviewValue } from "../domain/constants.js";
import type { ExecutionRunSummary } from "../domain/types.js";
import { validationError } from "../cli/errors.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";
import { reviewPacketForReviewItem, type RequiresReviewPacket } from "./review.js";
import { parseDecisionContext } from "../execution/planningAuthorization.js";

export interface RunShowCommandData {
  run: ExecutionRunSummary;
  needsMark: string[];
  executorOutputPath: string | null;
  artifactRoot: string | null;
  followUpReview: RequiresReviewPacket | null;
}

export interface RunListCommandData {
  runs: ExecutionRunSummary[];
}

export interface RunRetryCommandData {
  run: ExecutionRunSummary;
  decision: RequiresReviewPacket;
}

export function runRunListCommand(options: {
  workspace: string;
  limit?: string | number;
}): CommandSuccess<RunListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const limit = parseLimit(options.limit);
  const runs = withDatabase(workspacePath, (db) => listExecutionRuns(db, limit));

  return createSuccess({
    command: "run.list",
    workspace: workspacePath,
    data: { runs }
  });
}

export function runRunShowCommand(options: {
  workspace: string;
  runId: string;
}): CommandSuccess<RunShowCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { run, followUpReview } = withDatabase(workspacePath, (db) => {
    const r = getExecutionRun(db, options.runId);
    if (!r) return { run: null, followUpReview: null };
    const raw = findFollowUpReviewForRun(db, options.runId);
    return { run: r, followUpReview: raw ? reviewPacketForReviewItem(raw) : null };
  });

  if (!run) {
    throw executionRunNotFound(options.runId);
  }

  const paths = getWorkspacePaths(workspacePath);
  const artifactRootAbs = run.review_item_id
    ? path.join(paths.artifacts, "review-executions", run.id)
    : null;
  const outputFileAbs = artifactRootAbs
    ? path.join(artifactRootAbs, "executor-output.txt")
    : null;

  const executorOutputPath = outputFileAbs && existsSync(outputFileAbs)
    ? toWorkspaceRelativePath(workspacePath, outputFileAbs)
    : null;
  const artifactRoot = artifactRootAbs && existsSync(artifactRootAbs)
    ? toWorkspaceRelativePath(workspacePath, artifactRootAbs)
    : null;

  return createSuccess({
    command: "run.show",
    workspace: workspacePath,
    data: { run, needsMark: needsMarkItems(run), executorOutputPath, artifactRoot, followUpReview },
    artifacts: [
      ...(run.mission_log_path ? [path.join(workspacePath, run.mission_log_path)] : []),
      ...(outputFileAbs && existsSync(outputFileAbs) ? [outputFileAbs] : []),
      ...run.artifacts.flatMap((artifact) => artifact.path ? [path.join(workspacePath, artifact.path)] : [])
    ]
  });
}

export function runRunRetryCommand(options: {
  workspace: string;
  runId: string;
}): CommandSuccess<RunRetryCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db) => {
    const run = getExecutionRun(db, options.runId);
    if (!run) {
      throw executionRunNotFound(options.runId);
    }
    if (run.status !== "failed" && !isRequiresReviewValue(run.status)) {
      throw validationError("Only failed or Requires Review managed planning Runs can request retry.", {
        runId: run.id,
        status: run.status
      });
    }
    const approval = run.review_item_id ? getReviewItem(db, run.review_item_id) : null;
    if (!approval || !["CodexPlanningRunApproval", "CodexPlanningRetryApproval"].includes(approval.resolved_intent)) {
      throw validationError("Run is not a recoverable managed planning Run.", { runId: run.id });
    }
    const existing = listReviewItems(db, "all").find((item) => {
      if (item.resolved_intent !== "CodexPlanningRetryApproval" || !["open", "deferred"].includes(item.status)) {
        return false;
      }
      return parseDecisionContext(item).priorRunId === run.id;
    });
    const decision = existing ?? createReviewItem(db, {
      workItemId: approval.work_item_id,
      planId: approval.plan_id,
      projectId: approval.project_id,
      artifactId: approval.artifact_id,
      codexInvocationId: approval.codex_invocation_id,
      decisionNeeded: `Approve a new immutable planning attempt after Run ${run.id}.`,
      recommendation: "Inspect the failed Run evidence before approving a retry.",
      sourceInput: approval.source_input,
      proposedAction: "Queue a new planning attempt using the unchanged approved packet.",
      resolvedIntent: "CodexPlanningRetryApproval",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: [],
      context: {
        ...parseDecisionContext(approval),
        schemaVersion: 1,
        priorRunId: run.id,
        failureEvidence: run.artifacts.map((artifact) => artifact.path ?? artifact.title),
        recommendedCorrection: run.summary
      }
    });
    if (run.work_item_id) {
      updateWorkItem(db, run.work_item_id, {
        queue: "needs_mark",
        workClassification: "needs_mark",
        status: "in_progress",
        nextAction: "Review and approve or reject the retry Decision."
      });
    }
    return { run, decision: reviewPacketForReviewItem(decision) };
  });
  return createSuccess({
    command: "run.retry",
    workspace: workspacePath,
    data
  });
}

export function renderRunRetrySuccess(response: CommandSuccess<RunRetryCommandData>): string[] {
  return [
    `Retry Decision: ${response.data.decision.slug}`,
    `Prior Run: ${response.data.run.id}`,
    "No executor was invoked."
  ];
}

export function renderRunListSuccess(response: CommandSuccess<RunListCommandData>): string[] {
  if (response.data.runs.length === 0) {
    return ["No runs yet."];
  }

  return response.data.runs.map((run) => `${run.id}: ${run.status} - ${run.work_item_title}`);
}

export function renderRunShowSuccess(response: CommandSuccess<RunShowCommandData>): string[] {
  const lines = [
    `Run: ${response.data.run.id}`,
    `Status: ${response.data.run.status}`,
    `Action: ${response.data.run.work_item_title}`,
    `Mission log: ${response.data.run.mission_log_path ?? "None"}`,
    "Steps:"
  ];

  for (const step of response.data.run.steps) {
    lines.push(`  ${step.status}: ${step.plan_step_title}`);
  }

  lines.push("Requires Review:");
  if (response.data.needsMark.length === 0) {
    lines.push("  None");
  } else {
    for (const item of response.data.needsMark) {
      lines.push(`  ${item}`);
    }
  }

  return lines;
}

function needsMarkItems(run: ExecutionRunSummary): string[] {
  return run.steps
    .filter((step) => isRequiresReviewValue(step.status))
    .map((step) => step.error ?? step.output ?? step.plan_step_title);
}

function parseLimit(raw: string | number | undefined): number {
  if (raw === undefined) {
    return 10;
  }

  const value = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw validationError("Limit must be an integer from 1 to 50.", { limit: raw });
  }

  return value;
}
