import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { buildWeeklyReviewData } from "../db/repositories.js";
import { writeWeeklyReviewReport } from "../markdown/weeklyReview.js";
import { localDateStamp } from "../utils/time.js";

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

function todayLocalDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
