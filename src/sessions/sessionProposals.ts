import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { normalizeAgentAsk } from "../ask/agentAsk.js";
import { previewAgentAskRequest } from "../ask/preview.js";
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
 * from every headless Session: Codex `workspace-write` allows the worktree and
 * the temporary directories only (`src/sessions/index.ts` Codex launch), and
 * headless Claude's `acceptEdits` covers the working directory only, so a
 * sibling of the worktree is not. The host reads it at Session exit and records
 * its text with the Session and Action, so it survives the worktree's retirement.
 * Recording settles and approves nothing.
 *
 * The signal that a process is a launched Session is `ARCADIA_SESSION_ID`, set
 * by the host launch wrapper in the process environment (`SESSION_ENV_MARKER`);
 * no worktree file can set it. Outside a Session drafts keep their canonical path.
 */
export const SESSION_PROPOSAL_ROOT = "/tmp/arcadia-session-proposals";
export const SESSION_PROPOSAL_EVENT = "session.proposal_recorded";
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PROPOSAL_FILE = /^agent-ask-[a-z0-9][a-z0-9._-]*\.ya?ml$/;
const PROPOSAL_MAX_BYTES = 256 * 1024;

/** The launched Session's id from the host-set environment, or null outside a Session. */
export function launchedSessionId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env[SESSION_ENV_MARKER];
  return id && SESSION_ID.test(id) ? id : null;
}

/**
 * Every directory that may hold a Session's proposal drafts, in write order: `/tmp`
 * (the Codex `workspace-write` temporary root) then this process's temporary
 * directory (`$TMPDIR`, which a sandbox may allow when `/tmp` is denied). The
 * host reads all of them at exit.
 */
export function sessionProposalDirectories(sessionId: string): string[] {
  if (!SESSION_ID.test(sessionId)) throw new Error("Invalid Session id for a proposal directory.");
  return [...new Set([SESSION_PROPOSAL_ROOT, path.join(os.tmpdir(), "arcadia-session-proposals")])].map((root) => path.join(root, sessionId));
}

/** The first of {@link sessionProposalDirectories} that can be created (mode 0700), else the last error. */
export function ensureSessionProposalDirectory(sessionId: string): string {
  let failure: unknown;
  for (const directory of sessionProposalDirectories(sessionId)) {
    try { mkdirSync(directory, { recursive: true, mode: 0o700 }); return directory; } catch (error) { failure = error; }
  }
  throw failure;
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

/**
 * Record every proposal draft a Session left beside its worktree. Idempotent per
 * (Session, content). Best effort per file: an unreadable or invalid draft is
 * skipped and left on disk. Never settles, approves or changes a Project record.
 */
export function recordSessionProposals(db: Database.Database, session: SessionProposalSession): RecordedSessionProposal[] {
  if (!SESSION_ID.test(session.id) || !hasTable(db, "events")) return [];
  const files = sessionProposalDirectories(session.id).filter((directory) => existsSync(directory))
    .flatMap((directory) => readdirSync(directory).filter((entry) => PROPOSAL_FILE.test(entry)).sort().map((entry) => path.join(directory, entry)));
  const recorded: RecordedSessionProposal[] = [];
  for (const file of files) {
    let text: string;
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || statSync(file).size > PROPOSAL_MAX_BYTES) continue;
      text = readFileSync(file, "utf8");
    } catch { continue; }
    const sha256 = createHash("sha256").update(text).digest("hex");
    const prior = (db.prepare("SELECT id, payload_json FROM events WHERE event_type = ?").all(SESSION_PROPOSAL_EVENT) as Array<{ id: string; payload_json: string }>)
      .find((row) => { try { const p = JSON.parse(row.payload_json); return p.sessionId === session.id && p.sha256 === sha256; } catch { return false; } });
    let requestId: string;
    try { requestId = normalizeAgentAsk({ request: text }).requestId; } catch { continue; }
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
