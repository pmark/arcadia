import type { WorkItem } from "../arcadia/types.js";

export function recommendationFor(item: WorkItem): string {
  return item.next_action?.trim() || "Review in Arcadia.";
}

export function estimatedReviewTimeFor(itemCount: number): string {
  if (itemCount <= 0) {
    return "0 minutes";
  }

  return `${Math.max(1, itemCount)} minute${itemCount === 1 ? "" : "s"}`;
}
