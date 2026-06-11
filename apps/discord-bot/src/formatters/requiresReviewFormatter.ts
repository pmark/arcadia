import type { WorkItem } from "../arcadia/types.js";
import { estimatedReviewTimeFor, recommendationFor } from "./decisionFormatter.js";

export function formatRequiresReview(items: WorkItem[]): string {
  if (items.length === 0) {
    return "**Arcadia Requires Review**\nNo items require review.";
  }

  const lines = [
    "**Arcadia Requires Review**",
    `${items.length} item${items.length === 1 ? "" : "s"} require review.`,
    `Estimated total review time: ${estimatedReviewTimeFor(items.length)}`,
    ""
  ];

  for (const item of items.slice(0, 5)) {
    lines.push(formatRequiresReviewItem(item));
    lines.push("");
  }

  if (items.length > 5) {
    lines.push(`+ ${items.length - 5} more. Use Arcadia for the full list.`);
  }

  return lines.join("\n").trim();
}

export function formatRequiresReviewNotification(count: number): string {
  return [
    "**Arcadia requires review**",
    `${count} item${count === 1 ? "" : "s"} require review.`,
    `Estimated total review time: ${estimatedReviewTimeFor(count)}`,
    "Use `/arcadia requires-review`."
  ].join("\n");
}

function formatRequiresReviewItem(item: WorkItem): string {
  return [
    `**${item.title}**`,
    `Project: ${item.project_name ?? "Unassigned"}`,
    "Why review is required: Arcadia paused this item for human judgment.",
    `Recommended: ${recommendationFor(item)}`,
    "Estimated review time: 1 minute"
  ].join("\n");
}
