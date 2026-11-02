import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { normalizeAgentAsk } from "../ask/agentAsk.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { createId } from "../utils/id.js";

/**
 * A Session's non-completion Ask draft (intent `proposal`) is a request for
 * consideration, never part of its candidate. Written under the candidate's
 * `.arcadia/asks/` it was committed by preservation, made the candidate
 * authority-adjacent and rode into its pull request (Issue #1988). It now
 * lands in a directory beside the worktree: outside the Git tree, so outside
 * any set preservation commits, and the worktree stays clean. The host reads it
 * at Session exit and records its text with the Session and Action, so it
 * survives the worktree's retirement. Recording settles and approves nothing.
 */
export const SESSION_PROPOSAL_DIRECTORY = ".arcadia-session-proposals";
export const SESSION_PROPOSAL_EVENT = "session.proposal_recorded";
const PROPOSAL_FILE = /^agent-ask-[a-z0-9][a-z0-9._-]*\.ya?ml$/;
const PROPOSAL_MAX_BYTES = 256 * 1024;

/** The directory holding proposal drafts for the candidate worktree rooted at `worktree`. */
export function sessionProposalDirectory(worktree: string): string {
  const root = path.resolve(worktree);
  return path.join(path.dirname(root), SESSION_PROPOSAL_DIRECTORY, path.basename(root));
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
  const directory = sessionProposalDirectory(session.worktree_path);
  if (!existsSync(directory) || !hasTable(db, "events")) return [];
  const recorded: RecordedSessionProposal[] = [];
  for (const name of readdirSync(directory).filter((entry) => PROPOSAL_FILE.test(entry)).sort()) {
    const file = path.join(directory, name);
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
