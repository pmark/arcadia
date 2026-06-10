import path from "node:path";
import { executionRunNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getExecutionRun } from "../db/repositories.js";
import type { ExecutionRunSummary } from "../domain/types.js";

export interface RunShowCommandData {
  run: ExecutionRunSummary;
  needsMark: string[];
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
