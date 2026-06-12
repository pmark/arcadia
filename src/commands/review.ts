import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  buildStatusReportData,
  buildWeeklyReviewData,
  getReviewItem,
  listReviewItems,
  updateReviewItemStatus
} from "../db/repositories.js";
import type { ReviewItemSummary } from "../domain/types.js";
import { writeWeeklyReviewReport } from "../markdown/weeklyReview.js";
import { localDateStamp } from "../utils/time.js";
import { runAskCommand, type AskCommandData } from "./ask.js";

export interface RequiresReviewPacket {
  id: string;
  workItemId: string | null;
  project: string | null;
  goal: string | null;
  decisionNeeded: string;
  context: string;
  recommendation: string | null;
  options: string[];
  sourceInput: string;
  resultingAskRequestId: string | null;
}

export interface ReviewRequiredCommandOptions {
  workspace: string;
}

export interface ReviewRequiredCommandData {
  count: number;
  items: RequiresReviewPacket[];
}

export interface ReviewShowCommandOptions {
  workspace: string;
  id: string;
}

export interface ReviewShowCommandData {
  item: RequiresReviewPacket;
}

export interface ReviewDecisionCommandOptions {
  workspace: string;
  id: string;
}

export interface ReviewDecisionCommandData {
  item: RequiresReviewPacket;
  result: {
    status: "approved" | "rejected" | "deferred";
    summary: string;
  };
  approval: AskCommandData | null;
}

export interface ReviewWeeklyCommandOptions {
  workspace: string;
  since?: string;
  until?: string;
}

export interface ReviewWeeklyCommandData {
  reportPath: string;
  window: {
    since: string;
    until: string;
  };
  counts: {
    completedWork: number;
    missionLogs: number;
    blockedWork: number;
    requiresReview: number;
    codexWork: number;
    autonomousWork: number;
    artifacts: number;
    projectsWithoutOpenNextActions: number;
    suggestedNextActions: number;
  };
}

export function runReviewRequiredCommand(
  options: ReviewRequiredCommandOptions
): CommandSuccess<ReviewRequiredCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const items = withDatabase(workspacePath, (db) => {
    return [
      ...listReviewItems(db, "open"),
      ...listReviewItems(db, "deferred")
    ].map(reviewPacketForReviewItem);
  });

  return createSuccess({
    command: "review",
    workspace: workspacePath,
    data: {
      count: items.length,
      items
    }
  });
}

export function runReviewShowCommand(
  options: ReviewShowCommandOptions
): CommandSuccess<ReviewShowCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const item = withDatabase(workspacePath, (db) => {
    const reviewItem = getReviewItem(db, options.id);
    if (reviewItem) {
      return reviewPacketForReviewItem(reviewItem);
    }
    throw validationError("Requires Review item was not found.", { id: options.id });
  });

  return createSuccess({
    command: "review.show",
    workspace: workspacePath,
    data: { item }
  });
}

export function runReviewApproveCommand(
  options: ReviewDecisionCommandOptions
): CommandSuccess<ReviewDecisionCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const reviewItem = withDatabase(workspacePath, (db) => {
    const item = getReviewItem(db, options.id);
    if (!item) {
      throw validationError("Requires Review item was not found.", { id: options.id });
    }
    if (item.status !== "open" && item.status !== "deferred") {
      throw validationError("Requires Review item is already decided.", { id: item.id, status: item.status });
    }
    return item;
  });

  const approval = runAskCommand({
    workspace: workspacePath,
    request: reviewItem.source_input,
    approvedReviewItemId: reviewItem.id
  });

  const updated = withDatabase(workspacePath, (db) => {
    const item = updateReviewItemStatus(db, reviewItem.id, {
      status: "approved",
      decisionNote: "Approved from Requires Review.",
      resultingAskRequestId: approval.data.ask.id
    });
    if (!item) {
      throw validationError("Requires Review item was not found.", { id: reviewItem.id });
    }
    return item;
  });

  return createSuccess({
    command: "review.approve",
    workspace: workspacePath,
    data: {
      item: reviewPacketForReviewItem(updated),
      result: {
        status: "approved",
        summary: approval.data.result.summary
      },
      approval: approval.data
    },
    artifacts: approval.artifacts
  });
}

export function runReviewRejectCommand(
  options: ReviewDecisionCommandOptions
): CommandSuccess<ReviewDecisionCommandData> {
  return runReviewDecisionCommand(options, "rejected", "Rejected without executing the proposed action.");
}

export function runReviewDeferCommand(
  options: ReviewDecisionCommandOptions
): CommandSuccess<ReviewDecisionCommandData> {
  return runReviewDecisionCommand(options, "deferred", "Deferred for future review.");
}

export function runReviewWeeklyCommand(
  options: ReviewWeeklyCommandOptions
): CommandSuccess<ReviewWeeklyCommandData> {
  const window = resolveReviewWindow(options);
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { data, reportPath } = withDatabase(workspacePath, (db) => {
    const reviewData = buildWeeklyReviewData(db, workspacePath, window);
    return {
      data: reviewData,
      reportPath: writeWeeklyReviewReport(workspacePath, reviewData)
    };
  });

  return createSuccess({
    command: "review.weekly",
    workspace: workspacePath,
    data: {
      reportPath,
      window,
      counts: {
        completedWork: data.completedWorkItems.length,
        missionLogs: data.missionLogs.length,
        blockedWork: data.blockedItems.length,
        requiresReview: data.needsMarkItems.length,
        codexWork: data.codexItems.length,
        autonomousWork: data.autonomousItems.length,
        artifacts: data.artifactItems.length,
        projectsWithoutOpenNextActions: data.projectsWithoutOpenNextActions.length,
        suggestedNextActions: data.suggestedNextActions.length
      }
    },
    artifacts: [reportPath]
  });
}

export function renderReviewWeeklySuccess(response: CommandSuccess<ReviewWeeklyCommandData>): string[] {
  return [
    "Weekly review written.",
    `Window: ${response.data.window.since} to ${response.data.window.until}`,
    `Report: ${response.data.reportPath}`
  ];
}

export function renderReviewRequiredSuccess(response: CommandSuccess<ReviewRequiredCommandData>): string[] {
  const lines = ["Arcadia Requires Review", `Items: ${response.data.count}`];
  if (response.data.items.length === 0) {
    lines.push("None");
    return lines;
  }

  for (const item of response.data.items) {
    lines.push("");
    lines.push(`- ${item.id}: ${item.context}`);
    lines.push(`  Project: ${item.project ?? "None"}`);
    lines.push(`  Goal: ${item.goal ?? "None"}`);
    lines.push(`  Decision needed: ${item.decisionNeeded}`);
    lines.push(`  Recommendation: ${item.recommendation ?? "Clarify the request before execution."}`);
    lines.push(`  Options: ${item.options.join("; ")}`);
    lines.push(`  Source input: ${item.sourceInput}`);
  }

  return lines;
}

export function renderReviewShowSuccess(response: CommandSuccess<ReviewShowCommandData>): string[] {
  const item = response.data.item;
  return [
    "Arcadia Requires Review",
    `ID: ${item.id}`,
    `Project: ${item.project ?? "None"}`,
    `Project goal: ${item.goal ?? "None"}`,
    `Decision needed: ${item.decisionNeeded}`,
    `Recommendation: ${item.recommendation ?? "Clarify the request before execution."}`,
    `Source input: ${item.sourceInput}`,
    `Context: ${item.context}`,
    `Options: ${item.options.join("; ")}`
  ];
}

export function renderReviewDecisionSuccess(response: CommandSuccess<ReviewDecisionCommandData>): string[] {
  const lines = [
    `Requires Review ${response.data.result.status}.`,
    `ID: ${response.data.item.id}`,
    `Result: ${response.data.result.summary}`
  ];
  if (response.data.approval?.workItem) {
    lines.push(`Work item: ${response.data.approval.workItem.id}`);
  }
  if (response.data.approval?.plan) {
    lines.push(`Plan: ${response.data.approval.plan.id}`);
  }
  return lines;
}

function resolveReviewWindow(options: ReviewWeeklyCommandOptions): { since: string; until: string } {
  const untilDate = options.until ? parseDateOption("until", options.until) : todayLocalDate();
  const sinceDate = options.since ? parseDateOption("since", options.since) : addDays(untilDate, -6);

  if (sinceDate.getTime() > untilDate.getTime()) {
    throw validationError("Review window since date must be on or before until date.", {
      since: localDateStamp(sinceDate),
      until: localDateStamp(untilDate)
    });
  }

  return {
    since: localDateStamp(sinceDate),
    until: localDateStamp(untilDate)
  };
}

function parseDateOption(field: "since" | "until", value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`Invalid ${field} date. Expected YYYY-MM-DD.`, { field, value });
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw validationError(`Invalid ${field} date. Expected YYYY-MM-DD.`, { field, value });
  }

  return date;
}

function reviewPacketForReviewItem(item: ReviewItemSummary): RequiresReviewPacket {
  return {
    id: item.id,
    workItemId: item.work_item_id,
    project: item.project_name,
    goal: item.project_goal,
    decisionNeeded: item.decision_needed,
    context: `${item.resolved_intent}: ${item.proposed_action}`,
    recommendation: item.recommendation,
    options: ["approve", "reject", "defer"],
    sourceInput: item.source_input,
    resultingAskRequestId: item.resulting_ask_request_id
  };
}

function runReviewDecisionCommand(
  options: ReviewDecisionCommandOptions,
  status: "rejected" | "deferred",
  summary: string
): CommandSuccess<ReviewDecisionCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const updated = withDatabase(workspacePath, (db) => {
    const item = getReviewItem(db, options.id);
    if (!item) {
      throw validationError("Requires Review item was not found.", { id: options.id });
    }
    if (item.status !== "open" && item.status !== "deferred") {
      throw validationError("Requires Review item is already decided.", { id: item.id, status: item.status });
    }
    const next = updateReviewItemStatus(db, item.id, {
      status,
      decisionNote: summary
    });
    if (!next) {
      throw validationError("Requires Review item was not found.", { id: item.id });
    }
    return next;
  });

  return createSuccess({
    command: `review.${status === "rejected" ? "reject" : "defer"}`,
    workspace: workspacePath,
    data: {
      item: reviewPacketForReviewItem(updated),
      result: { status, summary },
      approval: null
    }
  });
}

function todayLocalDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
