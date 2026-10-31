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
}
export function getTerminalClaimRecovery(db: Database.Database, sessionId: string): TerminalClaimRecoveryReceipt | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'terminal_claim_recoveries'").get()) return null;
  return db.prepare("SELECT * FROM terminal_claim_recoveries WHERE original_session_id = ?").get(sessionId) as TerminalClaimRecoveryReceipt | undefined ?? null;
}

export function getRecoveryForSuccessor(db: Database.Database, sessionId: string): TerminalClaimRecoveryReceipt | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'terminal_claim_recoveries'").get()) return null;
  return db.prepare("SELECT * FROM terminal_claim_recoveries WHERE successor_session_id = ?").get(sessionId) as TerminalClaimRecoveryReceipt | undefined ?? null;
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
  const latest = input.db.prepare("SELECT id FROM agent_sessions WHERE worktree_path = ? ORDER BY rowid DESC LIMIT 1")
    .get(session.worktree_path) as { id: string } | undefined;
  if (latest?.id !== (input.successorSessionId ?? session.id)) return refuse("another Session has used this candidate.");
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
  const liveness = probeWorktreeLiveness(candidate);
  if (!liveness.ok || liveness.processes.length) return refuse("candidate process liveness is active or uncertain.");
  return {
    sessionId: session.id, receiptSha256: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
    claimGeneration: claim.claim_generation, worktreePath: canonicalPath(candidate), branch: session.branch,
    baseRevision: session.base_revision, launchRevision: session.launch_revision
  };
}
