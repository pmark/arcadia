import { withDatabase } from "../db/connection.js";
import { listQueueGroups } from "../db/repositories.js";
import { QUEUE_LABELS, WORK_CLASSIFICATION_LABELS, type QueueName } from "../domain/constants.js";
import type { WorkItemSummary } from "../domain/types.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

const ORDERED_QUEUES: QueueName[] = ["inbox", "work_queue", "needs_mark", "blocked"];

export function runQueueCommand(options: { workspace: string }): void {
  const workspacePath = resolveWorkspacePath(options.workspace);
  const groups = withDatabase(workspacePath, listQueueGroups);

  for (const queue of ORDERED_QUEUES) {
    console.log(`${QUEUE_LABELS[queue]}:`);
    printItems(groups[queue]);
    console.log("");
  }
}

function printItems(items: WorkItemSummary[]): void {
  if (items.length === 0) {
    console.log("  None");
    return;
  }

  for (const item of items) {
    const project = item.project_name ? ` [${item.project_name}]` : "";
    console.log(`  - ${item.title}${project}`);
    console.log(`    Classification: ${WORK_CLASSIFICATION_LABELS[item.work_classification]}`);
    console.log(`    Next action: ${item.next_action}`);
    console.log(`    Status: ${item.status}`);
  }
}
