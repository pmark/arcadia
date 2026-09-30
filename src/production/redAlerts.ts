import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { previewAgentAskRequest } from "../ask/preview.js";
import { insertSettlementRow, type AgentAskSettlementReceipt } from "../ask/settlement.js";
import type { ManagedProductionLaunchAttempt } from "./tick.js";
import { PRODUCTION_CONTROL_DEADLINES } from "./policy.js";
import { classifySession } from "./sessionSignals.js";
import type { TmuxAdapter } from "../sessions/index.js";

/**
 * Red alerts: managed-production failures that meet the Stop the line test
 * (docs/arcadia-semantics.md, "Red Alert"). Detection only: this module reads
 * what the worker tick already knows, makes no model call, and never changes
 * an admission decision, the concurrency gate, an approval boundary, or a
 * credential. Every entry point is wrapped by {@link safelyRaiseRedAlerts}'s
 * callers so an alerting failure is logged and swallowed, never the tick's.
 */

export const RED_ALERT_TRIGGERS = [
  "admission_refused_consecutive",
  "session_stalled",
  "reconcile_failed",
  "repair_budget_repeat"
] as const;
export type RedAlertTrigger = (typeof RED_ALERT_TRIGGERS)[number];

/** An admission must be refused this many consecutive ticks... */
export const ADMISSION_REFUSAL_MIN_TICKS = 5;
/** ...and for at least this long, so a brief capacity wait never alerts. */
export const ADMISSION_REFUSAL_MIN_MS = 10 * 60 * 1000;

export interface RedAlert {
  id: string;
  projectSlug: string;
  actionKey: string | null;
  sessionId: string | null;
  trigger: RedAlertTrigger;
  detail: string;
  evidencePath: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  requestId: string;
}

/**
 * `production_red_alerts` is read through `arcadia production status`'s
 * read-only connection, so it is also created by `applyInitialSchema`
 * (`src/db/schema.ts`); `listOpenRedAlerts` treats a missing table as empty.
 */
export function ensureRedAlertTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_red_alerts (
      id TEXT PRIMARY KEY,
      alert_key TEXT NOT NULL UNIQUE,
      project_slug TEXT NOT NULL,
      action_key TEXT,
      session_id TEXT,
      trigger TEXT NOT NULL,
      detail TEXT NOT NULL,
      evidence_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'cleared')),
      episode INTEGER NOT NULL DEFAULT 1,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      cleared_at TEXT,
      notified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS production_red_alert_streaks (
      project_slug TEXT PRIMARY KEY,
      action_key TEXT NOT NULL,
      ticks INTEGER NOT NULL,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL
    );
  `);
}

interface AlertRow {
  id: string;
  alert_key: string;
  project_slug: string;
  action_key: string | null;
  session_id: string | null;
  trigger: RedAlertTrigger;
  detail: string;
  evidence_path: string;
  status: "open" | "cleared";
  episode: number;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  notified_at: string | null;
}

function requestIdFor(row: Pick<AlertRow, "project_slug" | "id" | "episode">): string {
  return `red-alert-${row.project_slug}-${row.id}-e${row.episode}`;
}

function toAlert(row: AlertRow): RedAlert {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    actionKey: row.action_key,
    sessionId: row.session_id,
    trigger: row.trigger,
    detail: row.detail,
    evidencePath: row.evidence_path,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    occurrences: row.occurrences,
    requestId: requestIdFor(row)
  };
}

/** Every open red alert, oldest first. Safe on a read-only connection. */
export function listOpenRedAlerts(db: Database.Database): RedAlert[] {
  try {
    const rows = db
      .prepare("SELECT * FROM production_red_alerts WHERE status = 'open' ORDER BY first_seen_at ASC, id ASC")
      .all() as AlertRow[];
    return rows.map(toAlert);
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) return [];
    throw error;
  }
}

export interface RaiseRedAlertInput {
  workspace: string;
  projectSlug: string;
  actionKey: string | null;
  sessionId: string | null;
  trigger: RedAlertTrigger;
  /** Evaluated only when the alert is new or its evidence text changes need it; keep it cheap. */
  detail: () => string;
  now: Date;
}

function writeEvidence(workspace: string, row: AlertRow): void {
  mkdirSync(path.dirname(row.evidence_path), { recursive: true });
  writeFileSync(
    row.evidence_path,
    [
      `# Red alert ${row.id}`,
      "",
      `- Trigger: ${row.trigger}`,
      `- Project: ${row.project_slug}`,
      `- Action: ${row.action_key ?? "none"}`,
      `- Session: ${row.session_id ?? "none"}`,
      `- First seen: ${row.first_seen_at}`,
      `- Request id: ${requestIdFor(row)}`,
      "",
      "## Cause",
      "",
      row.detail,
      ""
    ].join("\n")
  );
}

/**
 * Queue one notification through the same durable path an `intent: log` Agent
 * Ask settlement uses: a recorded proposal plus a pending settlement row the
 * Discord bot delivers. It writes no managed document and touches no
 * repository, so a tick can enqueue it without dirtying a checkout.
 */
function enqueueNotification(db: Database.Database, row: AlertRow): void {
  const requestId = requestIdFor(row);
  const desired =
    `RED ALERT (${row.trigger}) on ${row.action_key ?? row.project_slug}` +
    `${row.session_id ? `, Session ${row.session_id}` : ""}: ${row.detail.split("\n")[0]} ` +
    `Evidence: file://${row.evidence_path}`;
  const request = JSON.stringify({
    agent_ask: "v1",
    request_id: requestId,
    project: row.project_slug,
    intent: "log",
    desired_result: desired
  });
  const { proposal } = previewAgentAskRequest(db, { request });
  const now = new Date().toISOString();
  const effects = ["Recorded a red alert notification; no Project document was written."];
  const receipt: AgentAskSettlementReceipt = {
    id: `asksettle_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    proposalId: proposal.id,
    proposalRequestId: requestId,
    settlementRequestId: `${requestId}-notify`,
    disposition: "accepted",
    projectSlug: row.project_slug,
    intent: "log",
    effects,
    queueActionKey: null,
    queueActionKeys: [],
    queuePosition: null,
    nextActionKey: null,
    previewFingerprint: proposal.fingerprint,
    applied: true,
    authority: { kind: "deterministic_proof", requestedAuthority: "propose", boundedPolicyDecision: null },
    notificationStatus: "pending",
    createdAt: now
  };
  insertSettlementRow(db, receipt, {
    proposalId: proposal.id,
    settlementRequestId: receipt.settlementRequestId,
    operation: { kind: "red_alert_notification", alertId: row.id },
    previewFingerprint: proposal.fingerprint,
    effects,
    queueActionKey: null,
    projectSlug: row.project_slug,
    now
  });
}

/**
 * Raise or refresh the red alert for one distinct failure. A failure already
 * open is updated (last seen, occurrence count) and never re-posted; a failure
 * that recurs after clearing opens a new episode and posts again.
 */
export function raiseRedAlert(db: Database.Database, input: RaiseRedAlertInput): { created: boolean; alert: RedAlert } {
  const subject = input.sessionId ?? input.actionKey ?? "project";
  const alertKey = `${input.trigger}:${input.projectSlug}:${subject}`;
  const id = `ra-${createHash("sha256").update(alertKey).digest("hex").slice(0, 12)}`;
  const at = input.now.toISOString();
  const existing = db.prepare("SELECT * FROM production_red_alerts WHERE alert_key = ?").get(alertKey) as AlertRow | undefined;
  let row: AlertRow;
  let created = false;
  if (existing && existing.status === "open") {
    db.prepare("UPDATE production_red_alerts SET last_seen_at = ?, occurrences = occurrences + 1 WHERE id = ?").run(at, existing.id);
    row = { ...existing, last_seen_at: at, occurrences: existing.occurrences + 1 };
  } else {
    created = true;
    const detail = input.detail();
    row = {
      id,
      alert_key: alertKey,
      project_slug: input.projectSlug,
      action_key: input.actionKey,
      session_id: input.sessionId,
      trigger: input.trigger,
      detail,
      evidence_path: path.join(input.workspace, "artifacts", "generated", "red-alerts", `${id}.md`),
      status: "open",
      episode: (existing?.episode ?? 0) + 1,
      occurrences: 1,
      first_seen_at: at,
      last_seen_at: at,
      notified_at: null
    };
    db.prepare(
      `INSERT INTO production_red_alerts
         (id, alert_key, project_slug, action_key, session_id, trigger, detail, evidence_path, status, episode, occurrences, first_seen_at, last_seen_at, cleared_at, notified_at)
       VALUES (@id, @alert_key, @project_slug, @action_key, @session_id, @trigger, @detail, @evidence_path, 'open', @episode, 1, @first_seen_at, @last_seen_at, NULL, NULL)
       ON CONFLICT(alert_key) DO UPDATE SET
         action_key = @action_key, session_id = @session_id, detail = @detail, evidence_path = @evidence_path, status = 'open',
         episode = @episode, occurrences = 1, first_seen_at = @first_seen_at, last_seen_at = @last_seen_at,
         cleared_at = NULL, notified_at = NULL`
    ).run(row);
    writeEvidence(input.workspace, row);
  }
  // An unsent notification (a first attempt that failed) is retried on the
  // next tick the failure is still seen; a sent one is never repeated.
  if (row.notified_at === null) {
    enqueueNotification(db, row);
    db.prepare("UPDATE production_red_alerts SET notified_at = ? WHERE id = ?").run(at, row.id);
  }
  return { created, alert: toAlert(row) };
}

/**
 * Clear open alerts of one trigger for a Project once the failure resolved.
 * `keepSubject` spares the alert whose Session or Action is still failing.
 */
export function clearRedAlerts(
  db: Database.Database,
  input: { projectSlug: string; trigger: RedAlertTrigger; keepSubject?: string | null; now: Date }
): number {
  const rows = db
    .prepare("SELECT id, session_id, action_key FROM production_red_alerts WHERE project_slug = ? AND trigger = ? AND status = 'open'")
    .all(input.projectSlug, input.trigger) as Array<{ id: string; session_id: string | null; action_key: string | null }>;
  let cleared = 0;
  for (const row of rows) {
    if (input.keepSubject && (row.session_id === input.keepSubject || row.action_key === input.keepSubject)) continue;
    db.prepare("UPDATE production_red_alerts SET status = 'cleared', cleared_at = ? WHERE id = ?").run(input.now.toISOString(), row.id);
    cleared += 1;
  }
  return cleared;
}

/** Run one alerting step; an error is logged and swallowed so it can never fail or slow the tick. */
export function safelyRaiseRedAlerts(log: (message: string) => void, label: string, step: () => void): void {
  try {
    step();
  } catch (error) {
    try {
      log(`Red alert ${label} failed (ignored): ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      // Logging itself must not throw into the tick.
    }
  }
}

interface AlertContext {
  db: Database.Database;
  workspace: string;
  projectSlug: string;
  now: Date;
}

/** Track consecutive refused admissions for a Project; raise past the minimum ticks and duration. */
export function observeAdmission(ctx: AlertContext, launch: ManagedProductionLaunchAttempt | null): void {
  if (!launch || launch.outcome === "skipped") return; // neutral: neither continues nor breaks a streak
  const { db, projectSlug, now } = ctx;
  if (launch.outcome !== "refused" || !launch.actionKey) {
    db.prepare("DELETE FROM production_red_alert_streaks WHERE project_slug = ?").run(projectSlug);
    clearRedAlerts(db, { projectSlug, trigger: "admission_refused_consecutive", now });
    return;
  }
  const at = now.toISOString();
  const streak = db.prepare("SELECT action_key, ticks, first_at FROM production_red_alert_streaks WHERE project_slug = ?").get(projectSlug) as
    | { action_key: string; ticks: number; first_at: string }
    | undefined;
  const continuing = streak !== undefined && streak.action_key === launch.actionKey;
  const ticks = continuing ? streak.ticks + 1 : 1;
  const firstAt = continuing ? streak.first_at : at;
  db.prepare(
    `INSERT INTO production_red_alert_streaks (project_slug, action_key, ticks, first_at, last_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_slug) DO UPDATE SET action_key = excluded.action_key, ticks = excluded.ticks, first_at = excluded.first_at, last_at = excluded.last_at`
  ).run(projectSlug, launch.actionKey, ticks, firstAt, at);
  clearRedAlerts(db, { projectSlug, trigger: "admission_refused_consecutive", keepSubject: launch.actionKey, now });
  if (ticks >= ADMISSION_REFUSAL_MIN_TICKS && now.getTime() - new Date(firstAt).getTime() >= ADMISSION_REFUSAL_MIN_MS) {
    raiseRedAlert(db, {
      workspace: ctx.workspace,
      projectSlug,
      actionKey: launch.actionKey,
      sessionId: null,
      trigger: "admission_refused_consecutive",
      detail: () => `Admission refused for ${ticks} consecutive ticks since ${firstAt}: ${launch.reason}`,
      now
    });
  }
}

/** A stalled live Session raises; anything else clears the Project's stall alerts. */
export function observeStall(
  ctx: AlertContext,
  input: { session: { id: string; action_id: string; tmux_session_name: string } | null; stalled: boolean; tmux: Pick<TmuxAdapter, "capturePane"> }
): void {
  const { db, projectSlug, now } = ctx;
  if (!input.session || !input.stalled) {
    clearRedAlerts(db, { projectSlug, trigger: "session_stalled", now });
    return;
  }
  const session = input.session;
  clearRedAlerts(db, { projectSlug, trigger: "session_stalled", keepSubject: session.id, now });
  raiseRedAlert(db, {
    workspace: ctx.workspace,
    projectSlug,
    actionKey: `${projectSlug}/${session.action_id}`,
    sessionId: session.id,
    trigger: "session_stalled",
    detail: () => {
      const classification = classifySession({
        process: { alive: true, exitStatus: null },
        paneText: input.tmux.capturePane ? input.tmux.capturePane(session.tmux_session_name) : null,
        stalled: true,
        git: { commitsAhead: 0, dirty: false },
        runStatus: null,
        preservation: null,
        draftedCompletion: false,
        pr: { state: null },
        claimHeld: true
      });
      return (
        `Session past its ${PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs}ms stall window ` +
        `(classified ${classification.state}: ${classification.reason}).`
      );
    },
    now
  });
}

export function observeReconcileFailure(
  ctx: AlertContext,
  input: { session: { id: string; action_id: string } | null; error: unknown }
): void {
  if (!input.session) return;
  raiseRedAlert(ctx.db, {
    workspace: ctx.workspace,
    projectSlug: ctx.projectSlug,
    actionKey: `${ctx.projectSlug}/${input.session.action_id}`,
    sessionId: input.session.id,
    trigger: "reconcile_failed",
    detail: () => `Reconciling Session ${input.session!.id} failed: ${input.error instanceof Error ? input.error.message : String(input.error)}`,
    now: ctx.now
  });
}

export function observeReconcileSuccess(ctx: AlertContext): void {
  clearRedAlerts(ctx.db, { projectSlug: ctx.projectSlug, trigger: "reconcile_failed", now: ctx.now });
}

/**
 * A launch failure repeating until the Action's repair budget is exhausted
 * raises; an alert whose budget was reset or whose Action launched clears.
 */
export function observeRepairBudget(ctx: AlertContext, launch: ManagedProductionLaunchAttempt | null): void {
  const { db, projectSlug } = ctx;
  const open = db
    .prepare("SELECT action_key FROM production_red_alerts WHERE project_slug = ? AND trigger = 'repair_budget_repeat' AND status = 'open'")
    .all(projectSlug) as Array<{ action_key: string }>;
  for (const row of open) {
    const attempts = db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?").get(row.action_key) as
      | { attempts: number }
      | undefined;
    if (!attempts || attempts.attempts < PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) {
      clearRedAlerts(db, { projectSlug, trigger: "repair_budget_repeat", now: ctx.now });
      break;
    }
  }
  if (!launch?.actionKey || (launch.outcome !== "failed" && launch.outcome !== "repair_budget_exhausted")) return;
  const attempts = db.prepare("SELECT attempts, last_error FROM production_repair_attempts WHERE action_key = ?").get(launch.actionKey) as
    | { attempts: number; last_error: string | null }
    | undefined;
  if (!attempts || attempts.attempts < PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) return;
  raiseRedAlert(db, {
    workspace: ctx.workspace,
    projectSlug,
    actionKey: launch.actionKey,
    sessionId: null,
    trigger: "repair_budget_repeat",
    detail: () => `Launch failed ${attempts.attempts} time(s), exhausting the repair budget; most recent error: ${attempts.last_error ?? launch.reason}`,
    now: ctx.now
  });
}
