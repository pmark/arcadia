import type { ExecutionRun } from "../arcadia/types.js";
import { formatRunRequiresReviewNotification } from "../formatters/runFormatter.js";

export function runRequiresReviewMessage(run: ExecutionRun): string {
  return formatRunRequiresReviewNotification(run);
}
