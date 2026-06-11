import type { Milestone } from "../arcadia/types.js";

export function formatMilestoneCompletedNotification(milestone: Milestone): string {
  return [
    "**Arcadia milestone completed**",
    `Project: ${milestone.project_name}`,
    `Milestone: ${milestone.title}`,
    "Artifacts Generated: unavailable"
  ].join("\n");
}
