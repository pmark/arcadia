import path from "node:path";
import { executionRunNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getExecutionRun, listExecutionRuns } from "../db/repositories.js";
import type { ExecutionRunSummary } from "../domain/types.js";
import { validationError } from "../cli/errors.js";

export interface RunShowCommandData {
  run: ExecutionRunSummary;
  needsMark: string[];
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

  return createSuccess({
    command: "run.show",
    workspace: workspacePath,
    data: { run, needsMark: needsMarkItems(run) },
    artifacts: [
      ...(run.mission_log_path ? [path.join(workspacePath, run.mission_log_path)] : []),
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

  lines.push("Needs Mark:");
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
    .filter((step) => step.status === "needs_mark")
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
