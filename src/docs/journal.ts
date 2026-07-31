import type Database from "better-sqlite3";
import { createId } from "../utils/id.js";
import type { DispatchBlocker } from "./dispatch.js";

/**
 * The dispatch journal: what the managed documents decided, every time they
 * were asked.
 *
 * The continuation contract's bet is that keeping control documentation
 * correct costs less than the confusion it prevents. That bet is only
 * checkable if refusals are counted — how often dispatch is blocked, and on
 * which field — so the answer comes from the record instead of from whoever
 * remembers last week most vividly. A field that blocks constantly is either a
 * rule worth relaxing or a habit worth fixing, and the tally is what tells the
 * two apart.
 */

/** Which resolution produced the row. */
export type DispatchCommand = "next" | "work.plan" | "review.approve";

export interface DispatchEvent {
  id: string;
  occurredAt: string;
  localDate: string;
  command: DispatchCommand;
  projectId: string | null;
  projectSlug: string | null;
  planSlug: string | null;
  actionId: string | null;
  dispatchable: boolean;
  blockerCount: number;
  /** Distinct blocker fields, in first-seen order. */
  blockerFields: string[];
  operatorQuestion: boolean;
}

export interface RecordDispatchInput {
  command: DispatchCommand;
  projectId?: string | null;
  projectSlug?: string | null;
  planSlug?: string | null;
  actionId?: string | null;
  dispatchable: boolean;
  blockers: DispatchBlocker[];
  operatorQuestion: string | null;
}

interface DispatchEventRow {
  id: string;
  occurred_at: string;
  local_date: string;
  command: string;
  project_id: string | null;
  project_slug: string | null;
  plan_slug: string | null;
  action_id: string | null;
  dispatchable: number;
  blocker_count: number;
  blocker_fields: string;
  operator_question: number;
}

/**
 * Append one resolution to the journal.
 *
 * Never allowed to fail its caller, for the same reason the activity recorder
 * is not: losing a telemetry row is nothing, and refusing to resolve the
 * current action because a journal insert hiccuped would break the operator's
 * startup procedure over bookkeeping.
 */
export function recordDispatchEvent(db: Database.Database, input: RecordDispatchInput): void {
  try {
    const occurredAt = new Date();
    // Distinct fields only: twelve unmet dependencies on one action are one
    // fact about `depends_on`, and counting them twelve times would make the
    // tally a measure of plan size rather than of what blocks work.
    const fields = [...new Set(input.blockers.map((blocker) => blocker.field))];

    db.prepare(
      `INSERT INTO dispatch_events (
        id, occurred_at, local_date, command, project_id, project_slug, plan_slug,
        action_id, dispatchable, blocker_count, blocker_fields, operator_question
      ) VALUES (
        @id, @occurred_at, @local_date, @command, @project_id, @project_slug, @plan_slug,
        @action_id, @dispatchable, @blocker_count, @blocker_fields, @operator_question
      )`
    ).run({
      id: createId("dispatchEvent"),
      occurred_at: occurredAt.toISOString(),
      local_date: localDate(occurredAt),
      command: input.command,
      project_id: input.projectId ?? null,
      project_slug: input.projectSlug ?? null,
      plan_slug: input.planSlug ?? null,
      action_id: input.actionId ?? null,
      dispatchable: input.dispatchable ? 1 : 0,
      blocker_count: input.blockers.length,
      blocker_fields: JSON.stringify(fields),
      operator_question: input.operatorQuestion ? 1 : 0
    });
  } catch {
    // Deliberately silent: see the note above.
  }
}

/** Most recent resolutions first. */
export function listDispatchEvents(db: Database.Database, limit = 20): DispatchEvent[] {
  const rows = db
    .prepare("SELECT * FROM dispatch_events ORDER BY occurred_at DESC, rowid DESC LIMIT ?")
    .all(Math.max(1, Math.trunc(limit))) as DispatchEventRow[];
  return rows.map(toDispatchEvent);
}

export interface DispatchJournalSummary {
  total: number;
  dispatchable: number;
  blocked: number;
  /** Blocker fields by how many resolutions they blocked, most frequent first. */
  byField: Array<{ field: string; resolutions: number }>;
}

/**
 * The question the journal exists to answer: how often does dispatch refuse,
 * and on which field.
 *
 * Counted over resolutions rather than blockers, so a field that blocks one
 * resolution loudly does not outrank a field that quietly blocks every one.
 */
export function summarizeDispatchEvents(db: Database.Database, limit = 200): DispatchJournalSummary {
  const events = listDispatchEvents(db, limit);
  const counts = new Map<string, number>();

  for (const event of events) {
    for (const field of event.blockerFields) {
      counts.set(field, (counts.get(field) ?? 0) + 1);
    }
  }

  return {
    total: events.length,
    dispatchable: events.filter((event) => event.dispatchable).length,
    blocked: events.filter((event) => !event.dispatchable).length,
    byField: [...counts.entries()]
      .map(([field, resolutions]) => ({ field, resolutions }))
      // Ties broken by name so the report is stable between runs.
      .sort((a, b) => b.resolutions - a.resolutions || a.field.localeCompare(b.field))
  };
}

function toDispatchEvent(row: DispatchEventRow): DispatchEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    localDate: row.local_date,
    command: row.command as DispatchCommand,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    planSlug: row.plan_slug,
    actionId: row.action_id,
    dispatchable: row.dispatchable === 1,
    blockerCount: row.blocker_count,
    blockerFields: parseFields(row.blocker_fields),
    operatorQuestion: row.operator_question === 1
  };
}

function parseFields(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function localDate(when: Date): string {
  const year = when.getFullYear();
  const month = `${when.getMonth() + 1}`.padStart(2, "0");
  const day = `${when.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
