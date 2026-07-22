import type Database from "better-sqlite3";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import type { ActivityEvent, CreateTimeEntryInput, RecordActivityInput, TimeEntry } from "./types.js";

interface ActivityEventRow {
  id: string;
  occurred_at: string;
  local_date: string;
  surface: string;
  command: string;
  focus: string | null;
  entry_id: string | null;
  project_id: string | null;
  outcome: string;
  duration_ms: number | null;
}

interface TimeEntryRow {
  id: string;
  local_date: string;
  started_at: string | null;
  ended_at: string | null;
  minutes: number;
  description: string;
  focus: string | null;
  entry_id: string | null;
  project_id: string | null;
  area: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

function toActivityEvent(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    localDate: row.local_date,
    surface: row.surface as ActivityEvent["surface"],
    command: row.command,
    focus: row.focus,
    entryId: row.entry_id,
    projectId: row.project_id,
    outcome: row.outcome as ActivityEvent["outcome"],
    durationMs: row.duration_ms
  };
}

function toTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    localDate: row.local_date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    minutes: row.minutes,
    description: row.description,
    focus: row.focus,
    entryId: row.entry_id,
    projectId: row.project_id,
    area: row.area,
    source: row.source as TimeEntry["source"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Derives the local date from the moment itself so callers never have to agree on a clock. */
function localDateOf(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function recordActivityEvent(db: Database.Database, input: RecordActivityInput): ActivityEvent {
  const id = createId("activityEvent");
  db.prepare(
    `INSERT INTO activity_events (
       id, occurred_at, local_date, surface, command, focus, entry_id, project_id, outcome, duration_ms
     ) VALUES (
       @id, @occurred_at, @local_date, @surface, @command, @focus, @entry_id, @project_id, @outcome, @duration_ms
     )`
  ).run({
    id,
    occurred_at: input.occurredAt,
    local_date: localDateOf(input.occurredAt),
    surface: input.surface,
    command: input.command,
    focus: input.focus ?? null,
    entry_id: input.entryId ?? null,
    project_id: input.projectId ?? null,
    outcome: input.outcome,
    duration_ms: input.durationMs ?? null
  });
  const row = db.prepare("SELECT * FROM activity_events WHERE id = ?").get(id) as ActivityEventRow;
  return toActivityEvent(row);
}

export function listActivityEventsBetween(
  db: Database.Database,
  startLocalDate: string,
  endLocalDate: string
): ActivityEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM activity_events
       WHERE local_date >= ? AND local_date <= ?
       ORDER BY occurred_at ASC`
    )
    .all(startLocalDate, endLocalDate) as ActivityEventRow[];
  return rows.map(toActivityEvent);
}

export function createTimeEntry(db: Database.Database, input: CreateTimeEntryInput): TimeEntry {
  const id = createId("timeEntry");
  const now = nowIso();
  db.prepare(
    `INSERT INTO time_entries (
       id, local_date, started_at, ended_at, minutes, description, focus,
       entry_id, project_id, area, source, created_at, updated_at
     ) VALUES (
       @id, @local_date, @started_at, @ended_at, @minutes, @description, @focus,
       @entry_id, @project_id, @area, @source, @now, @now
     )`
  ).run({
    id,
    local_date: input.localDate,
    started_at: input.startedAt ?? null,
    ended_at: input.endedAt ?? null,
    minutes: Math.max(1, Math.round(input.minutes)),
    description: input.description,
    focus: input.focus ?? null,
    entry_id: input.entryId ?? null,
    project_id: input.projectId ?? null,
    area: input.area ?? null,
    source: input.source,
    now
  });
  const row = db.prepare("SELECT * FROM time_entries WHERE id = ?").get(id) as TimeEntryRow;
  return toTimeEntry(row);
}

export function listTimeEntriesBetween(
  db: Database.Database,
  startLocalDate: string,
  endLocalDate: string
): TimeEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM time_entries
       WHERE local_date >= ? AND local_date <= ?
       ORDER BY COALESCE(started_at, created_at) ASC`
    )
    .all(startLocalDate, endLocalDate) as TimeEntryRow[];
  return rows.map(toTimeEntry);
}

export function deleteTimeEntry(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM time_entries WHERE id = ?").run(id).changes > 0;
}
