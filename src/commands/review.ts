import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { buildStatusReportData, buildWeeklyReviewData, getProject } from "../db/repositories.js";
import type { WorkItemSummary } from "../domain/types.js";
import { writeWeeklyReviewReport } from "../markdown/weeklyReview.js";
import { localDateStamp } from "../utils/time.js";

export interface RequiresReviewPacket {
  workItemId: string;
  project: string | null;
  goal: string | null;
  decisionNeeded: string;
  context: string;
  recommendation: string | null;
  options: string[];
  sourceInput: string;
}

export interface ReviewRequiredCommandOptions {
  workspace: string;
}

export interface ReviewRequiredCommandData {
  count: number;
  items: RequiresReviewPacket[];
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
    needsMark: number;
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
    const status = buildStatusReportData(db, workspacePath);
    return status.needsMarkItems.map((item) => {
      const project = item.project_id ? getProject(db, item.project_id) : null;
      return reviewPacketForWorkItem(item, project?.goal ?? null);
    });
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
        needsMark: data.needsMarkItems.length,
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
    lines.push(`- ${item.context}`);
    lines.push(`  Project: ${item.project ?? "None"}`);
    lines.push(`  Goal: ${item.goal ?? "None"}`);
    lines.push(`  Decision needed: ${item.decisionNeeded}`);
    lines.push(`  Recommendation: ${item.recommendation ?? "Clarify the request before execution."}`);
    lines.push(`  Options: ${item.options.join("; ")}`);
    lines.push(`  Source input: ${item.sourceInput}`);
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

function reviewPacketForWorkItem(item: WorkItemSummary, goal: string | null): RequiresReviewPacket {
  return {
    workItemId: item.id,
    project: item.project_name,
    goal,
    decisionNeeded: userFacingReviewText(item.next_action),
    context: item.title,
    recommendation: recommendationForWorkItem(item),
    options: optionsForWorkItem(item),
    sourceInput: item.raw_input
  };
}

function recommendationForWorkItem(item: WorkItemSummary): string | null {
  if (item.expected_artifact) {
    return `Confirm whether to produce: ${item.expected_artifact}.`;
  }

  if (item.project_name) {
    return `Clarify the next action for ${item.project_name}.`;
  }

  return "Clarify the intended Arcadia action.";
}

function optionsForWorkItem(item: WorkItemSummary): string[] {
  if (item.project_name) {
    return [
      "approve as written",
      "revise the requested action",
      "move out of Requires Review"
    ];
  }

  return [
    "assign a project",
    "capture as a loose thought",
    "dismiss after review"
  ];
}

function userFacingReviewText(value: string): string {
  return value
    .replace(/\bNeeds Mark\b/g, "Requires Review")
    .replace(/\bneeds_mark\b/g, "Requires Review")
    .replace(/\bMark must\b/g, "The user must")
    .replace(/\bMark\b/g, "the user");
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
