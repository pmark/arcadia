import type { ExecutionRun } from "../arcadia/types.js";
import { estimatedReviewTimeFor } from "./decisionFormatter.js";

export function formatRuns(runs: ExecutionRun[]): string {
  if (runs.length === 0) {
    return "**Arcadia runs**\nNo execution runs yet.";
  }

  return [
    "**Arcadia runs**",
    ...runs.slice(0, 5).map((run) =>
      `\`${run.id}\` ${labelStatus(run.status)} - ${run.work_item_title}`
    )
  ].join("\n");
}

export function formatRunRequiresReviewNotification(run: ExecutionRun): string {
  const reviewCount = run.steps.filter((step) => step.status === "needs_mark").length || 1;

  return [
    "**Arcadia progress update**",
    `Work: ${run.work_item_title}`,
    `Artifacts Generated: ${run.artifacts.length}`,
    `Requires Review: ${reviewCount}`,
    `Estimated Review Time: ${estimatedReviewTimeFor(reviewCount)}`,
    "Review in Arcadia."
  ].join("\n");
}

export function formatRunFailedNotification(run: ExecutionRun): string {
  const failedStep = run.steps.find((step) => step.status === "failed");

  return [
    "**Arcadia run failed**",
    `Work: ${run.work_item_title}`,
    `Failed Step: ${failedStep?.plan_step_title ?? "Unknown"}`,
    "See run details in Arcadia."
  ].join("\n");
}

function labelStatus(status: string): string {
  return status === "needs_mark" ? "Requires Review" : status.replaceAll("_", " ");
}
