import type { ExecutionRun } from "../arcadia/types.js";
import { formatRunFailedNotification } from "../formatters/runFormatter.js";

export function runFailedMessage(run: ExecutionRun): string {
  return formatRunFailedNotification(run);
}
