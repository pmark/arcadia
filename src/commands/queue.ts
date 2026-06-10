import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { listQueueGroups } from "../db/repositories.js";
import { QUEUE_LABELS, WORK_CLASSIFICATION_LABELS, type QueueName } from "../domain/constants.js";
import type { QueueGroups, WorkItemSummary } from "../domain/types.js";

const ORDERED_QUEUES: QueueName[] = ["inbox", "work_queue", "needs_mark", "blocked"];

export interface QueueCommandData {
  queues: QueueGroups;
}

export function runQueueCommand(options: { workspace: string }): CommandSuccess<QueueCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const groups = withDatabase(workspacePath, listQueueGroups);

  return createSuccess({
    command: "queue",
    workspace: workspacePath,
    data: { queues: groups }
  });
}

export function renderQueueSuccess(response: CommandSuccess<QueueCommandData>): string[] {
  const lines: string[] = [];
  for (const queue of ORDERED_QUEUES) {
    lines.push(`${QUEUE_LABELS[queue]}:`);
    lines.push(...renderItems(response.data.queues[queue]));
    lines.push("");
  }

  return lines;
}

function renderItems(items: WorkItemSummary[]): string[] {
  if (items.length === 0) {
    return ["  None"];
  }

  const lines: string[] = [];
  for (const item of items) {
    const project = item.project_name ? ` [${item.project_name}]` : "";
    lines.push(`  - ${item.title}${project}`);
    lines.push(`    Classification: ${WORK_CLASSIFICATION_LABELS[item.work_classification]}`);
    lines.push(`    Next action: ${item.next_action}`);
    lines.push(`    Status: ${item.status}`);
  }

  return lines;
}
