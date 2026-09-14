import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { isRequiresReviewValue } from "../domain/constants.js";
import { discoverDocs } from "../docs/discover.js";
import { resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import type { PlanDoc } from "../docs/types.js";
import { readProductionPolicySafely, type ProductionPolicyRecord } from "../production/policy.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { settleAgentAsk, type AgentAskSettlementReceipt } from "../ask/settlement.js";
import { git } from "../git/worktrees.js";
import { createId } from "../utils/id.js";
import { canonicalPath, getSession, type AgentSession } from "./index.js";

/**
 * The six outcomes a Session's exit must resolve to. A zero exit code alone
 * never implies `accepted_completion` -- that outcome requires the Action to
 * actually be `done` in the checked-in Plan, which only a real completion
 * writer (an accepted `complete` Agent Ask settlement) produces.
 */
export type SessionExitOutcome =
  | "successful_exit"
  | "failed_execution"
  | "missing_evidence"
  | "needs_input"
  | "incomplete_resumable"
  | "accepted_completion";

export interface SessionExitReceipt {
  id: string;
  session_id: string;
  request_id: string;
  outcome: SessionExitOutcome;
  reason: string;
  run_id: string | null;
  artifact_id: string | null;
  decision_id: string | null;
  candidate_revision: string | null;
  evidence_json: string | null;
  next_action_json: string;
  lease_handoff: number;
  superseded_by_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NextMoveSummary {
  kind: "next_action" | "operator_question" | "blocker" | "plan_complete" | "unknown";
  projectSlug: string | null;
  actionId: string | null;
  description: string;
  link: string | null;
  admitted: boolean;
}

/** Thin exit observation/receipt: the operational model this Action persists. */
export function ensureSessionExitReceiptsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_exit_receipts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      outcome TEXT NOT NULL CHECK (outcome IN (
        'successful_exit', 'failed_execution', 'missing_evidence',
        'needs_input', 'incomplete_resumable', 'accepted_completion'
      )),
      reason TEXT NOT NULL,
      run_id TEXT,
      artifact_id TEXT,
      decision_id TEXT,
      candidate_revision TEXT,
      evidence_json TEXT,
      next_action_json TEXT NOT NULL,
      lease_handoff INTEGER NOT NULL DEFAULT 0,
      superseded_by_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_exit_receipts_action
      ON session_exit_receipts(outcome, superseded_by_session_id);
  `);
}

function hasReceiptTable(db: Database.Database): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_exit_receipts'").get();
}

export function getSessionExitReceipt(db: Database.Database, sessionId: string): SessionExitReceipt | null {
  if (!hasReceiptTable(db)) return null;
  return (db.prepare("SELECT * FROM session_exit_receipts WHERE session_id = ?").get(sessionId) as SessionExitReceipt | undefined) ?? null;
}

/**
 * An unresolved `incomplete_resumable` receipt for a repository: the existing
 * repository lease (session status) held by that Session, kept alive for the
 * same Action's next Session per Decision 0051 rather than released to a
 * competing preparation. No new lease type -- this only reads the existing
 * `agent_sessions` row through the receipt's `session_id`.
 */
export function getResumableLeaseHandoff(
  db: Database.Database,
  repositoryPath: string
): { receipt: SessionExitReceipt; session: AgentSession } | null {
  if (!hasReceiptTable(db)) return null;
  const row = db.prepare(`
    SELECT r.* FROM session_exit_receipts r
    JOIN agent_sessions s ON s.id = r.session_id
    WHERE r.outcome = 'incomplete_resumable' AND r.superseded_by_session_id IS NULL
      AND s.repository_path = ?
    ORDER BY r.created_at DESC LIMIT 1
  `).get(canonicalPath(repositoryPath)) as SessionExitReceipt | undefined;
  if (!row) return null;
  const session = getSession(db, row.session_id);
  if (!session) return null;
  return { receipt: row, session };
}

/** Marks a prior resumable handoff as taken over by the newly prepared Session. */
export function supersedeLeaseHandoff(db: Database.Database, receiptId: string, newSessionId: string): void {
  db.prepare("UPDATE session_exit_receipts SET superseded_by_session_id = ?, updated_at = ? WHERE id = ?")
    .run(newSessionId, new Date().toISOString(), receiptId);
}

interface ExitEvidenceProbe {
  actionDoneInPlan: boolean;
  worktreeExists: boolean;
  candidateHasChanges: boolean;
  candidateRevision: string | null;
  runId: string | null;
  runFailed: boolean;
  artifactId: string | null;
  decisionId: string | null;
}

function probeExitEvidence(db: Database.Database, session: AgentSession, repoRoot: string): ExitEvidenceProbe {
  let actionDoneInPlan = false;
  const discovered = discoverDocs(repoRoot);
  const plan = discovered.docs.find(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug
  );
  const action = plan?.actions.find((candidate) => candidate.id === session.action_id);
  if (action?.status === "done") actionDoneInPlan = true;

  const worktreeExists = existsSync(session.worktree_path);
  let candidateHasChanges = false;
  let candidateRevision: string | null = null;
  if (worktreeExists) {
    try {
      candidateRevision = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
      const status = git(session.worktree_path, ["status", "--porcelain"]).trim();
      candidateHasChanges = candidateRevision !== session.base_revision || status.length > 0;
    } catch {
      candidateHasChanges = false;
    }
  }

  const run = db.prepare(
    "SELECT id, status FROM execution_runs WHERE work_item_id = ? ORDER BY updated_at DESC LIMIT 1"
  ).get(session.work_item_id) as { id: string; status: string } | undefined;
  // The most recent Run is always linked for audit purposes, whatever its
  // status -- but a deliberately failed or unreviewed Run must not count as
  // evidence of successful work, so `runFailed` gates classification
  // separately from `runId`, which callers use for the receipt's link.
  const runFailed = run?.status === "failed" || isRequiresReviewValue(run?.status);
  let artifactId: string | null = null;
  if (run) {
    const artifact = db.prepare(
      "SELECT artifact_id FROM run_artifacts WHERE run_id = ? ORDER BY rowid DESC LIMIT 1"
    ).get(run.id) as { artifact_id: string } | undefined;
    artifactId = artifact?.artifact_id ?? null;
  }

  const decision = db.prepare(
    "SELECT id FROM review_items WHERE project_id = ? AND status = 'approved' AND context_json LIKE ? ORDER BY created_at DESC LIMIT 1"
  ).get(session.project_id, `%"actionId":"${session.action_id}"%`) as { id: string } | undefined;

  return {
    actionDoneInPlan,
    worktreeExists,
    candidateHasChanges,
    candidateRevision,
    runId: run?.id ?? null,
    runFailed,
    artifactId,
    decisionId: decision?.id ?? null
  };
}

export function classifyExitOutcome(session: AgentSession, evidence: ExitEvidenceProbe): { outcome: SessionExitOutcome; reason: string } {
  if (evidence.actionDoneInPlan) {
    return { outcome: "accepted_completion", reason: "The Action is recorded done in the checked-in Plan." };
  }
  if (session.status === "needs_input") {
    return { outcome: "needs_input", reason: "The Session exited asking for operator or agent input." };
  }
  if (session.status === "failed") {
    return { outcome: "failed_execution", reason: "The Session was already marked failed." };
  }
  if (!evidence.worktreeExists) {
    return evidence.runId
      ? { outcome: "failed_execution", reason: "The Session's worktree is gone and no candidate can be resumed." }
      : { outcome: "missing_evidence", reason: "The Session's worktree is gone and no Run evidence was ever recorded." };
  }
  if (evidence.candidateHasChanges) {
    return { outcome: "incomplete_resumable", reason: "The Session exited with an unfinished candidate that can be resumed." };
  }
  if (session.exit_status !== null && session.exit_status !== 0) {
    return { outcome: "failed_execution", reason: `The Session exited with a nonzero status (${session.exit_status}).` };
  }
  if (evidence.runFailed) {
    return { outcome: "failed_execution", reason: "The most recently recorded Run did not pass; a failed or unreviewed Run is not evidence of successful work." };
  }
  if (!evidence.runId) {
    return { outcome: "missing_evidence", reason: "A zero exit status alone is not evidence of completed work; no Run was recorded." };
  }
  return { outcome: "successful_exit", reason: "The Session exited cleanly with recorded Run evidence, awaiting acceptance." };
}

export interface AutomaticCompletionAttempt {
  attempted: boolean;
  completed: boolean;
  reason: string;
  settlement: AgentAskSettlementReceipt | null;
}

function actionKeyFor(session: AgentSession): string {
  return `${session.project_slug}/${session.action_id}`;
}

function scopeAuthorizesAutomaticCompletion(policy: ProductionPolicyRecord, session: AgentSession): boolean {
  const scope = policy.scope;
  if (policy.desiredState !== "active" || !policy.authority || !scope) return false;
  return scope.projects.includes(session.project_slug)
    && scope.plans.includes(`${session.project_slug}/${session.plan_slug}`)
    && scope.actions.includes(actionKeyFor(session))
    && scope.mechanicalTransitions.includes("acceptance")
    && scope.mechanicalTransitions.includes("pointer");
}

/**
 * The missing core bridge: when a Session's candidate has a clean, passing
 * Run and the standing production policy explicitly names this exact
 * `<project>/<action>` and delegates both the "acceptance" and "pointer"
 * mechanical transitions to it, settle a `complete` Agent Ask on the
 * Session's own candidate rather than leaving the work committed but
 * unaccepted. The operator's own act of naming this Action in policy scope
 * is the review this function relies on -- it never derives "met" from the
 * criteria's own text (acceptanceCriteria.ts deliberately never does that),
 * so an Action outside the declared scope, or whose policy has lapsed, is
 * left for manual `agent-ask` settlement exactly as before.
 *
 * Idempotent by construction: the Agent Ask request id is derived from the
 * Session id alone, so a crash between settlement and this function's return,
 * or a second concurrent reconciliation, replays the identical settlement
 * receipt (`settleAgentAsk` dedupes by request id) instead of duplicating a
 * Log entry, Decision or pointer change. A candidate revision that changed
 * since evidence was probed, or a policy revision that changed between
 * attempts, refuses rather than binding stale evidence.
 */
export function attemptAutomaticCompletion(
  db: Database.Database,
  session: AgentSession,
  evidence: ExitEvidenceProbe
): AutomaticCompletionAttempt {
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok") {
    return { attempted: false, completed: false, reason: "Production policy is unavailable; automatic completion requires a readable policy.", settlement: null };
  }
  const policy = policyRead.policy;
  if (!scopeAuthorizesAutomaticCompletion(policy, session)) {
    return { attempted: false, completed: false, reason: "Standing production policy does not delegate mechanical acceptance and pointer transitions to this Action.", settlement: null };
  }
  if (!evidence.candidateRevision || !evidence.runId || evidence.runFailed) {
    return { attempted: false, completed: false, reason: "No passing Run evidence to bind automatic completion to.", settlement: null };
  }

  const worktree = session.worktree_path;
  let currentHead: string;
  try {
    currentHead = git(worktree, ["rev-parse", "HEAD"]).trim();
  } catch {
    return { attempted: true, completed: false, reason: "The Session's worktree could not be read to verify the candidate revision.", settlement: null };
  }
  if (currentHead !== evidence.candidateRevision) {
    return { attempted: true, completed: false, reason: "The candidate revision changed since evidence was probed; refusing to bind stale evidence.", settlement: null };
  }

  const discovered = discoverDocs(worktree);
  const plan = discovered.docs.find(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug
  );
  const action = plan?.actions.find((candidate) => candidate.id === session.action_id);
  if (!action) {
    return { attempted: true, completed: false, reason: "The Action was not found in the candidate's own Plan document.", settlement: null };
  }
  if (action.status === "done") {
    return { attempted: true, completed: false, reason: "The Action is already done; nothing to complete.", settlement: null };
  }
  if (action.acceptanceCriteria.length === 0) {
    return { attempted: true, completed: false, reason: "The Action declares no acceptance criteria to bind automatic evidence to.", settlement: null };
  }

  const requestId = `auto-complete-${session.id}`;
  const note = `Mechanically accepted: Session ${session.id} exited cleanly with a passing Run (${evidence.runId}) on candidate ${evidence.candidateRevision}, and standing production policy revision ${policy.revision} explicitly delegates mechanical acceptance and pointer transitions for ${actionKeyFor(session)}.`;
  const requestBody = {
    agent_ask: "v1",
    request_id: requestId,
    project: session.project_slug,
    intent: "complete",
    target_ref: `action/${session.action_id}`,
    desired_result: `Automatically accept mechanical completion for ${actionKeyFor(session)} under standing production policy.`,
    rationale: note,
    candidate_revision: evidence.candidateRevision,
    evidence: action.acceptanceCriteria.map((criterion) => ({ criterion, status: "met", note })),
    requested_authority: "apply_if_approved"
  };
  const request = JSON.stringify(requestBody);

  const askDir = path.join(worktree, ".arcadia", "asks");
  const askPath = path.join(askDir, `agent-ask-${requestId}.yaml`);
  try {
    if (!existsSync(askPath)) {
      mkdirSync(askDir, { recursive: true });
      writeFileSync(askPath, `${request}\n`, "utf8");
    }
    const proposal = previewAgentAskRequest(db, { request, requestId, project: session.project_slug, sourcePath: askPath });
    const preview = settleAgentAsk(db, {
      proposalRef: proposal.proposal.id, settlementRequestId: requestId, disposition: "accepted", cwd: worktree
    });
    const settlement = settleAgentAsk(db, {
      proposalRef: proposal.proposal.id, settlementRequestId: requestId, disposition: "accepted",
      previewFingerprint: preview.previewFingerprint, apply: true, operator: true, cwd: worktree
    });
    return { attempted: true, completed: true, reason: `Automatically completed under standing production policy revision ${policy.revision}.`, settlement };
  } catch (error) {
    return { attempted: true, completed: false, reason: `Automatic completion was refused: ${error instanceof Error ? error.message : String(error)}`, settlement: null };
  }
}

function terminalStatusFor(outcome: SessionExitOutcome): AgentSession["status"] {
  switch (outcome) {
    case "accepted_completion":
    case "successful_exit":
      return "completed";
    case "missing_evidence":
    case "failed_execution":
      return "failed";
    case "needs_input":
    case "incomplete_resumable":
      return "needs_input";
  }
}

function resolveNextMove(db: Database.Database, repoRoot: string, session: AgentSession, outcome: SessionExitOutcome): NextMoveSummary {
  const dispatch: DispatchResolution = resolveDispatch(repoRoot, session.project_slug);
  const policy = readProductionPolicySafely(db);
  const active = policy.status === "ok" && policy.policy.desiredState === "active";
  const admitted = outcome === "accepted_completion" && active;

  if (dispatch.operatorQuestion) {
    return {
      kind: "operator_question", projectSlug: session.project_slug, actionId: dispatch.context?.action.id ?? null,
      description: dispatch.operatorQuestion, link: `arcadia advance --project ${session.project_slug}`, admitted: false
    };
  }
  if (dispatch.blockers.length > 0) {
    return {
      kind: "blocker", projectSlug: session.project_slug, actionId: dispatch.context?.action.id ?? null,
      description: dispatch.blockers[0].message, link: `arcadia advance --project ${session.project_slug}`, admitted: false
    };
  }
  if (!dispatch.context) {
    return { kind: "unknown", projectSlug: session.project_slug, actionId: null, description: "No governed next Action resolved.", link: null, admitted: false };
  }
  if (dispatch.context.action.status === "done" && outcome !== "accepted_completion") {
    return {
      kind: "plan_complete", projectSlug: session.project_slug, actionId: dispatch.context.action.id,
      description: "The pointed Action is already done; the Plan or pointer needs to advance.",
      link: `arcadia advance --project ${session.project_slug}`, admitted: false
    };
  }
  return {
    kind: "next_action", projectSlug: session.project_slug, actionId: dispatch.context.action.id,
    description: dispatch.context.action.nextAction ?? dispatch.context.action.title,
    link: `arcadia advance --project ${session.project_slug}`, admitted
  };
}

export interface ReconcileSessionExitInput {
  db: Database.Database;
  sessionId: string;
  requestId: string;
  repoRoot: string;
}

export interface ReconcileSessionExitResult {
  receipt: SessionExitReceipt;
  nextMove: NextMoveSummary;
  created: boolean;
}

/**
 * Reconcile one Session's exit into a durable receipt and the resulting
 * canonical next move. Idempotent by `sessionId`: a Session already
 * reconciled returns its existing receipt unchanged, whatever `requestId`
 * is passed, so retry/reconcile/reload never duplicates a transition.
 */
export function reconcileSessionExit(input: ReconcileSessionExitInput): ReconcileSessionExitResult {
  const { db } = input;
  ensureSessionExitReceiptsTable(db);
  const session = getSession(db, input.sessionId);
  if (!session) throw validationError("The Session to reconcile was not found.", { sessionId: input.sessionId });

  const existing = getSessionExitReceipt(db, session.id);
  if (existing) {
    const nextMove = resolveNextMove(db, path.resolve(input.repoRoot), session, existing.outcome);
    return { receipt: existing, nextMove, created: false };
  }

  const byRequest = db.prepare("SELECT * FROM session_exit_receipts WHERE request_id = ?").get(input.requestId) as
    | SessionExitReceipt | undefined;
  if (byRequest) {
    const nextMove = resolveNextMove(db, path.resolve(input.repoRoot), session, byRequest.outcome);
    return { receipt: byRequest, nextMove, created: false };
  }

  const repoRoot = path.resolve(input.repoRoot);
  const evidence = probeExitEvidence(db, session, repoRoot);
  let { outcome, reason } = classifyExitOutcome(session, evidence);
  // Automatic completion settles onto the Session's own candidate worktree
  // (see attemptAutomaticCompletion), so once it succeeds the fresh Plan and
  // Project documents live there -- not necessarily at whatever `--repo` this
  // reconciliation was called against -- until that candidate is pushed and
  // merged. Resolve the next move against the worktree in that one case; every
  // other outcome keeps reading `repoRoot` exactly as before.
  let nextMoveRepoRoot = repoRoot;
  if (outcome === "successful_exit" || outcome === "incomplete_resumable") {
    const attempt = attemptAutomaticCompletion(db, session, evidence);
    if (attempt.completed) {
      outcome = "accepted_completion";
      reason = attempt.reason;
      nextMoveRepoRoot = session.worktree_path;
    }
  }
  const nextMove = resolveNextMove(db, nextMoveRepoRoot, session, outcome);
  const now = new Date().toISOString();
  const row: SessionExitReceipt = {
    id: createId("sessionExitReceipt"),
    session_id: session.id,
    request_id: input.requestId,
    outcome,
    reason,
    run_id: evidence.runId,
    artifact_id: evidence.artifactId,
    decision_id: evidence.decisionId,
    candidate_revision: evidence.candidateRevision,
    evidence_json: JSON.stringify(evidence),
    next_action_json: JSON.stringify(nextMove),
    lease_handoff: outcome === "incomplete_resumable" ? 1 : 0,
    superseded_by_session_id: null,
    created_at: now,
    updated_at: now
  };

  const terminal = terminalStatusFor(outcome);
  const write = db.transaction(() => {
    // Only a Session still holding its repository lease (prepared/running)
    // needs a terminal transition here; an already-terminal Session (e.g.
    // reconciled through the ordinary failed/completed paths) just gets its
    // thin receipt recorded.
    if (session.status === "prepared" || session.status === "running") {
      db.prepare("UPDATE agent_sessions SET status = ?, ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?")
        .run(terminal, now, now, session.id);
    }
    db.prepare(`INSERT INTO session_exit_receipts
      (id, session_id, request_id, outcome, reason, run_id, artifact_id, decision_id, candidate_revision, evidence_json, next_action_json, lease_handoff, superseded_by_session_id, created_at, updated_at)
      VALUES (@id, @session_id, @request_id, @outcome, @reason, @run_id, @artifact_id, @decision_id, @candidate_revision, @evidence_json, @next_action_json, @lease_handoff, @superseded_by_session_id, @created_at, @updated_at)`
    ).run(row);
  });
  write();

  return { receipt: row, nextMove, created: true };
}
