import type { DashboardAttentionItem, DashboardReviewItem } from "./types";

export function decisionLabelForAttention(
  item: DashboardAttentionItem,
  reviewById: Map<string, DashboardReviewItem>
): string | null {
  const review = item.relatedReviewId ? reviewById.get(item.relatedReviewId) : null;
  const number = review?.displayId || item.relatedDecisionSlug;
  return number ? `Decision ${number}` : null;
}

export function reviewSearchText(
  item: DashboardAttentionItem,
  reviewById: Map<string, DashboardReviewItem>
): string {
  const review = item.relatedReviewId ? reviewById.get(item.relatedReviewId) : null;
  return [
    decisionLabelForAttention(item, reviewById),
    item.reason,
    item.projectName,
    item.actionTitle,
    item.workItemTitle,
    item.relatedDecisionSlug,
    review?.displayId,
    review?.slug,
    review?.decisionNeeded,
    review?.recommendation,
    review?.sourceInput
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}
