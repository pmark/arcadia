import type { ExecutionRun, RunShowData } from "../arcadia/types.js";
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
  const reviewCount = run.steps.filter((step) => isRequiresReviewStatus(step.status)).length || 1;

  return [
    "**Arcadia progress update**",
    `Work: ${run.work_item_title}`,
    `Artifacts Generated: ${run.artifacts.length}`,
    `Requires Review: ${reviewCount}`,
    `Estimated Review Time: ${estimatedReviewTimeFor(reviewCount)}`,
    "Review in Arcadia."
  ].join("\n");
}

export function formatRunCompletedNotification(run: ExecutionRun): string {
  return [
    "**Arcadia run completed**",
    `Run: \`${run.id}\``,
    `Work: ${run.work_item_title}`,
    `Mission log: ${run.mission_log_path ?? "None"}`,
    `Artifacts: ${formatArtifacts(run)}`,
    `Run detail: /arcadia run id:${run.id}`
  ].join("\n");
}

export function formatRunDetail(data: RunShowData): string {
  const run = data.run;
  const blockingStep = run.steps.find((step) => step.status === "failed" || isRequiresReviewStatus(step.status));
  const reviewCount = data.needsMark.length;
  const lines = [
    "**Arcadia run detail**",
    `Run: \`${run.id}\``,
    `Status: ${labelStatus(run.status)}`,
    `Work: ${run.work_item_title}`,
    `Plan: ${run.plan_summary}`,
    `Mission log: ${run.mission_log_path ?? "None"}`,
    `Artifacts: ${formatArtifacts(run)}`,
    `Requires Review: ${reviewCount}`,
    `Blocking step: ${blockingStep?.plan_step_title ?? "None"}`
  ];

  if (blockingStep?.error || blockingStep?.output) {
    lines.push(`Reason: ${blockingStep.error ?? blockingStep.output}`);
  }

  if (data.needsMark.length > 0) {
    lines.push(`Review items: ${data.needsMark.join(" | ")}`);
  }

  lines.push("Final reporting depends on completed validation artifacts.");
  return lines.join("\n");
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
  return isRequiresReviewStatus(status) ? "Requires Review" : status.replaceAll("_", " ");
}

function isRequiresReviewStatus(value: string | null | undefined): boolean {
  return value === "requires_review" || value === "needs_mark";
}

function formatArtifacts(run: ExecutionRun): string {
  if (run.artifacts.length === 0) {
    return "0";
  }

  return run.artifacts
    .slice(0, 3)
    .map((artifact) => `${artifact.title}${artifact.path ? ` (${artifact.path})` : ""}`)
    .join("; ");
}
