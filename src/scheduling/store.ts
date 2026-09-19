import type Database from "better-sqlite3";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import type { SchedulingClass } from "./order.js";

/**
 * Canonical scheduling state lives here, in SQLite, beside the existing
 * portfolio queue. `action_queue_positions` already holds `queue_position` and
 * `action_queue_state.revision` already is the `queue_revision`; these tables
 * add only what scheduling needs on top: the tier each Action belongs to and
 * where it was discovered, each Project's place in the cross-Project order
 * and its GitHub board, and the audit trail every scheduling mutation writes.
 */

export const SCHEDULING_LOG_SOURCES = ["arcadia", "github_operator", "coding_run", "decision"] as const;
export type SchedulingLogSource = (typeof SCHEDULING_LOG_SOURCES)[number];

export function ensureSchedulingTables(db: Database.Database): void {
  // A read-only connection runs no migrations (src/db/connection.ts). On a
  // workspace opened before these tables existed, the DDL below is itself a
  // write and SQLite refuses it -- so a read-only connection skips it and
  // relies on the read paths below tolerating an absent table instead.
  if (db.readonly) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduling_projects (
      project_slug TEXT PRIMARY KEY,
      priority INTEGER NOT NULL DEFAULT 1000,
      github_owner TEXT,
      github_project_number INTEGER,
      github_project_id TEXT,
      github_repository TEXT,
      last_projected_revision INTEGER NOT NULL DEFAULT -1,
      last_projected_order_json TEXT NOT NULL DEFAULT '[]',
      failed_runs INTEGER NOT NULL DEFAULT 0,
      failed_runs_milestone TEXT,
      paused_reason TEXT,
      paused_decision_id TEXT,
      github_status_field_id TEXT,
      github_status_options_json TEXT,
      last_reconciled_at TEXT,
      projection_in_flight INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scheduling_actions (
      action_key TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      action_id TEXT NOT NULL,
      scheduling_class TEXT NOT NULL CHECK (scheduling_class IN ('interrupt', 'blocker', 'corrective', 'planned', 'follow_up')),
      discovered_by_action_key TEXT,
      discovery_depth INTEGER NOT NULL DEFAULT 0,
      github_issue_number INTEGER,
      github_issue_url TEXT,
      github_project_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduling_actions_project ON scheduling_actions(project_slug);
    CREATE TABLE IF NOT EXISTS scheduling_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      project_slug TEXT,
      action_key TEXT,
      source TEXT NOT NULL CHECK (source IN ('arcadia', 'github_operator', 'coding_run', 'decision')),
      reason TEXT NOT NULL,
      previous_json TEXT,
      new_json TEXT,
      request_id TEXT UNIQUE,
      result_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduling_log_project ON scheduling_log(project_slug, at);
  `);
  // Columns added after the first tables shipped; a workspace created before
  // any of them keeps its rows and gains the column here.
  const columns = new Set(
    (db.prepare("PRAGMA table_info(scheduling_projects)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  const added: Array<[string, string]> = [
    ["paused_decision_id", "TEXT"],
    ["github_status_field_id", "TEXT"],
    ["github_status_options_json", "TEXT"],
    ["last_reconciled_at", "TEXT"],
    ["projection_in_flight", "INTEGER NOT NULL DEFAULT 0"]
  ];
  for (const [name, definition] of added) {
    if (!columns.has(name)) db.exec(`ALTER TABLE scheduling_projects ADD COLUMN ${name} ${definition}`);
  }
}

export interface SchedulingProjectRecord {
  projectSlug: string;
  priority: number;
  githubOwner: string | null;
  githubProjectNumber: number | null;
  githubProjectId: string | null;
  githubRepository: string | null;
  lastProjectedRevision: number;
  lastProjectedOrder: string[];
  failedRuns: number;
  failedRunsMilestone: string | null;
  pausedReason: string | null;
  /** The Decision opened when the pause was applied; resume waits on its answer. */
  pausedDecisionId: string | null;
  /** The board's single-select status field id, cached so a tick need not re-resolve it. */
  githubStatusFieldId: string | null;
  /** Status name to single-select option id, cached alongside the field id. */
  githubStatusOptions: Record<string, string> | null;
  /** When the board was last read, so polling for operator drags can be throttled. */
  lastReconciledAt: string | null;
  /**
   * A projection started writing to the board and has not finished. Until it
   * does, the board is in an intermediate state that is nobody's intent, so
   * operator-drag detection must not run against it.
   */
  projectionInFlight: boolean;
}

interface SchedulingProjectRow {
  project_slug: string;
  priority: number;
  github_owner: string | null;
  github_project_number: number | null;
  github_project_id: string | null;
  github_repository: string | null;
  last_projected_revision: number;
  last_projected_order_json: string;
  failed_runs: number;
  failed_runs_milestone: string | null;
  paused_reason: string | null;
  paused_decision_id: string | null;
  github_status_field_id: string | null;
  github_status_options_json: string | null;
  last_reconciled_at: string | null;
  projection_in_flight: number;
}

function projectFromRow(row: SchedulingProjectRow): SchedulingProjectRecord {
  let order: string[] = [];
  try {
    const parsed = JSON.parse(row.last_projected_order_json) as unknown;
    if (Array.isArray(parsed)) order = parsed.filter((value): value is string => typeof value === "string");
  } catch {
    order = [];
  }
  return {
    projectSlug: row.project_slug,
    priority: row.priority,
    githubOwner: row.github_owner,
    githubProjectNumber: row.github_project_number,
    githubProjectId: row.github_project_id,
    githubRepository: row.github_repository,
    lastProjectedRevision: row.last_projected_revision,
    lastProjectedOrder: order,
    failedRuns: row.failed_runs,
    failedRunsMilestone: row.failed_runs_milestone,
    pausedReason: row.paused_reason,
    pausedDecisionId: row.paused_decision_id,
    githubStatusFieldId: row.github_status_field_id,
    githubStatusOptions: parseOptions(row.github_status_options_json),
    lastReconciledAt: row.last_reconciled_at,
    projectionInFlight: row.projection_in_flight === 1
  };
}

function parseOptions(value: string | null): Record<string, string> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  } catch {
    return null;
  }
}

function defaultSchedulingProject(projectSlug: string): SchedulingProjectRecord {
  return {
    projectSlug,
    priority: 1000,
    githubOwner: null,
    githubProjectNumber: null,
    githubProjectId: null,
    githubRepository: null,
    lastProjectedRevision: -1,
    lastProjectedOrder: [],
    failedRuns: 0,
    failedRunsMilestone: null,
    pausedReason: null,
    pausedDecisionId: null,
    githubStatusFieldId: null,
    githubStatusOptions: null,
    lastReconciledAt: null,
    projectionInFlight: false
  };
}

/**
 * True for the "table/column does not exist" errors a read hits on a
 * workspace whose read-only connection skipped `ensureSchedulingTables`
 * (see there). Any other error is a real failure and must propagate.
 */
function isMissingSchemaError(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("no such table") || error.message.includes("no such column"));
}

export function getSchedulingProject(db: Database.Database, projectSlug: string): SchedulingProjectRecord {
  ensureSchedulingTables(db);
  let row: SchedulingProjectRow | undefined;
  try {
    row = db.prepare("SELECT * FROM scheduling_projects WHERE project_slug = ?").get(projectSlug) as SchedulingProjectRow | undefined;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }
  return row ? projectFromRow(row) : defaultSchedulingProject(projectSlug);
}

export function listSchedulingProjects(db: Database.Database): SchedulingProjectRecord[] {
  ensureSchedulingTables(db);
  try {
    return (db.prepare("SELECT * FROM scheduling_projects ORDER BY priority, project_slug").all() as SchedulingProjectRow[]).map(projectFromRow);
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export function upsertSchedulingProject(
  db: Database.Database,
  projectSlug: string,
  patch: Partial<Omit<SchedulingProjectRecord, "projectSlug">>
): SchedulingProjectRecord {
  ensureSchedulingTables(db);
  const current = getSchedulingProject(db, projectSlug);
  const next: SchedulingProjectRecord = { ...current, ...patch, projectSlug };
  const at = nowIso();
  db.prepare(
    `INSERT INTO scheduling_projects (
       project_slug, priority, github_owner, github_project_number, github_project_id, github_repository,
       last_projected_revision, last_projected_order_json, failed_runs, failed_runs_milestone, paused_reason,
       paused_decision_id, github_status_field_id, github_status_options_json, last_reconciled_at,
       projection_in_flight, created_at, updated_at
     ) VALUES (
       @project_slug, @priority, @github_owner, @github_project_number, @github_project_id, @github_repository,
       @last_projected_revision, @last_projected_order_json, @failed_runs, @failed_runs_milestone, @paused_reason,
       @paused_decision_id, @github_status_field_id, @github_status_options_json, @last_reconciled_at,
       @projection_in_flight, @created_at, @updated_at
     )
     ON CONFLICT(project_slug) DO UPDATE SET
       priority = @priority, github_owner = @github_owner, github_project_number = @github_project_number,
       github_project_id = @github_project_id, github_repository = @github_repository,
       last_projected_revision = @last_projected_revision, last_projected_order_json = @last_projected_order_json,
       failed_runs = @failed_runs, failed_runs_milestone = @failed_runs_milestone, paused_reason = @paused_reason,
       paused_decision_id = @paused_decision_id, github_status_field_id = @github_status_field_id,
       github_status_options_json = @github_status_options_json, last_reconciled_at = @last_reconciled_at,
       projection_in_flight = @projection_in_flight, updated_at = @updated_at`
  ).run({
    project_slug: projectSlug,
    priority: next.priority,
    github_owner: next.githubOwner,
    github_project_number: next.githubProjectNumber,
    github_project_id: next.githubProjectId,
    github_repository: next.githubRepository,
    last_projected_revision: next.lastProjectedRevision,
    last_projected_order_json: JSON.stringify(next.lastProjectedOrder),
    failed_runs: next.failedRuns,
    failed_runs_milestone: next.failedRunsMilestone,
    paused_reason: next.pausedReason,
    paused_decision_id: next.pausedDecisionId,
    github_status_field_id: next.githubStatusFieldId,
    github_status_options_json: next.githubStatusOptions ? JSON.stringify(next.githubStatusOptions) : null,
    last_reconciled_at: next.lastReconciledAt,
    projection_in_flight: next.projectionInFlight ? 1 : 0,
    created_at: at,
    updated_at: at
  });
  return next;
}

export interface SchedulingActionRecord {
  actionKey: string;
  projectSlug: string;
  actionId: string;
  schedulingClass: SchedulingClass;
  discoveredByActionKey: string | null;
  discoveryDepth: number;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubProjectItemId: string | null;
}

interface SchedulingActionRow {
  action_key: string;
  project_slug: string;
  action_id: string;
  scheduling_class: SchedulingClass;
  discovered_by_action_key: string | null;
  discovery_depth: number;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_project_item_id: string | null;
}

function actionFromRow(row: SchedulingActionRow): SchedulingActionRecord {
  return {
    actionKey: row.action_key,
    projectSlug: row.project_slug,
    actionId: row.action_id,
    schedulingClass: row.scheduling_class,
    discoveredByActionKey: row.discovered_by_action_key,
    discoveryDepth: row.discovery_depth,
    githubIssueNumber: row.github_issue_number,
    githubIssueUrl: row.github_issue_url,
    githubProjectItemId: row.github_project_item_id
  };
}

export function actionKeyOf(projectSlug: string, actionId: string): string {
  return `${projectSlug}/${actionId}`;
}

export function parseActionKey(actionKey: string): { projectSlug: string; actionId: string } | null {
  const slash = actionKey.indexOf("/");
  if (slash <= 0 || slash === actionKey.length - 1) return null;
  return { projectSlug: actionKey.slice(0, slash), actionId: actionKey.slice(slash + 1) };
}

export function getSchedulingAction(db: Database.Database, actionKey: string): SchedulingActionRecord | null {
  ensureSchedulingTables(db);
  try {
    const row = db.prepare("SELECT * FROM scheduling_actions WHERE action_key = ?").get(actionKey) as SchedulingActionRow | undefined;
    return row ? actionFromRow(row) : null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export function listSchedulingActions(db: Database.Database, projectSlug: string): SchedulingActionRecord[] {
  ensureSchedulingTables(db);
  try {
    return (db.prepare("SELECT * FROM scheduling_actions WHERE project_slug = ? ORDER BY created_at, action_key").all(projectSlug) as SchedulingActionRow[]).map(actionFromRow);
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export function upsertSchedulingAction(
  db: Database.Database,
  actionKey: string,
  patch: Partial<Omit<SchedulingActionRecord, "actionKey" | "projectSlug" | "actionId">>
): SchedulingActionRecord {
  ensureSchedulingTables(db);
  const parsed = parseActionKey(actionKey);
  if (!parsed) throw new Error(`Invalid action key: ${actionKey}`);
  const current = getSchedulingAction(db, actionKey) ?? {
    actionKey,
    projectSlug: parsed.projectSlug,
    actionId: parsed.actionId,
    schedulingClass: "planned" as SchedulingClass,
    discoveredByActionKey: null,
    discoveryDepth: 0,
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubProjectItemId: null
  };
  const next: SchedulingActionRecord = { ...current, ...patch };
  const at = nowIso();
  db.prepare(
    `INSERT INTO scheduling_actions (
       action_key, project_slug, action_id, scheduling_class, discovered_by_action_key, discovery_depth,
       github_issue_number, github_issue_url, github_project_item_id, created_at, updated_at
     ) VALUES (
       @action_key, @project_slug, @action_id, @scheduling_class, @discovered_by_action_key, @discovery_depth,
       @github_issue_number, @github_issue_url, @github_project_item_id, @created_at, @updated_at
     )
     ON CONFLICT(action_key) DO UPDATE SET
       scheduling_class = @scheduling_class, discovered_by_action_key = @discovered_by_action_key,
       discovery_depth = @discovery_depth, github_issue_number = @github_issue_number,
       github_issue_url = @github_issue_url, github_project_item_id = @github_project_item_id, updated_at = @updated_at`
  ).run({
    action_key: actionKey,
    project_slug: next.projectSlug,
    action_id: next.actionId,
    scheduling_class: next.schedulingClass,
    discovered_by_action_key: next.discoveredByActionKey,
    discovery_depth: next.discoveryDepth,
    github_issue_number: next.githubIssueNumber,
    github_issue_url: next.githubIssueUrl,
    github_project_item_id: next.githubProjectItemId,
    created_at: at,
    updated_at: at
  });
  return next;
}

export interface SchedulingLogEntry {
  id: string;
  at: string;
  projectSlug: string | null;
  actionKey: string | null;
  source: SchedulingLogSource;
  reason: string;
  previous: unknown;
  next: unknown;
  requestId: string | null;
}

export function recordSchedulingLog(
  db: Database.Database,
  input: {
    projectSlug: string | null;
    actionKey: string | null;
    source: SchedulingLogSource;
    reason: string;
    previous?: unknown;
    next?: unknown;
    requestId?: string;
    result?: unknown;
    at?: string;
  }
): SchedulingLogEntry {
  ensureSchedulingTables(db);
  const entry: SchedulingLogEntry = {
    id: createId("event").replace(/^event/, "sched"),
    at: input.at ?? nowIso(),
    projectSlug: input.projectSlug,
    actionKey: input.actionKey,
    source: input.source,
    reason: input.reason,
    previous: input.previous ?? null,
    next: input.next ?? null,
    requestId: input.requestId ?? null
  };
  db.prepare(
    `INSERT INTO scheduling_log (id, at, project_slug, action_key, source, reason, previous_json, new_json, request_id, result_json)
     VALUES (@id, @at, @project_slug, @action_key, @source, @reason, @previous_json, @new_json, @request_id, @result_json)`
  ).run({
    id: entry.id,
    at: entry.at,
    project_slug: entry.projectSlug,
    action_key: entry.actionKey,
    source: entry.source,
    reason: entry.reason,
    previous_json: entry.previous === null ? null : JSON.stringify(entry.previous),
    new_json: entry.next === null ? null : JSON.stringify(entry.next),
    request_id: entry.requestId,
    result_json: input.result === undefined ? null : JSON.stringify(input.result)
  });
  return entry;
}

/** The stored result of an earlier mutation with this request id, for idempotent replay. */
export function replaySchedulingResult<T>(db: Database.Database, requestId: string): T | null {
  ensureSchedulingTables(db);
  let row: { result_json: string | null } | undefined;
  try {
    row = db.prepare("SELECT result_json FROM scheduling_log WHERE request_id = ?").get(requestId) as { result_json: string | null } | undefined;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }
  return row?.result_json ? (JSON.parse(row.result_json) as T) : null;
}

/**
 * The Log, newest first.
 *
 * Ties on `at` break by `rowid`, which is insertion order, never by `id` --
 * ids are random, so two entries written inside the same millisecond used to
 * come back in an arbitrary order. For an audit trail that is not a cosmetic
 * detail: "what happened last" is the question the Log exists to answer, and
 * scheduling routinely writes several entries in one pass.
 */
export function listSchedulingLog(db: Database.Database, options: { projectSlug?: string; limit?: number } = {}): SchedulingLogEntry[] {
  ensureSchedulingTables(db);
  const limit = options.limit ?? 50;
  let rows: Array<{
    id: string; at: string; project_slug: string | null; action_key: string | null; source: SchedulingLogSource;
    reason: string; previous_json: string | null; new_json: string | null; request_id: string | null;
  }>;
  try {
    rows = (options.projectSlug
      ? db.prepare("SELECT * FROM scheduling_log WHERE project_slug = ? ORDER BY at DESC, rowid DESC LIMIT ?").all(options.projectSlug, limit)
      : db.prepare("SELECT * FROM scheduling_log ORDER BY at DESC, rowid DESC LIMIT ?").all(limit)) as typeof rows;
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    projectSlug: row.project_slug,
    actionKey: row.action_key,
    source: row.source,
    reason: row.reason,
    previous: row.previous_json ? JSON.parse(row.previous_json) : null,
    next: row.new_json ? JSON.parse(row.new_json) : null,
    requestId: row.request_id
  }));
}
