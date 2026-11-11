import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { readProductionPolicySafely } from "../production/policy.js";
import { createId } from "../utils/id.js";
import { canonicalPath, getActiveActionClaim, getSession, releaseActionClaim, type TmuxAdapter } from "./index.js";
import { getSessionExitReceipt } from "./reconciliation.js";

/**
 * Issue #2490: a worker that never preserved its candidate leaves an
 * `incomplete_resumable` lease handoff that the tick resumes forever (the host
 * capture refuses the same tree each time). This is the one governed way to
 * retire exactly that handoff so the next tick dispatches the Action fresh.
 *
 * It only stops a resume. It never touches the worktree, branch, files, Agent
 * Asks or Plan documents; the candidate stays on disk for manual salvage. The
 * effect is one append-only receipt, one sentinel on the exit receipt's
 * `superseded_by_session_id`, and the release of the claim that candidate held
 * (the worktree reservation row stays, so `tidy` still protects the candidate).
 */
export type HandoffRetirementRefusalCode =
  | "session_unknown"
  | "not_incomplete_resumable"
  | "already_superseded"
  | "preserved_candidate"
  | "session_live"
  | "production_active"
  | "production_unknown"
  | "request_reused";

export interface HandoffRetirementRefusal { code: HandoffRetirementRefusalCode; reason: string }

export interface HandoffRetirementBinding {
  sessionId: string;
  requestId: string;
  reason: string;
  receiptId: string;
  receiptSha256: string;
  projectSlug: string;
  planSlug: string;
  actionId: string;
  repositoryPath: string;
  worktreePath: string;
  branch: string;
  baseRevision: string;
  candidateRevision: string | null;
  claimGeneration: string | null;
  sentinel: string;
}

export interface HandoffRetirementRecord {
  id: string;
  session_id: string;
  request_id: string;
  receipt_id: string;
  project_slug: string;
  plan_slug: string;
  action_id: string;
  repository_path: string;
  worktree_path: string;
  branch: string;
  base_revision: string;
  candidate_revision: string | null;
  claim_generation_released: string | null;
  sentinel: string;
  reason: string;
  fingerprint: string;
  created_at: string;
}

export interface HandoffRetirementPreview {
  ready: boolean;
  fingerprint: string | null;
  refusals: HandoffRetirementRefusal[];
  binding: HandoffRetirementBinding | null;
  /** Present when this Session is already retired; a same-request replay returns it. */
  retirement: HandoffRetirementRecord | null;
}

export interface HandoffRetirementInput {
  db: Database.Database;
  sessionId: string;
  requestId: string;
  reason: string;
  tmux: Pick<TmuxAdapter, "hasSession">;
  now?: Date;
}

const TABLE = "session_handoff_retirements";

export const retiredHandoffSentinel = (requestId: string) => `retired:${requestId}`;

export function ensureSessionHandoffRetirementTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id),
    request_id TEXT NOT NULL UNIQUE,
    receipt_id TEXT NOT NULL,
    project_slug TEXT NOT NULL,
    plan_slug TEXT NOT NULL,
    action_id TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    branch TEXT NOT NULL,
    base_revision TEXT NOT NULL,
    candidate_revision TEXT,
    claim_generation_released TEXT,
    sentinel TEXT NOT NULL,
    reason TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS ${TABLE}_no_update BEFORE UPDATE ON ${TABLE}
  BEGIN SELECT RAISE(ABORT, 'session handoff retirements are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS ${TABLE}_no_delete BEFORE DELETE ON ${TABLE}
  BEGIN SELECT RAISE(ABORT, 'session handoff retirements are append-only'); END;`);
}

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export function getHandoffRetirement(db: Database.Database, by: { sessionId?: string; requestId?: string }): HandoffRetirementRecord | null {
  if (!hasTable(db, TABLE)) return null;
  if (by.sessionId) return (db.prepare(`SELECT * FROM ${TABLE} WHERE session_id = ?`).get(by.sessionId) as HandoffRetirementRecord | undefined) ?? null;
  if (by.requestId) return (db.prepare(`SELECT * FROM ${TABLE} WHERE request_id = ?`).get(by.requestId) as HandoffRetirementRecord | undefined) ?? null;
  return null;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Read-only. Reports every refusal and, when none, the exact fingerprint an apply must carry. */
export function previewHandoffRetirement(input: HandoffRetirementInput): HandoffRetirementPreview {
  const now = input.now ?? new Date();
  const refusals: HandoffRetirementRefusal[] = [];
  const refuse = (code: HandoffRetirementRefusalCode, reason: string) => { refusals.push({ code, reason }); };
  const reason = input.reason.trim();
  if (!input.requestId.trim() || !reason) throw validationError("A retirement needs a non-empty --request-id and --reason.");

  const priorForSession = getHandoffRetirement(input.db, { sessionId: input.sessionId });
  const priorForRequest = getHandoffRetirement(input.db, { requestId: input.requestId });
  if (priorForRequest && priorForRequest.session_id !== input.sessionId) {
    refuse("request_reused", `Request id ${input.requestId} already retired Session ${priorForRequest.session_id}.`);
    return { ready: false, fingerprint: null, refusals, binding: null, retirement: null };
  }
  if (priorForSession) {
    // Already retired: a replay of the same request returns the stored receipt; any other request is refused.
    if (priorForSession.request_id !== input.requestId) {
      refuse("already_superseded", `Session ${input.sessionId} was already retired by request ${priorForSession.request_id}.`);
    }
    return { ready: false, fingerprint: priorForSession.fingerprint, refusals, binding: null, retirement: priorForSession };
  }

  const session = getSession(input.db, input.sessionId);
  if (!session) {
    refuse("session_unknown", `No Session ${input.sessionId} exists in this workspace.`);
    return { ready: false, fingerprint: null, refusals, binding: null, retirement: null };
  }
  const receipt = getSessionExitReceipt(input.db, session.id);
  if (!receipt || receipt.outcome !== "incomplete_resumable" || receipt.lease_handoff !== 1) {
    refuse("not_incomplete_resumable", `The Session's exit is ${receipt ? `${receipt.outcome}${receipt.lease_handoff ? "" : " (no lease handoff)"}` : "unrecorded"}, not an incomplete_resumable lease handoff.`);
  } else if (receipt.superseded_by_session_id) {
    refuse("already_superseded", `The handoff is already superseded by ${receipt.superseded_by_session_id}.`);
  }
  if (hasTable(input.db, "candidate_preservation_receipts")
    && input.db.prepare("SELECT 1 FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${session.id}`)) {
    refuse("preserved_candidate", "The candidate was preserved (a preservation receipt exists); resume or integrate it instead of retiring it.");
  }

  const live = input.db.prepare(`SELECT id FROM agent_sessions WHERE project_slug = ? AND plan_slug = ? AND action_id = ?
    AND status IN ('prepared', 'running')`).all(session.project_slug, session.plan_slug, session.action_id) as Array<{ id: string }>;
  if (live.length || input.tmux.hasSession(session.tmux_session_name)) {
    refuse("session_live", `A Session for this Action is prepared or running${live.length ? ` (${live.map(row => row.id).join(", ")})` : ""}, or the handoff's terminal is live.`);
  }

  // Off is the simplest sound state: while it holds nothing can be admitting or
  // resuming this Action, and the retirement lands before the next Start.
  const policy = readProductionPolicySafely(input.db);
  if (policy.status !== "ok") refuse("production_unknown", `Production state is unavailable: ${policy.reason}`);
  else if (policy.policy.desiredState === "active") refuse("production_active", "Production is Active; retire a handoff only while Production is Off.");

  const worktreePath = canonicalPath(session.worktree_path);
  const claim = getActiveActionClaim(input.db, session.repository_path, session.project_slug, session.action_id, now);
  const heldHere = claim?.claim_generation && canonicalPath(claim.worktree_path) === worktreePath ? claim.claim_generation : null;
  const binding: HandoffRetirementBinding = {
    sessionId: session.id,
    requestId: input.requestId,
    reason,
    receiptId: receipt?.id ?? "",
    receiptSha256: sha256(JSON.stringify(receipt)),
    projectSlug: session.project_slug,
    planSlug: session.plan_slug,
    actionId: session.action_id,
    repositoryPath: canonicalPath(session.repository_path),
    worktreePath,
    branch: session.branch,
    baseRevision: session.base_revision,
    candidateRevision: receipt?.candidate_revision ?? null,
    claimGeneration: heldHere,
    sentinel: retiredHandoffSentinel(input.requestId)
  };
  return { ready: refusals.length === 0, fingerprint: sha256(JSON.stringify(binding)), refusals, binding, retirement: null };
}

export interface HandoffRetirementResult { retirement: HandoffRetirementRecord; created: boolean }

/** Applies exactly the previewed retirement; a same-request, same-fingerprint repeat returns the same receipt. */
export function applyHandoffRetirement(input: HandoffRetirementInput & { fingerprint: string }): HandoffRetirementResult {
  return writeTransaction(input.db, () => {
    const preview = previewHandoffRetirement(input);
    if (preview.retirement) {
      if (preview.refusals.length === 0 && preview.retirement.fingerprint === input.fingerprint) return { retirement: preview.retirement, created: false };
      const first = preview.refusals[0];
      throw validationError(`Handoff retirement refused: ${first?.reason ?? "this Session already has a retirement under a different fingerprint."}`, {
        code: first?.code ?? "already_superseded", retirementId: preview.retirement.id
      });
    }
    const refusal = preview.refusals[0];
    if (refusal) throw validationError(`Handoff retirement refused: ${refusal.reason}`, { code: refusal.code, refusals: preview.refusals });
    if (preview.fingerprint !== input.fingerprint) {
      throw validationError("Handoff retirement refused: the bound facts (receipt, claim, reason or Session state) changed since the preview; preview again.", {
        code: "stale_preview", fingerprint: preview.fingerprint
      });
    }
    const binding = preview.binding!;
    const at = (input.now ?? new Date()).toISOString();
    // Fenced on the still-unsuperseded exit, so a resume that took the handoff
    // first makes this a refusal, never a second takeover.
    const superseded = input.db.prepare(`UPDATE session_exit_receipts SET superseded_by_session_id = ?, updated_at = ?
      WHERE id = ? AND outcome = 'incomplete_resumable' AND superseded_by_session_id IS NULL`).run(binding.sentinel, at, binding.receiptId);
    if (superseded.changes !== 1) {
      throw validationError("Handoff retirement refused: the handoff was superseded while retiring it; preview again.", { code: "stale_preview" });
    }
    // The old candidate's claim would otherwise refuse the fresh dispatch. The
    // fenced release clears claim columns only; the worktree reservation stays.
    let released: string | null = null;
    if (binding.claimGeneration && releaseActionClaim(input.db, {
      repositoryPath: binding.repositoryPath, project: binding.projectSlug, actionId: binding.actionId, generation: binding.claimGeneration
    })) released = binding.claimGeneration;
    const row: HandoffRetirementRecord = {
      id: createId("handoffRetirement"),
      session_id: binding.sessionId,
      request_id: binding.requestId,
      receipt_id: binding.receiptId,
      project_slug: binding.projectSlug,
      plan_slug: binding.planSlug,
      action_id: binding.actionId,
      repository_path: binding.repositoryPath,
      worktree_path: binding.worktreePath,
      branch: binding.branch,
      base_revision: binding.baseRevision,
      candidate_revision: binding.candidateRevision,
      claim_generation_released: released,
      sentinel: binding.sentinel,
      reason: binding.reason,
      fingerprint: input.fingerprint,
      created_at: at
    };
    input.db.prepare(`INSERT INTO ${TABLE}
      (id, session_id, request_id, receipt_id, project_slug, plan_slug, action_id, repository_path, worktree_path, branch,
       base_revision, candidate_revision, claim_generation_released, sentinel, reason, fingerprint, created_at)
      VALUES (@id, @session_id, @request_id, @receipt_id, @project_slug, @plan_slug, @action_id, @repository_path, @worktree_path, @branch,
       @base_revision, @candidate_revision, @claim_generation_released, @sentinel, @reason, @fingerprint, @created_at)`).run(row);
    return { retirement: row, created: true };
  });
}
