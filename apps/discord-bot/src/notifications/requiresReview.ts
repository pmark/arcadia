import { formatRequiresReviewNotification } from "../formatters/requiresReviewFormatter.js";

export function requiresReviewTransitionMessage(count: number): string {
  return formatRequiresReviewNotification(count);
}
