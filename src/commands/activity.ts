import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import { formatMinutes } from "../orientation/effort.js";
import { findOrientationEntry } from "../orientation/repository.js";
import { localDateStamp } from "../utils/time.js";
import { deriveEngagementBlocks } from "../activity/blocks.js";
import { currentSurface } from "../activity/recorder.js";
import { buildActivityReport, type ActivityReport } from "../activity/report.js";
import {
  createTimeEntry,
  listActivityEventsBetween,
  listTimeEntriesBetween
} from "../activity/repository.js";
import type { ActivityEvent, EngagementBlock, TimeEntry } from "../activity/types.js";

/** Local-date arithmetic, kept away from UTC so "last 7 days" means the operator's days. */
function shiftLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateStamp(date);
}

// ---------------------------------------------------------------------------
// Logging time
// ---------------------------------------------------------------------------

export interface TimeLogOptions {
  workspace: string;
  minutes: number;
  description: string;
  /** Local clock time the work started, "HH:MM". Optional by design. */
  at?: string;
  entryId?: string;
  localDate?: string;
  source?: TimeEntry["source"];
}

export function runTimeLogCommand(options: TimeLogOptions): CommandSuccess<{ timeEntry: TimeEntry }> {
  if (!Number.isFinite(options.minutes) || options.minutes <= 0) {
    throw validationError("Minutes must be a positive number.", { minutes: options.minutes });
  }
  if (!options.description.trim()) {
    throw validationError("A description is required — it is what gets read back to you.", {});
  }

  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const localDate = options.localDate ?? localDateStamp(new Date());
    const startedAt = options.at ? resolveLocalClock(localDate, options.at) : null;
    const entry = options.entryId ? findOrientationEntry(db, options.entryId) : null;
    if (options.entryId && !entry) {
      throw validationError(`No ledger entry with id ${options.entryId}.`, { entryId: options.entryId });
    }

    const timeEntry = createTimeEntry(db, {
      localDate,
      startedAt,
      endedAt: startedAt ? new Date(new Date(startedAt).getTime() + options.minutes * 60_000).toISOString() : null,
      minutes: options.minutes,
      description: options.description,
      focus: entry?.title ?? null,
      entryId: entry?.id ?? null,
      projectId: entry?.projectId ?? null,
      area: entry?.area ?? null,
      source: options.source ?? sourceFromSurface()
    });

    return createSuccess({ command: "time.log", workspace: workspacePath, data: { timeEntry } });
  } finally {
    db.close();
  }
}

/**
 * Where the log came from, in the vocabulary time entries already use. The
 * dashboard is "admin" here for the same reason it is elsewhere in the ledger
 * — one name for one surface across the whole system.
 */
function sourceFromSurface(): TimeEntry["source"] {
  switch (currentSurface()) {
    case "dashboard":
      return "admin";
    case "discord":
      return "discord";
    default:
      return "cli";
  }
}

function resolveLocalClock(localDate: string, clock: string): string {
  const match = clock.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw validationError(`Could not read "${clock}" as a time of day. Use HH:MM.`, { at: clock });
  }
  const [year, month, day] = localDate.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(year, month - 1, day, Number.parseInt(match[1], 10), Number.parseInt(match[2], 10));
  return date.toISOString();
}

export interface TimeListData {
  entries: TimeEntry[];
  totalMinutes: number;
  startLocalDate: string;
  endLocalDate: string;
}

export function runTimeListCommand(options: {
  workspace: string;
  days?: number;
  localDate?: string;
}): CommandSuccess<TimeListData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const endLocalDate = options.localDate ?? localDateStamp(new Date());
    const startLocalDate = shiftLocalDate(endLocalDate, -(Math.max(1, options.days ?? 1) - 1));
    const entries = listTimeEntriesBetween(db, startLocalDate, endLocalDate);
    return createSuccess({
      command: "time.list",
      workspace: workspacePath,
      data: {
        entries,
        totalMinutes: entries.reduce((total, entry) => total + entry.minutes, 0),
        startLocalDate,
        endLocalDate
      }
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Raw activity, for when the operator wants to see the evidence itself
// ---------------------------------------------------------------------------

export interface ActivityListData {
  events: ActivityEvent[];
  blocks: EngagementBlock[];
  startLocalDate: string;
  endLocalDate: string;
}

export function runActivityListCommand(options: {
  workspace: string;
  days?: number;
  localDate?: string;
}): CommandSuccess<ActivityListData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const endLocalDate = options.localDate ?? localDateStamp(new Date());
    const startLocalDate = shiftLocalDate(endLocalDate, -(Math.max(1, options.days ?? 1) - 1));
    const events = listActivityEventsBetween(db, startLocalDate, endLocalDate);
    return createSuccess({
      command: "activity.list",
      workspace: workspacePath,
      data: { events, blocks: deriveEngagementBlocks(events), startLocalDate, endLocalDate }
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function runReportCommand(options: {
  workspace: string;
  kind: "daily" | "weekly";
  localDate?: string;
}): CommandSuccess<ActivityReport> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const now = new Date();
    const endLocalDate = options.localDate ?? localDateStamp(now);
    const startLocalDate = options.kind === "daily" ? endLocalDate : shiftLocalDate(endLocalDate, -6);
    const report = buildActivityReport(db, { kind: options.kind, startLocalDate, endLocalDate, now });
    return createSuccess({ command: `report.${options.kind}`, workspace: workspacePath, data: report });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export function renderTimeLogSuccess(response: CommandSuccess<{ timeEntry: TimeEntry }>): string[] {
  const { timeEntry } = response.data;
  const when = timeEntry.startedAt ? ` starting ${new Date(timeEntry.startedAt).toLocaleTimeString()}` : "";
  return [`Logged ${formatMinutes(timeEntry.minutes)}${when}: ${timeEntry.description}`];
}

export function renderTimeListSuccess(response: CommandSuccess<TimeListData>): string[] {
  const { entries, totalMinutes, startLocalDate, endLocalDate } = response.data;
  if (entries.length === 0) {
    return [`No time logged between ${startLocalDate} and ${endLocalDate}.`];
  }
  return [
    ...entries.map(
      (entry) =>
        `${entry.localDate}  ${formatMinutes(entry.minutes).padStart(6)}  ${entry.focus ?? "—"}  ${entry.description}`
    ),
    `Total: ${formatMinutes(totalMinutes)}`
  ];
}

export function renderActivityListSuccess(response: CommandSuccess<ActivityListData>): string[] {
  const { blocks, events } = response.data;
  if (events.length === 0) {
    return ["No recorded activity in that window."];
  }
  return blocks.map(
    (block) =>
      `${block.startedAt} → ${block.endedAt}  ${formatMinutes(block.minutes).padStart(6)}  ${block.interactionCount} touches  ${block.focuses.slice(0, 2).join(", ")}`
  );
}

export function renderReportSuccess(response: CommandSuccess<ActivityReport>): string[] {
  return response.data.lines;
}
