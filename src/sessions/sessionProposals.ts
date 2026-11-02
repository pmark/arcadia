import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { normalizeAgentAsk } from "../ask/agentAsk.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { validationError } from "../cli/errors.js";
import { createId } from "../utils/id.js";
import { SESSION_ENV_MARKER } from "./operatorLaunch.js";

/**
 * A launched Session's non-completion Ask draft (intent `proposal`) is a request
 * for consideration, never part of its candidate. Written under the candidate's
 * `.arcadia/asks/` it was committed by preservation, made the candidate
 * authority-adjacent and rode into its pull request (Issue #1988).
 *
 * It now lands in `/tmp/arcadia-session-proposals/<session id>/`: outside the Git
 * tree, so outside the set preservation snapshots (`ls-files --cached --others
 * --exclude-standard`), and the worktree stays clean. That location is writable
 * from a headless Session: Codex `workspace-write` allows the worktree and
 * `/tmp` (`src/sessions/index.ts` Codex launch), and headless Claude's
 * `acceptEdits` covers the working directory only, so a sibling of the worktree
 * is not. There is one root and no fallback: a Session's `$TMPDIR` can differ
 * from the host's, so a second location would be silently unread. When the root
 * cannot be used, `draft` fails and names inline `agent-ask preview`; it never
 * writes into the candidate. The host reads it at Session exit and records
 * its text with the Session and Action, so it survives the worktree's retirement.
 * Recording settles and approves nothing.
 *
 * The signal that a process is a launched Session is `ARCADIA_SESSION_ID`, set
 * by the host launch wrapper in the process environment (`SESSION_ENV_MARKER`);
 * no worktree file can set it. Outside a Session drafts keep their canonical path.
 */
export const SESSION_PROPOSAL_ROOT = "/tmp/arcadia-session-proposals";
export const SESSION_PROPOSAL_EVENT = "session.proposal_recorded";
export const SESSION_PROPOSAL_SKIPPED_EVENT = "session.proposal_skipped";
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PROPOSAL_FILE = /^agent-ask-[a-z0-9][a-z0-9._-]*\.ya?ml$/;
export const PROPOSAL_MAX_BYTES = 256 * 1024;

/** The launched Session's id from the host-set environment, or null outside a Session. */
export function launchedSessionId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env[SESSION_ENV_MARKER];
  return id && SESSION_ID.test(id) ? id : null;
}

/** The directory holding proposal drafts for one Session under `root`. */
export function sessionProposalDirectory(sessionId: string, root: string = SESSION_PROPOSAL_ROOT): string {
  if (!SESSION_ID.test(sessionId)) throw new Error("Invalid Session id for a proposal directory.");
  return path.join(root, sessionId);
}

/** Why `directory` cannot be trusted as a proposal location, or null when it is a real directory owned by this user. */
function untrustedReason(directory: string): string | null {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink()) return "is a symbolic link";
  if (!stat.isDirectory()) return "is not a directory";
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return "is not owned by the current user";
  return null;
}

const INLINE_REMEDY = "Register the proposal inline instead: arcadia agent-ask preview '<json>' (intent proposal, requested_authority propose).";

/**
 * Create (mode 0700) and return the Session's proposal directory under `root`.
 * Refuses a symlinked root or session directory, or one owned by another user,
 * and any failure to write, with a message naming inline preview. Writes nothing
 * to the candidate.
 */
export function ensureSessionProposalDirectory(sessionId: string, root: string = SESSION_PROPOSAL_ROOT): string {
  const directory = sessionProposalDirectory(sessionId, root);
  const refuse = (cause: string): never => {
    throw validationError(`The Session proposal location ${directory} cannot be used: ${cause}. Nothing was written to your candidate. ${INLINE_REMEDY}`, { directory, cause, remedy: INLINE_REMEDY });
  };
  try {
    for (const component of [root, directory]) {
      mkdirSync(component, { mode: 0o700, recursive: component === root });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") refuse(error instanceof Error ? error.message : String(error));
  }
  for (const component of [root, directory]) {
    let reason: string | null;
    try { reason = untrustedReason(component); } catch (error) { return refuse(error instanceof Error ? error.message : String(error)); }
    if (reason) refuse(`${component} ${reason}`);
  }
  return directory;
}

export interface SessionProposalSession {
  id: string;
  project_id: string;
  project_slug: string;
  plan_slug: string;
  action_id: string;
  worktree_path: string;
}

export interface RecordedSessionProposal {
  requestId: string;
  sha256: string;
  eventId: string;
  receiptRecorded: boolean;
  replayed: boolean;
}

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function recordSkip(db: Database.Database, session: SessionProposalSession, file: string, reason: string): void {
  const seen = (db.prepare("SELECT payload_json FROM events WHERE event_type = ?").all(SESSION_PROPOSAL_SKIPPED_EVENT) as Array<{ payload_json: string }>)
    .some((row) => { try { const p = JSON.parse(row.payload_json); return p.sessionId === session.id && p.path === file && p.reason === reason; } catch { return false; } });
  if (seen) return;
  db.prepare("INSERT INTO events (id, event_type, source_module, project_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(createId("event"), SESSION_PROPOSAL_SKIPPED_EVENT, "sessions.sessionProposals", session.project_id, JSON.stringify({
      sessionId: session.id, project: session.project_slug, planSlug: session.plan_slug, actionId: session.action_id, path: file, reason
    }), new Date().toISOString());
}

/**
 * Record every proposal draft a launched Session left under `root`. Idempotent per
 * (Session, content). A draft that is not recorded (bad name, symlink, not a regular
 * file, oversize, unreadable, invalid Ask) leaves a visible `session.proposal_skipped`
 * event naming Session, Action, path and reason, and stays on disk. An untrusted root
 * (symlink, other owner) is never read. Never settles, approves or changes a Project record.
 */
export function recordSessionProposals(db: Database.Database, session: SessionProposalSession, root: string = SESSION_PROPOSAL_ROOT): RecordedSessionProposal[] {
  if (!SESSION_ID.test(session.id) || !hasTable(db, "events")) return [];
  const directory = sessionProposalDirectory(session.id, root);
  if (!existsSyncNoFollow(directory)) return [];
  for (const component of [root, directory]) {
    let reason: string | null;
    try { reason = untrustedReason(component); } catch (error) { reason = error instanceof Error ? error.message : String(error); }
    if (reason) { recordSkip(db, session, component, `untrusted proposal location: ${reason}`); return []; }
  }
  const recorded: RecordedSessionProposal[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const file = path.join(directory, entry);
    if (!PROPOSAL_FILE.test(entry)) { recordSkip(db, session, file, "name is not agent-ask-<request_id>.yaml"); continue; }
    let text: string;
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) { recordSkip(db, session, file, "is a symbolic link"); continue; }
      if (!stat.isFile()) { recordSkip(db, session, file, "is not a regular file"); continue; }
      if (stat.size > PROPOSAL_MAX_BYTES) { recordSkip(db, session, file, `exceeds ${PROPOSAL_MAX_BYTES} bytes`); continue; }
      text = readFileSync(file, "utf8");
    } catch (error) { recordSkip(db, session, file, `unreadable: ${error instanceof Error ? error.message : String(error)}`); continue; }
    const sha256 = createHash("sha256").update(text).digest("hex");
    let requestId: string;
    try { requestId = normalizeAgentAsk({ request: text }).requestId; }
    catch (error) { recordSkip(db, session, file, `invalid Agent Ask: ${error instanceof Error ? error.message : String(error)}`); continue; }
    const prior = (db.prepare("SELECT id, payload_json FROM events WHERE event_type = ?").all(SESSION_PROPOSAL_EVENT) as Array<{ id: string; payload_json: string }>)
      .find((row) => { try { const p = JSON.parse(row.payload_json); return p.sessionId === session.id && p.sha256 === sha256; } catch { return false; } });
    if (prior) { recorded.push({ requestId, sha256, eventId: prior.id, receiptRecorded: true, replayed: true }); continue; }
    let receiptRecorded = false;
    let receiptError: string | null = null;
    if (hasTable(db, "agent_ask_proposals")) {
      try { previewAgentAskRequest(db, { request: text, project: session.project_slug }); receiptRecorded = true; }
      catch (error) { receiptError = error instanceof Error ? error.message : String(error); }
    }
    const eventId = createId("event");
    db.prepare("INSERT INTO events (id, event_type, source_module, project_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(eventId, SESSION_PROPOSAL_EVENT, "sessions.sessionProposals", session.project_id, JSON.stringify({
        sessionId: session.id, project: session.project_slug, planSlug: session.plan_slug, actionId: session.action_id,
        requestId, sha256, text, receiptRecorded, receiptError,
        nonActions: ["Recording settles nothing.", "A proposal grants no approval or execution authority."]
      }), new Date().toISOString());
    recorded.push({ requestId, sha256, eventId, receiptRecorded, replayed: false });
  }
  return recorded;
}

function existsSyncNoFollow(target: string): boolean {
  try { lstatSync(target); return true; } catch { return false; }
}
