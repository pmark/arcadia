import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { tryGit } from "../git/worktrees.js";
import { canonicalPath, getActiveActionClaim, getSession, type TmuxAdapter } from "./index.js";
import { getSessionExitReceipt } from "./reconciliation.js";
import { probeWorktreeLiveness } from "./worktreeLiveness.js";

/** Explicit recovery identity, included in the operator-approved preview. */
export interface TerminalClaimRecovery {
  sessionId: string;
  receiptSha256: string;
  claimGeneration: string;
  worktreePath: string;
  branch: string;
  baseRevision: string;
  launchRevision: string;
}
export interface TerminalClaimRecoveryReceipt {
  original_session_id: string;
  successor_session_id: string;
  repository_path: string;
  request_id: string;
  preview_fingerprint: string;
  binding_json: string;
}
export function ensureTerminalClaimRecoveryTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS terminal_claim_recoveries (
    original_session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id),
    successor_session_id TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id),
    repository_path TEXT NOT NULL,
    request_id TEXT NOT NULL,
    preview_fingerprint TEXT NOT NULL,
    binding_json TEXT NOT NULL,
    UNIQUE(repository_path, request_id)
  )`);
  // Issue #1920: a later explicit recovery of the same original, recorded only
  // after every earlier successor has an append-only disposition. The first
  // recovery row above is never rewritten.
  db.exec(`CREATE TABLE IF NOT EXISTS terminal_claim_recovery_reattempts (
    successor_session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id),
    original_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    repository_path TEXT NOT NULL,
    request_id TEXT NOT NULL,
    preview_fingerprint TEXT NOT NULL,
    binding_json TEXT NOT NULL,
    UNIQUE(repository_path, request_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS ${DISPOSITION_TABLE} (
    id TEXT PRIMARY KEY,
    successor_session_id TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id),
    original_session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    repository_path TEXT NOT NULL,
    consumed_request_id TEXT NOT NULL,
    false_receipt_id TEXT,
    candidate_head TEXT NOT NULL,
    claim_generation TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    binding_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS ${DISPOSITION_TABLE}_no_update BEFORE UPDATE ON ${DISPOSITION_TABLE}
  BEGIN SELECT RAISE(ABORT, 'recovery successor dispositions are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS ${DISPOSITION_TABLE}_no_delete BEFORE DELETE ON ${DISPOSITION_TABLE}
  BEGIN SELECT RAISE(ABORT, 'recovery successor dispositions are append-only'); END;`);
}

const DISPOSITION_TABLE = "terminal_claim_recovery_dispositions";
const REATTEMPT_COLUMNS = "original_session_id, successor_session_id, repository_path, request_id, preview_fingerprint, binding_json";

/** Append-only record that a recovery successor failed before provider start (Issue #1920). */
export interface RecoverySuccessorDispositionRecord {
  id: string;
  successor_session_id: string;
  original_session_id: string;
  repository_path: string;
  consumed_request_id: string;
  false_receipt_id: string | null;
  candidate_head: string;
  claim_generation: string;
  fingerprint: string;
  binding_json: string;
  created_at: string;
}

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export function getRecoverySuccessorDisposition(db: Database.Database, successorSessionId: string): RecoverySuccessorDispositionRecord | null {
  if (!hasTable(db, DISPOSITION_TABLE)) return null;
  return db.prepare(`SELECT * FROM ${DISPOSITION_TABLE} WHERE successor_session_id = ?`).get(successorSessionId) as RecoverySuccessorDispositionRecord | undefined ?? null;
}

/** Every recovery recorded for an original, oldest first, disposed or not. */
export function listTerminalClaimRecoveries(db: Database.Database, originalSessionId: string): TerminalClaimRecoveryReceipt[] {
  if (!hasTable(db, "terminal_claim_recoveries")) return [];
  const first = db.prepare("SELECT * FROM terminal_claim_recoveries WHERE original_session_id = ?").all(originalSessionId) as TerminalClaimRecoveryReceipt[];
  const later = hasTable(db, "terminal_claim_recovery_reattempts")
    ? db.prepare(`SELECT ${REATTEMPT_COLUMNS} FROM terminal_claim_recovery_reattempts WHERE original_session_id = ? ORDER BY rowid`)
      .all(originalSessionId) as TerminalClaimRecoveryReceipt[]
    : [];
  return [...first, ...later];
}

/** The original's one recovery not yet disposed, if any. A disposed successor never blocks or binds a fresh recovery. */
export function getTerminalClaimRecovery(db: Database.Database, sessionId: string): TerminalClaimRecoveryReceipt | null {
  return listTerminalClaimRecoveries(db, sessionId).filter(row => !getRecoverySuccessorDisposition(db, row.successor_session_id)).at(-1) ?? null;
}

export function getRecoveryForSuccessor(db: Database.Database, sessionId: string): TerminalClaimRecoveryReceipt | null {
  if (!hasTable(db, "terminal_claim_recoveries")) return null;
  const first = db.prepare("SELECT * FROM terminal_claim_recoveries WHERE successor_session_id = ?").get(sessionId) as TerminalClaimRecoveryReceipt | undefined;
  if (first || !hasTable(db, "terminal_claim_recovery_reattempts")) return first ?? null;
  return db.prepare(`SELECT ${REATTEMPT_COLUMNS} FROM terminal_claim_recovery_reattempts WHERE successor_session_id = ?`)
    .get(sessionId) as TerminalClaimRecoveryReceipt | undefined ?? null;
}

/** A recovery request id stays consumed forever, even after its successor is disposed. */
export function findTerminalClaimRecoveryByRequest(db: Database.Database, repositoryPath: string, requestId: string): TerminalClaimRecoveryReceipt | null {
  if (!hasTable(db, "terminal_claim_recoveries")) return null;
  const first = db.prepare("SELECT * FROM terminal_claim_recoveries WHERE repository_path = ? AND request_id = ?")
    .get(repositoryPath, requestId) as TerminalClaimRecoveryReceipt | undefined;
  if (first || !hasTable(db, "terminal_claim_recovery_reattempts")) return first ?? null;
  return db.prepare(`SELECT ${REATTEMPT_COLUMNS} FROM terminal_claim_recovery_reattempts WHERE repository_path = ? AND request_id = ?`)
    .get(repositoryPath, requestId) as TerminalClaimRecoveryReceipt | undefined ?? null;
}

/** The first recovery goes to the original table; a later one only after every earlier successor is disposed. */
export function recordTerminalClaimRecovery(db: Database.Database, row: TerminalClaimRecoveryReceipt): void {
  if (findTerminalClaimRecoveryByRequest(db, row.repository_path, row.request_id)) {
    throw validationError("Terminal candidate recovery refused: this request id is already consumed by a recovery.");
  }
  const existing = listTerminalClaimRecoveries(db, row.original_session_id);
  if (existing.some(entry => !getRecoverySuccessorDisposition(db, entry.successor_session_id))) {
    throw validationError("Terminal candidate recovery refused: this Session already has a recovery successor.");
  }
  db.prepare(`INSERT INTO ${existing.length ? "terminal_claim_recovery_reattempts" : "terminal_claim_recoveries"}
    (${REATTEMPT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`).run(row.original_session_id, row.successor_session_id,
    row.repository_path, row.request_id, row.preview_fingerprint, row.binding_json);
}

/** Sessions that used the original's candidate after it, except failed-before-start successors disposed for this original. */
export function undisposedLaterCandidateSessions(db: Database.Database, original: { id: string; worktree_path: string }): string[] {
  const originalRow = db.prepare("SELECT rowid AS r FROM agent_sessions WHERE id = ?").get(original.id) as { r: number } | undefined;
  if (!originalRow) return [];
  return (db.prepare("SELECT id FROM agent_sessions WHERE worktree_path = ? AND rowid > ? ORDER BY rowid")
    .all(original.worktree_path, originalRow.r) as Array<{ id: string }>)
    .map(row => row.id).filter(id => getRecoverySuccessorDisposition(db, id)?.original_session_id !== original.id);
}

/** Positive no-op proof only. No status, receipt, attempt, claim or Git mutation. */
export function inspectTerminalClaimRecovery(input: {
  db: Database.Database; repoRoot: string; projectSlug: string; planSlug: string | null;
  actionId: string | null; sessionId: string;
  /** Only a durably bound, still-prepared successor may resume this handout. */
  successorSessionId?: string;
  packet: { invocationId: string; path: string; sha256: string } | null;
  tmux: Pick<TmuxAdapter, "hasSession">; now: Date;
}): TerminalClaimRecovery {
  const refuse = (reason: string): never => { throw validationError(`Terminal candidate recovery refused: ${reason}`); };
  const session = getSession(input.db, input.sessionId);
  if (!session || session.repository_path !== canonicalPath(input.repoRoot)
    || session.project_slug !== input.projectSlug || session.plan_slug !== input.planSlug || session.action_id !== input.actionId) {
    return refuse("the Session does not belong to this exact Project and Action.");
  }
  const recovered = getTerminalClaimRecovery(input.db, session.id);
  if (recovered && (recovered.successor_session_id !== input.successorSessionId
    || getSession(input.db, recovered.successor_session_id)?.status !== "prepared")) {
    return refuse("this Session already has a recovery successor; inspect that successor and its request receipt before any separately authorized repair. The candidate claim is retained.");
  }
  // A disposed failed-before-start successor of this original is not a later user of the candidate.
  const later = undisposedLaterCandidateSessions(input.db, session);
  if (later.length > 1 || (later[0] ?? null) !== (input.successorSessionId ?? null)) return refuse("another Session has used this candidate.");
  const receipt = getSessionExitReceipt(input.db, session.id);
  if (session.status !== "completed" || session.exit_status !== 0 || !session.ended_at
    || !receipt || receipt.candidate_revision !== session.launch_revision || receipt.outcome !== "successful_exit" || receipt.lease_handoff !== 0 || receipt.superseded_by_session_id) {
    return refuse("a completed exit-zero Session and an unchanged successful-exit receipt are required.");
  }
  if (!input.packet || session.packet_id !== input.packet.invocationId || session.packet_path !== input.packet.path
    || session.packet_sha256 !== input.packet.sha256) return refuse("the immutable packet changed.");
  const claim = getActiveActionClaim(input.db, input.repoRoot, input.projectSlug, session.action_id, input.now);
  if (!claim?.claim_generation || canonicalPath(claim.worktree_path) !== canonicalPath(session.worktree_path)
    || claim.branch !== session.branch) return refuse("the original candidate no longer owns this Action claim.");
  if (input.tmux.hasSession(session.tmux_session_name)) return refuse("the original Session is still live.");
  const candidate = session.worktree_path;
  const head = tryGit(candidate, ["rev-parse", "HEAD"]);
  const branch = tryGit(candidate, ["symbolic-ref", "--short", "HEAD"]);
  const status = tryGit(candidate, ["status", "--porcelain", "--untracked-files=all"]);
  const common = tryGit(candidate, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const repositoryCommon = tryGit(input.repoRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!session.launch_revision || head?.trim() !== session.launch_revision || status === null || status.trim()
    || branch?.trim() !== session.branch.replace(/^refs\/heads\//, "")
    || !common || !repositoryCommon || canonicalPath(common.trim()) !== canonicalPath(repositoryCommon.trim())) {
    return refuse("the candidate is changed, dirty, foreign or unreadable; HEAD must equal its launch revision.");
  }
  const liveness = probeWorktreeLiveness(candidate, { requireCompleteScan: true });
  if (!liveness.ok || liveness.processes.length) return refuse("candidate process liveness is active or uncertain.");
  return {
    sessionId: session.id, receiptSha256: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
    claimGeneration: claim.claim_generation, worktreePath: canonicalPath(candidate), branch: session.branch,
    baseRevision: session.base_revision, launchRevision: session.launch_revision
  };
}
