import type { ExecutionRun } from "../arcadia/types.js";
import { formatRunCompletedNotification, formatRunRequiresReviewNotification } from "../formatters/runFormatter.js";

export function runCompletedMessage(run: ExecutionRun): string {
  return formatRunCompletedNotification(run);
}

export function runRequiresReviewMessage(run: ExecutionRun): string {
  return formatRunRequiresReviewNotification(run);
}
