import { existsSync } from "node:fs";
import path from "node:path";
import { executionRunNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getExecutionRun, listExecutionRuns } from "../db/repositories.js";
import { isRequiresReviewValue } from "../domain/constants.js";
import type { ExecutionRunSummary } from "../domain/types.js";
import { validationError } from "../cli/errors.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";

export interface RunShowCommandData {
  run: ExecutionRunSummary;
  needsMark: string[];
  executorOutputPath: string | null;
  artifactRoot: string | null;
}

export interface RunListCommandData {
  runs: ExecutionRunSummary[];
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
  const run = withDatabase(workspacePath, (db) => getExecutionRun(db, options.runId));

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
    data: { run, needsMark: needsMarkItems(run), executorOutputPath, artifactRoot },
    artifacts: [
      ...(run.mission_log_path ? [path.join(workspacePath, run.mission_log_path)] : []),
      ...(outputFileAbs && existsSync(outputFileAbs) ? [outputFileAbs] : []),
      ...run.artifacts.flatMap((artifact) => artifact.path ? [path.join(workspacePath, artifact.path)] : [])
    ]
  });
}

export function renderRunListSuccess(response: CommandSuccess<RunListCommandData>): string[] {
  if (response.data.runs.length === 0) {
    return ["No execution runs yet."];
  }

  return response.data.runs.map((run) => `${run.id}: ${run.status} - ${run.work_item_title}`);
}

export function renderRunShowSuccess(response: CommandSuccess<RunShowCommandData>): string[] {
  const lines = [
    `Run: ${response.data.run.id}`,
    `Status: ${response.data.run.status}`,
    `Work item: ${response.data.run.work_item_title}`,
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
