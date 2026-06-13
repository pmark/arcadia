import type { ReviewDecisionData, ReviewItem } from "../arcadia/types.js";
import { estimatedReviewTimeFor } from "./decisionFormatter.js";

export function formatRequiresReview(items: ReviewItem[]): string {
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
    "Use `/arcadia review`."
  ].join("\n");
}

export function formatRequiresReviewShow(item: ReviewItem): string {
  return [
    `**${item.slug} - Requires Review**`,
    `ID: \`${item.id}\``,
    `Project: ${item.project ?? "Unassigned"}`,
    `Goal: ${item.goal ?? "None"}`,
    `Decision needed: ${item.decisionNeeded}`,
    `Recommendation: ${item.recommendation ?? "Clarify before execution."}`,
    `Source input: ${item.sourceInput}`,
    `Context: ${item.context}`,
    `Actions: ${item.options.join(", ")}`
  ].join("\n");
}

export function formatRequiresReviewDecision(data: ReviewDecisionData): string {
  const lines = [
    `**Requires Review ${data.result.status}**`,
    `Review: \`${data.item.slug}\``,
    `Result: ${data.result.summary}`
  ];

  if (data.item.resultingAskRequestId) {
    lines.push(`Resumed ask: \`${data.item.resultingAskRequestId}\``);
  }

  if (data.approval?.workItem) {
    lines.push(`Work item: \`${data.approval.workItem.id}\``);
  }

  return lines.join("\n");
}

function formatRequiresReviewItem(item: ReviewItem): string {
  return [
    `**${item.slug} - Requires Review**`,
    item.decisionNeeded,
    item.sourceInput ? `Original: ${item.sourceInput}` : null,
    item.recommendation ? `Recommendation: ${item.recommendation}` : null,
    ...labeledOptions(item.options),
    "",
    `Reply with ${validReplyText(item)}.`
  ].filter((line): line is string => line !== null).join("\n");
}

export function formatRequiresReviewNotificationItem(item: ReviewItem): string {
  return formatRequiresReviewItem(item);
}

export function formatInvalidReviewReply(item: ReviewItem): string {
  return `${item.slug}: reply with ${validReplyText(item)}.`;
}

function labeledOptions(options: string[]): string[] {
  return options.map((option, index) => `${String.fromCharCode("A".charCodeAt(0) + index)}) ${labelOption(option)}`);
}

function labelOption(option: string): string {
  if (option === "approve") {
    return "Approve";
  }
  if (option === "reject") {
    return "Reject";
  }
  if (option === "defer") {
    return "Defer";
  }
  return option;
}

function validReplyText(item: ReviewItem): string {
  const letters = item.options.map((_, index) => String.fromCharCode("A".charCodeAt(0) + index));
  const words = [
    item.options.includes("approve") ? "approve" : null,
    item.options.includes("reject") ? "reject" : null,
    item.options.includes("defer") ? "defer" : null
  ].filter((value): value is string => Boolean(value));
  return [...letters, ...words].join(", ");
}
