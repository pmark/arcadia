import type { ReviewDecisionData, ReviewExecutionData, ReviewItem } from "../arcadia/types.js";
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

export function formatRequiresReviewExecutionDecision(data: ReviewDecisionData): string {
  if (data.result.status === "pending_execution" && data.run) {
    return [
      `**${data.item.slug} approved** — execution queued`,
      `Run: \`${data.run.id}\``,
      "I'll notify when the executor finishes."
    ].join("\n");
  }

  if (!data.execution) {
    return formatRequiresReviewDecision(data);
  }

  return formatExecutionResult(data.item.slug, data.execution);
}

function formatExecutionResult(reviewSlug: string, execution: ReviewExecutionData): string {
  const validationPassed = execution.validation.every((v) => v.exitStatus === 0);
  const validationLabel = execution.validation.length === 0
    ? "no validation"
    : validationPassed ? "validation ✓" : "validation ✗";

  const lines = [
    `**${reviewSlug} executed** with \`${execution.executor}\``,
    `Exit: ${execution.exitStatus ?? "unknown"}  |  Changed: ${execution.changedFiles.length} file${execution.changedFiles.length === 1 ? "" : "s"}  |  ${validationLabel}`
  ];

  if (execution.changedFiles.length > 0) {
    lines.push(execution.changedFiles.slice(0, 6).map((f) => `• ${f}`).join("\n"));
    if (execution.changedFiles.length > 6) {
      lines.push(`+ ${execution.changedFiles.length - 6} more`);
    }
  }

  if (execution.validation.some((v) => v.exitStatus !== 0)) {
    const failed = execution.validation.filter((v) => v.exitStatus !== 0);
    lines.push(`Failed: ${failed.map((v) => `\`${v.command}\``).join(", ")}`);
  }

  if (execution.finalOutput) {
    const excerpt = execution.finalOutput.trim().split("\n").slice(-3).join("\n");
    if (excerpt) {
      lines.push(`\`\`\`\n${excerpt.slice(0, 400)}\n\`\`\``);
    }
  }

  lines.push(`Follow-up: **${execution.followUpReviewSlug}** — \`/arcadia review-approve ${execution.followUpReviewSlug}\``);

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
