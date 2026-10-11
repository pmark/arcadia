import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { resolveProjectReference } from "../ask/rules.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { latestOccurrence, nextOccurrence, type CalendarSchedule, type CalendarOccurrence } from "./calendar.js";

export interface RecurringSchedule extends CalendarSchedule {
  schema: "arcadia-recurring-schedule-v1";
  id: string;
  project: string;
  starts_at: string;
  desired_result: string;
  acceptance: string[];
}
interface ScheduleRow { id: string; definition_json: string; enabled: number; created_at: string; }
interface OccurrenceRow {
  schedule_id: string; occurrence_key: string; due_at: string; request_id: string;
  proposal_id: string | null; status: "submitted" | "failed"; attempts: number;
  last_error: string | null; updated_at: string;
}
export function parseRecurringSchedule(input: unknown): RecurringSchedule {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw validationError("Schedule must be a JSON object.");
  const value = input as Record<string, unknown>;
  const fields = ["schema", "id", "project", "cadence", "timezone", "time", "weekday", "day", "starts_at", "desired_result", "acceptance"];
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw validationError(`Unknown schedule field: ${key}.`);
  const refuse = (field: string): never => { throw validationError(`Invalid schedule field: ${field}.`); };
  if (value.schema !== "arcadia-recurring-schedule-v1") refuse("schema");
  if (typeof value.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(value.id)) refuse("id");
  if (typeof value.project !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value.project)) refuse("project");
  if (!["daily", "weekly", "monthly"].includes(String(value.cadence))) refuse("cadence");
  if (typeof value.timezone !== "string" || !value.timezone || value.timezone.length > 100) refuse("timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone as string }).format(); } catch { refuse("timezone"); }
  if (typeof value.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) refuse("time");
  if (value.cadence === "weekly" ? !Number.isInteger(value.weekday) || Number(value.weekday) < 1 || Number(value.weekday) > 7 : value.weekday !== undefined) refuse("weekday");
  // Days 1–28 have an unambiguous monthly slot in every month.
  if (value.cadence === "monthly" ? !Number.isInteger(value.day) || Number(value.day) < 1 || Number(value.day) > 28 : value.day !== undefined) refuse("day");
  if (typeof value.starts_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.starts_at) || !Number.isFinite(Date.parse(value.starts_at)) || new Date(value.starts_at).toISOString() !== value.starts_at) refuse("starts_at");
  if (typeof value.desired_result !== "string" || !value.desired_result.trim() || value.desired_result.length > 16_000) refuse("desired_result");
  if (!Array.isArray(value.acceptance) || value.acceptance.length < 1 || value.acceptance.length > 20 || value.acceptance.some((item) => typeof item !== "string" || !item.trim() || item.length > 2_000)) refuse("acceptance");
  for (const text of [value.desired_result as string, ...(value.acceptance as string[])]) {
    if (/\{\{(?!due_at\}\}|period_start\}\}|period_end\}\})/.test(text)) refuse("template placeholder");
  }
  // Fixed key ordering makes semantic replay independent of JSON field order.
  return { schema: "arcadia-recurring-schedule-v1", id: value.id as string, project: value.project as string, cadence: value.cadence as CalendarSchedule["cadence"], timezone: value.timezone as string, time: value.time as string,
    ...(value.weekday !== undefined ? { weekday: value.weekday as number } : {}), ...(value.day !== undefined ? { day: value.day as number } : {}),
    starts_at: value.starts_at as string, desired_result: value.desired_result as string, acceptance: value.acceptance as string[] };
}
export function registerRecurringSchedule(db: Database.Database, input: unknown, now = new Date()): { id: string; replayed: boolean; enabled: boolean } {
  const definition = parseRecurringSchedule(input);
  return writeTransaction(db, () => {
    if (resolveProjectReference(db, definition.project)?.status !== "active") throw validationError("Schedule destination must be a configured active Project.", { project: definition.project });
    const existing = db.prepare("SELECT * FROM recurring_schedules WHERE id = ?").get(definition.id) as ScheduleRow | undefined;
    const encoded = JSON.stringify(definition);
    if (existing) {
      if (existing.definition_json !== encoded) throw validationError("Schedule id already has a different definition; pause it and register a new id.", { id: definition.id });
      return { id: definition.id, replayed: true, enabled: Boolean(existing.enabled) };
    }
    const count = (db.prepare("SELECT COUNT(*) AS count FROM recurring_schedules").get() as { count: number }).count;
    if (count >= 100) throw validationError("Basic scheduler supports at most 100 registered schedules.");
    db.prepare("INSERT INTO recurring_schedules(id, definition_json, created_at) VALUES (?,?,?)").run(definition.id, encoded, now.toISOString());
    return { id: definition.id, replayed: false, enabled: false };
  });
}
export function setRecurringScheduleEnabled(db: Database.Database, id: string, enabled: boolean): void {
  const result = db.prepare("UPDATE recurring_schedules SET enabled = ? WHERE id = ?").run(Number(enabled), id);
  if (!result.changes) throw validationError("Unknown recurring schedule.", { id });
}
function installed(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recurring_schedules'").get());
}
export function recurringScheduleStatus(db: Database.Database, now = new Date()) {
  if (!installed(db)) return { available: false, schedules: [] };
  const schedules = (db.prepare("SELECT * FROM recurring_schedules ORDER BY id").all() as ScheduleRow[]).map((row) => {
    const definition = parseRecurringSchedule(JSON.parse(row.definition_json));
    const last = db.prepare("SELECT * FROM recurring_schedule_occurrences WHERE schedule_id = ? ORDER BY due_at DESC LIMIT 1").get(row.id) as OccurrenceRow | undefined;
    const due = latestOccurrence(definition, now);
    const pending = db.prepare(`SELECT o.* FROM recurring_schedule_occurrences o
      LEFT JOIN agent_ask_settlements s ON s.proposal_id = o.proposal_id
      WHERE o.schedule_id = ? AND (o.status = 'failed' OR s.id IS NULL)
      ORDER BY o.due_at LIMIT 1`).get(row.id) as OccurrenceRow | undefined;
    const recorded = db.prepare("SELECT 1 FROM recurring_schedule_occurrences WHERE schedule_id = ? AND occurrence_key = ?").get(row.id, due.key);
    const hasDue = Boolean(row.enabled) && !pending && !recorded && due.dueAt >= definition.starts_at;
    const lowerBound = new Date(Math.max(now.getTime(), Date.parse(definition.starts_at) - 1));
    return { definition, enabled: Boolean(row.enabled), due: hasDue ? due : null, next: nextOccurrence(definition, lowerBound), pending: pending ?? null, last: last ?? null };
  });
  return { available: true, schedules };
}
export interface ScheduleTickResult { id: string; status: "submitted" | "failed" | "waiting"; occurrence: string; requestId?: string; proposalId?: string; error?: string; }
const RETRY_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
function render(text: string, slot: CalendarOccurrence): string {
  return text.replace(/\{\{(due_at|period_start|period_end)\}\}/g, (_, key: string) => ({ due_at: slot.dueAt, period_start: slot.periodStart, period_end: slot.periodEnd })[key]!);
}
/** One IMMEDIATE transaction binds each due occurrence to the existing Agent Ask preview receipt. No execution or model call. */
export function tickRecurringSchedules(db: Database.Database, now = new Date()): ScheduleTickResult[] {
  if (!installed(db)) return [];
  if (!Number.isFinite(now.getTime())) throw validationError("Scheduler clock is invalid.");
  const result: ScheduleTickResult[] = [];
  const rows = db.prepare("SELECT * FROM recurring_schedules WHERE enabled = 1 ORDER BY id").all() as ScheduleRow[];
  let attempts = 0;
  for (const row of rows) {
    if (attempts >= 20) break;
    const entry = writeTransaction(db, (): ScheduleTickResult | null => {
      // Recheck under the same writer lock as capture and receipt creation.
      const current = db.prepare("SELECT * FROM recurring_schedules WHERE id = ? AND enabled = 1").get(row.id) as ScheduleRow | undefined;
      if (!current) return null;
      const definition = parseRecurringSchedule(JSON.parse(current.definition_json));
      const pending = db.prepare(`SELECT o.* FROM recurring_schedule_occurrences o
        LEFT JOIN agent_ask_settlements s ON s.proposal_id = o.proposal_id
        WHERE o.schedule_id = ? AND (o.status = 'failed' OR s.id IS NULL)
        ORDER BY o.due_at LIMIT 1`).get(row.id) as OccurrenceRow | undefined;
      if (pending?.status === "submitted") return { id: row.id, status: "waiting", occurrence: pending.occurrence_key, requestId: pending.request_id, proposalId: pending.proposal_id! };
      if (pending && (pending.attempts >= MAX_ATTEMPTS || now.getTime() - Date.parse(pending.updated_at) < RETRY_MS)) return { id: row.id, status: "waiting", occurrence: pending.occurrence_key, error: pending.last_error ?? undefined };
      const slot = latestOccurrence(definition, pending ? new Date(pending.due_at) : now);
      if (slot.dueAt < definition.starts_at || slot.dueAt > now.toISOString()) return null;
      const existing = db.prepare("SELECT * FROM recurring_schedule_occurrences WHERE schedule_id = ? AND occurrence_key = ?").get(row.id, slot.key) as OccurrenceRow | undefined;
      if (existing?.status === "submitted") return null;
      attempts++;
      const requestId = existing?.request_id ?? `schedule-${createHash("sha256").update(`${row.id}:${slot.key}`).digest("hex").slice(0, 32)}`;
      const desired = render(definition.desired_result, slot);
      const request = JSON.stringify({ agent_ask: "v1", request_id: requestId, project: definition.project, intent: "action", requested_authority: "propose", desired_result: desired,
        actions: [{ id: `${row.id}-${slot.key}`, desired_result: desired, acceptance: definition.acceptance.map((criterion) => render(criterion, slot)) }] });
      let proposalId: string | null = null;
      let error: string | null = null;
      try {
        if (resolveProjectReference(db, definition.project)?.status !== "active") throw validationError("Schedule destination must be a configured active Project.", { project: definition.project });
        proposalId = previewAgentAskRequest(db, { request, sourcePath: `schedule:${row.id}/${slot.key}` }).proposal.id;
      }
      catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
      const status = proposalId ? "submitted" : "failed";
      db.prepare(`INSERT INTO recurring_schedule_occurrences(schedule_id,occurrence_key,due_at,request_id,proposal_id,status,attempts,last_error,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(schedule_id,occurrence_key) DO UPDATE SET
        proposal_id=excluded.proposal_id,status=excluded.status,attempts=excluded.attempts,last_error=excluded.last_error,updated_at=excluded.updated_at`)
        .run(row.id, slot.key, slot.dueAt, requestId, proposalId, status, (existing?.attempts ?? 0) + 1, error, now.toISOString());
      return { id: row.id, status, occurrence: slot.key, requestId, ...(proposalId ? { proposalId } : {}), ...(error ? { error } : {}) };
    });
    if (entry) result.push(entry);
  }
  return result;
}
export function retryRecurringOccurrence(db: Database.Database, id: string, key: string): void {
  const result = db.prepare("UPDATE recurring_schedule_occurrences SET attempts = 0, updated_at = '1970-01-01T00:00:00.000Z' WHERE schedule_id = ? AND occurrence_key = ? AND status = 'failed'").run(id, key);
  if (!result.changes) throw validationError("No failed occurrence to retry.", { id, key });
}
