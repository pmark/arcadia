import { readSync, writeSync } from "node:fs";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { createId } from "../utils/id.js";
import type { AgentSession } from "./index.js";

/**
 * The one-shot authorization a confirmed operator Launch records (Decision
 * 0096, option 1). It lets the host, when that Session exits and production is
 * not Active, validate, commit, push and (on accepted completion only) open a
 * DRAFT pull request for exactly that Action. Nothing here merges, integrates,
 * activates production or touches another Action.
 *
 * Who can mint one:
 * - the dashboard route's confirmed Launch (`source: "dashboard"`; the route
 *   spawns the CLI without a TTY, so the dashboard side passes the flag only
 *   after its confirmation step), and
 * - `arcadia session launch --operator-launch`, confirmed at an interactive
 *   terminal (`source: "cli_tty"`).
 * Never from inside an Arcadia Session (the launcher sets
 * {@link SESSION_ENV_MARKER} in every Session's environment) and never from a
 * non-interactive shell. This guards against accidental or routine agent
 * launches, not against a deliberately misbehaving local process.
 *
 * The row is bound to the Session (and so to its Action), expires after 24
 * hours, and is used up at the first exit; every mint and use writes an event.
 */

/** Set by the Session launcher in every managed Session's environment. */
export const SESSION_ENV_MARKER = "ARCADIA_SESSION_ID";
export const OPERATOR_LAUNCH_TTL_MS = 24 * 3_600_000;
/** How many times a failed draft-PR publication is retried after the exit. */
export const OPERATOR_LAUNCH_MAX_PUBLISH_ATTEMPTS = 3;

export type OperatorLaunchSource = "dashboard" | "cli_tty";
export type OperatorLaunchPublishState = "none" | "pending" | "done" | "failed";

export interface OperatorLaunchAuthorization {
  id: string;
  session_id: string;
  project_slug: string;
  plan_slug: string;
  action_id: string;
  repository_path: string;
  source: OperatorLaunchSource;
  request_id: string;
  minted_at: string;
  expires_at: string;
  used_at: string | null;
  outcome: string | null;
  publish_state: OperatorLaunchPublishState;
  publish_attempts: number;
  receipt_json: string | null;
}

export type OperatorLaunchAuthority =
  | { ok: true; authorization: OperatorLaunchAuthorization }
  | { ok: false; code: "none" | "wrong_session" | "wrong_action" | "expired" | "used"; reason: string };

export function ensureOperatorLaunchSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_launch_authorizations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      project_slug TEXT NOT NULL,
      plan_slug TEXT NOT NULL,
      action_id TEXT NOT NULL,
      repository_path TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('dashboard', 'cli_tty')),
      request_id TEXT NOT NULL,
      minted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      outcome TEXT,
      publish_state TEXT NOT NULL DEFAULT 'none' CHECK (publish_state IN ('none', 'pending', 'done', 'failed')),
      publish_attempts INTEGER NOT NULL DEFAULT 0,
      receipt_json TEXT
    );
  `);
}

function hasTable(db: Database.Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'operator_launch_authorizations'").get());
}

function recordEvent(db: Database.Database, eventType: string, payload: object, at: Date): void {
  db.prepare(
    `INSERT INTO events (id, event_type, source_module, project_id, work_item_id, artifact_id, review_item_id, payload_json, created_at)
       VALUES (@id, @event_type, 'operator_launch', NULL, NULL, NULL, NULL, @payload_json, @created_at)`
  ).run({
    id: createId("event"),
    event_type: eventType,
    payload_json: JSON.stringify({ schemaVersion: 1, ...payload }),
    created_at: at.toISOString()
  });
}

/** Refuses when this process is itself a managed Arcadia Session. */
export function refuseInsideArcadiaSession(env: NodeJS.ProcessEnv = process.env): void {
  const sessionId = env[SESSION_ENV_MARKER];
  if (sessionId) {
    throw validationError(
      `An operator launch authorization cannot be minted from inside an Arcadia Session (${SESSION_ENV_MARKER}=${sessionId}).`,
      { code: "operator_launch_inside_session", sessionId }
    );
  }
}

export interface TerminalIo {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  /** Writes the prompt and returns the typed line. */
  ask(prompt: string): string;
}

function systemTerminalIo(): TerminalIo {
  return {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    ask(prompt) {
      writeSync(2, prompt);
      const chunk = Buffer.alloc(1);
      let line = "";
      for (;;) {
        let read: number;
        try { read = readSync(0, chunk, 0, 1, null); } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EAGAIN") continue;
          if ((error as NodeJS.ErrnoException).code === "EOF") break;
          throw error;
        }
        if (read === 0 || chunk[0] === 10) break;
        line += String.fromCharCode(chunk[0]);
      }
      return line;
    }
  };
}

/**
 * `--operator-launch`'s confirmation: an interactive terminal, outside any
 * Arcadia Session, answering yes to the stated consequence. Returns the mint
 * source; throws (before anything is launched) otherwise.
 */
export function confirmOperatorLaunchAtTerminal(input: { actionLabel: string | (() => string); env?: NodeJS.ProcessEnv; io?: TerminalIo }): OperatorLaunchSource {
  refuseInsideArcadiaSession(input.env);
  const io = input.io ?? systemTerminalIo();
  if (!io.stdinIsTTY || !io.stdoutIsTTY) {
    throw validationError("--operator-launch must be confirmed at an interactive terminal; this shell is not interactive, so no authorization is minted and nothing is launched.", {
      code: "operator_launch_not_interactive"
    });
  }
  const answer = io.ask(
    `Authorize ${typeof input.actionLabel === "function" ? input.actionLabel() : input.actionLabel}: when this Session exits, Arcadia validates, commits and pushes its branch and, on accepted completion only, opens a DRAFT pull request, once, within 24 hours. It never merges. Launch with this authorization? [y/N] `
  ).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    throw validationError("The operator launch was not confirmed; nothing is launched and no authorization is minted.", { code: "operator_launch_unconfirmed" });
  }
  return "cli_tty";
}

/** Mint the one-shot authorization for a Session this confirmed Launch just created. */
export function mintOperatorLaunchAuthorization(
  db: Database.Database,
  input: { session: AgentSession; source: OperatorLaunchSource; requestId: string; env?: NodeJS.ProcessEnv; now?: Date }
): OperatorLaunchAuthorization {
  refuseInsideArcadiaSession(input.env);
  const now = input.now ?? new Date();
  ensureOperatorLaunchSchema(db);
  const existing = db.prepare("SELECT * FROM operator_launch_authorizations WHERE session_id = ?").get(input.session.id) as OperatorLaunchAuthorization | undefined;
  if (existing) return existing;
  const row: OperatorLaunchAuthorization = {
    id: createId("operatorLaunchAuthorization"),
    session_id: input.session.id,
    project_slug: input.session.project_slug,
    plan_slug: input.session.plan_slug,
    action_id: input.session.action_id,
    repository_path: input.session.repository_path,
    source: input.source,
    request_id: input.requestId,
    minted_at: now.toISOString(),
    expires_at: new Date(now.getTime() + OPERATOR_LAUNCH_TTL_MS).toISOString(),
    used_at: null,
    outcome: null,
    publish_state: "none",
    publish_attempts: 0,
    receipt_json: null
  };
  db.prepare(
    `INSERT INTO operator_launch_authorizations
       (id, session_id, project_slug, plan_slug, action_id, repository_path, source, request_id, minted_at, expires_at, publish_state, publish_attempts)
     VALUES (@id, @session_id, @project_slug, @plan_slug, @action_id, @repository_path, @source, @request_id, @minted_at, @expires_at, 'none', 0)`
  ).run(row);
  recordEvent(db, "operator_launch.authorization_minted", {
    authorizationId: row.id, sessionId: row.session_id, actionKey: `${row.project_slug}/${row.action_id}`,
    source: row.source, requestId: row.request_id, expiresAt: row.expires_at
  }, now);
  return row;
}

/** A Session that never started carries no authorization: remove its row and leave an `authorization_voided` event. */
export function voidOperatorLaunchAuthorization(db: Database.Database, sessionId: string, reason: string, now: Date = new Date()): void {
  const row = findOperatorLaunchAuthorization(db, sessionId);
  if (!row) return;
  db.prepare("DELETE FROM operator_launch_authorizations WHERE id = ?").run(row.id);
  recordEvent(db, "operator_launch.authorization_voided", {
    authorizationId: row.id, sessionId, actionKey: `${row.project_slug}/${row.action_id}`, source: row.source, reason
  }, now);
}

export function findOperatorLaunchAuthorization(db: Database.Database, sessionId: string): OperatorLaunchAuthorization | null {
  if (!hasTable(db)) return null;
  return (db.prepare("SELECT * FROM operator_launch_authorizations WHERE session_id = ?").get(sessionId) as OperatorLaunchAuthorization | undefined) ?? null;
}

/**
 * Whether `session` may be preserved under an operator launch authorization at
 * `now`: the row exists, names this exact Session and Action, has not expired,
 * and is either unused (the first exit) or still owes its draft PR.
 * `authorizationId` pins a specific row (a caller holding one); omitted, the
 * Session's own row is used.
 */
export function operatorLaunchAuthorityFor(db: Database.Database, session: AgentSession, now: Date, authorizationId?: string): OperatorLaunchAuthority {
  if (!hasTable(db)) return { ok: false, code: "none", reason: "No operator launch authorization exists for this Session." };
  const row = (authorizationId
    ? db.prepare("SELECT * FROM operator_launch_authorizations WHERE id = ?").get(authorizationId)
    : db.prepare("SELECT * FROM operator_launch_authorizations WHERE session_id = ?").get(session.id)) as OperatorLaunchAuthorization | undefined;
  if (!row) return { ok: false, code: "none", reason: "No operator launch authorization exists for this Session." };
  if (row.session_id !== session.id) {
    return { ok: false, code: "wrong_session", reason: `Operator launch authorization ${row.id} is bound to Session ${row.session_id}, not ${session.id}.` };
  }
  if (row.action_id !== session.action_id || row.project_slug !== session.project_slug || row.plan_slug !== session.plan_slug) {
    return { ok: false, code: "wrong_action", reason: `Operator launch authorization ${row.id} is bound to ${row.project_slug}/${row.action_id}, not ${session.project_slug}/${session.action_id}.` };
  }
  if (Number.isNaN(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= now.getTime()) {
    return { ok: false, code: "expired", reason: `Operator launch authorization ${row.id} expired at ${row.expires_at}.` };
  }
  if (row.used_at !== null && row.publish_state !== "pending") {
    return { ok: false, code: "used", reason: `Operator launch authorization ${row.id} was used at ${row.used_at}.` };
  }
  return { ok: true, authorization: row };
}

/**
 * Draft-PR publications owed after an exit, oldest first: those a failed PR
 * step left `pending`, and unused authorizations whose Session has since been
 * reconciled without the tick's exit handling (an operator ran `arcadia
 * session reconcile` by hand, or the tick died between reconcile and use). The
 * caller checks that such a Session is actually an accepted completion.
 */
export function listPendingOperatorLaunchPublications(db: Database.Database, repositoryPath: string): OperatorLaunchAuthorization[] {
  if (!hasTable(db)) return [];
  return db.prepare(
    `SELECT * FROM operator_launch_authorizations
      WHERE repository_path = ?
        AND ((publish_state = 'pending' AND publish_attempts < ?) OR (used_at IS NULL AND publish_state = 'none'))
      ORDER BY minted_at, rowid`
  ).all(repositoryPath, OPERATOR_LAUNCH_MAX_PUBLISH_ATTEMPTS) as OperatorLaunchAuthorization[];
}

export interface OperatorLaunchUse {
  outcome: string;
  publishState: OperatorLaunchPublishState;
  /** True when this call tried to open the draft PR (counts against the retry limit). */
  publishAttempted?: boolean;
  detail: Record<string, unknown>;
}

/**
 * Use the authorization up (the first call stamps `used_at`) and record what
 * the exit did with it. A `pending` publish state keeps it usable for the draft
 * PR retry only, up to {@link OPERATOR_LAUNCH_MAX_PUBLISH_ATTEMPTS}.
 */
export function recordOperatorLaunchUse(db: Database.Database, authorizationId: string, use: OperatorLaunchUse, now: Date): void {
  ensureOperatorLaunchSchema(db);
  const row = db.prepare("SELECT * FROM operator_launch_authorizations WHERE id = ?").get(authorizationId) as OperatorLaunchAuthorization | undefined;
  if (!row) return;
  const attempts = row.publish_attempts + (use.publishAttempted ? 1 : 0);
  const publishState = use.publishState === "pending" && attempts >= OPERATOR_LAUNCH_MAX_PUBLISH_ATTEMPTS ? "failed" : use.publishState;
  const usedAt = row.used_at ?? now.toISOString();
  const receipt = {
    authorizationId, sessionId: row.session_id, actionKey: `${row.project_slug}/${row.action_id}`, usedAt,
    ...use.detail, outcome: use.outcome, publishState, publishAttempts: attempts
  };
  db.prepare(
    `UPDATE operator_launch_authorizations
        SET used_at = @used_at, outcome = @outcome, publish_state = @publish_state,
            publish_attempts = @publish_attempts, receipt_json = @receipt_json
      WHERE id = @id`
  ).run({
    id: authorizationId, used_at: usedAt, outcome: use.outcome, publish_state: publishState,
    publish_attempts: attempts, receipt_json: JSON.stringify(receipt)
  });
  recordEvent(db, "operator_launch.authorization_used", receipt, now);
}
