import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { isRequiresReviewValue } from "../domain/constants.js";
import { discoverDocs } from "../docs/discover.js";
import { resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import type { PlanDoc } from "../docs/types.js";
import { CLAUDE_CODE_SIGN_IN_REMEDY } from "../codingAgents/signIn.js";
import { scanPane } from "../production/sessionSignals.js";
import { sessionLogPath } from "./sessionRecording.js";
import { readProductionPolicySafely, releaseAdmission } from "../production/policy.js";
import { attemptAutoSettlePendingCompletion } from "../ask/autoSettleBeforeDispatch.js";
import type { AgentAskSettlementReceipt } from "../ask/settlement.js";
import { git } from "../git/worktrees.js";
import { createId } from "../utils/id.js";
import { canonicalPath, getSession, hasWorktreeReservationTable, type AgentSession } from "./index.js";
import { settleDevelopmentAttemptForExit } from "./roleLineage.js";

/** Databases opened by narrow fixtures may predate the attempt store. */
function hasRoleAttemptTable(db: Database.Database): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_role_attempts'").get() !== undefined;
}

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
  /** Mirrors the reconciled Session's `is_simulated`: 1 for a fixture-provider Session, so this receipt can never be cited as live proof. */
  is_simulated: number;
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
      is_simulated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_exit_receipts_action
      ON session_exit_receipts(outcome, superseded_by_session_id);
  `);
  const columns = new Set(
    (db.prepare("PRAGMA table_info(session_exit_receipts)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!columns.has("is_simulated")) {
    db.prepare(`ALTER TABLE session_exit_receipts ADD COLUMN is_simulated INTEGER NOT NULL DEFAULT 0`).run();
  }
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
    WHERE r.outcome = 'incomplete_resumable' AND r.lease_handoff = 1 AND r.superseded_by_session_id IS NULL
      AND s.repository_path = ?
    ORDER BY r.created_at DESC LIMIT 1
  `).get(canonicalPath(repositoryPath)) as SessionExitReceipt | undefined;
  if (!row) return null;
  const session = getSession(db, row.session_id);
  if (!session) return null;
  return { receipt: row, session };
}

/** Read the canonical handoff consumed by this Session, scoped to its exact candidate. */
export function getSessionContinuation(db: Database.Database, session: AgentSession): SessionExitReceipt | null {
  if (!hasReceiptTable(db)) return null;
  const rows = db.prepare(`
    SELECT * FROM session_exit_receipts
    WHERE superseded_by_session_id = ? AND outcome = 'incomplete_resumable' AND lease_handoff = 1
  `).all(session.id) as SessionExitReceipt[];
  if (rows.length > 1) throw validationError("The Session has ambiguous continuation receipts.", { sessionId: session.id });
  const receipt = rows[0];
  if (!receipt) return null;
  const previous = getSession(db, receipt.session_id);
  // Supersession also records replacement of a missing/invalid candidate.
  // That fresh worktree has no prior work to continue; preparation already
  // proved the old candidate unusable before allocating the replacement.
  if (previous && previous.worktree_path !== session.worktree_path) return null;
  if (!previous || previous.repository_path !== session.repository_path || previous.worktree_path !== session.worktree_path
    || previous.branch !== session.branch || previous.project_id !== session.project_id
    || previous.plan_slug !== session.plan_slug || previous.action_id !== session.action_id) {
    throw validationError("The Session continuation receipt does not match its candidate and Action.", { sessionId: session.id });
  }
  return receipt;
}

/** Marks a prior resumable handoff as taken over by the newly prepared Session. */
export function supersedeLeaseHandoff(db: Database.Database, receiptId: string, newSessionId: string): void {
  db.prepare("UPDATE session_exit_receipts SET superseded_by_session_id = ?, updated_at = ? WHERE id = ?")
    .run(newSessionId, new Date().toISOString(), receiptId);
}

/**
 * Undoes `supersedeLeaseHandoff`, fenced on the exact Session it was
 * superseded by: a launch that resumed a handoff and then itself failed
 * before ever reaching tmux (a withdrawn admission, a spawn failure) must not
 * leave the original candidate permanently invisible to
 * `getResumableLeaseHandoff` -- its worktree and real prior work are still
 * sitting there, unresumed, and a later tick needs to find it again. The
 * fence (`AND superseded_by_session_id = ?`) is a no-op if some other,
 * unrelated Session has since superseded it instead.
 */
export function restoreLeaseHandoffIfSupersededBy(db: Database.Database, receiptId: string, failedSessionId: string): void {
  db.prepare("UPDATE session_exit_receipts SET superseded_by_session_id = NULL, updated_at = ? WHERE id = ? AND superseded_by_session_id = ?")
    .run(new Date().toISOString(), receiptId, failedSessionId);
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

/** Starts the exit reason of a Session that died on provider authentication; the worker log keys on it. */
export const PROVIDER_SIGN_IN_FAILURE_PREFIX = "Provider sign-in failure";

/**
 * An unambiguous provider authentication failure in the Session's own log:
 * for Claude Code stream-json, a `result` event with `is_error: true` whose
 * text matches the shared `auth_failure` catalog (`sessionSignals.ts`). Only
 * that event counts, so a transcript that merely discusses authentication
 * never does. Null when the log is absent, unreadable or shows no such event.
 */
export function detectProviderSignInFailure(session: AgentSession, workspace: string | undefined): string | null {
  if (!workspace || session.provider !== "claude-code-cli") return null;
  let text: string;
  try {
    text = readFileSync(sessionLogPath(workspace, session.id), "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("{") || !line.includes('"result"')) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; is_error?: unknown; result?: unknown };
      if (event.type === "result" && event.is_error === true && typeof event.result === "string"
        && scanPane(event.result).classes.includes("auth_failure")) return event.result.trim();
    } catch { /* not a JSON event line */ }
  }
  return null;
}

export function classifyExitOutcome(session: AgentSession, evidence: ExitEvidenceProbe, signInFailure: string | null = null): { outcome: SessionExitOutcome; reason: string } {
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
  if (signInFailure && session.exit_status !== null && session.exit_status !== 0) {
    return {
      outcome: "failed_execution",
      reason: `${PROVIDER_SIGN_IN_FAILURE_PREFIX}: Claude Code reported "${signInFailure}" (exit status ${session.exit_status}) before doing any work. ${CLAUDE_CODE_SIGN_IN_REMEDY}`
    };
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


/**
 * The Action brief's completion protocol tells a Session to finish by settling
 * its own `complete` Agent Ask from inside its candidate worktree, which
 * commits the completion and pointer advance onto the candidate branch. The
 * base checkout's Plan cannot show that until the branch is integrated, so
 * without this the exit reads as `incomplete_resumable`, integration waits on
 * a completion that already happened, and the worker relaunches the finished
 * Action forever.
 *
 * Returns the settlement id only when all of this holds: the candidate is
 * clean, its own Plan records the Action done, and an accepted, applied
 * `complete` settlement for exactly this Project and Action exists whose
 * `candidate_revision` is an ancestor of (or equal to) the candidate's HEAD.
 * A hand-edited `status: done` has no settlement row, so it never passes.
 */
export function findCandidateSettledCompletion(
  db: Database.Database,
  session: AgentSession,
  candidateRevision: string | null
): { id: string; documentsCommit: string } | null {
  if (!existsSync(session.worktree_path) || !candidateRevision) return null;
  const worktree = session.worktree_path;
  try {
    if (git(worktree, ["status", "--porcelain"]).trim().length > 0) return null;
  } catch {
    return null;
  }
  const plan = discoverDocs(worktree).docs.find(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug
  );
  if (plan?.actions.find((candidate) => candidate.id === session.action_id)?.status !== "done") return null;

  const hasTables = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('agent_ask_settlements', 'agent_ask_proposals')").get() as { count: number };
  if (hasTables.count !== 2) return null;
  const rows = db.prepare(`SELECT s.id, s.receipt_json, p.proposal_json FROM agent_ask_settlements s
    JOIN agent_ask_proposals p ON p.id = s.proposal_id
    WHERE s.project_slug = ? AND s.disposition = 'accepted' AND p.intent_kind = 'complete'
    ORDER BY s.created_at DESC`).all(session.project_slug) as Array<{ id: string; receipt_json: string; proposal_json: string }>;
  const targets = new Set([`action/${session.action_id}`, `plan/${session.plan_slug}#${session.action_id}`]);
  for (const row of rows) {
    try {
      const receipt = JSON.parse(row.receipt_json) as AgentAskSettlementReceipt;
      const normalized = (JSON.parse(row.proposal_json) as { normalized?: { targetRef?: string | null; candidateRevision?: string | null } }).normalized;
      if (!receipt.applied || receipt.recovery?.documentsCommitted === false || !receipt.documentsCommit) continue;
      if (!normalized?.targetRef || !targets.has(normalized.targetRef) || !normalized.candidateRevision) continue;
      git(worktree, ["merge-base", "--is-ancestor", normalized.candidateRevision, candidateRevision]);
      // The settlement's own commit must be on this candidate: a settlement
      // recorded on another branch never vouches for this one.
      git(worktree, ["merge-base", "--is-ancestor", receipt.documentsCommit, candidateRevision]);
      // The evidence judged the work at `candidate_revision`. Anything the
      // candidate carries after it may only be the settlement's own managed
      // records -- never a change to the work that was accepted.
      const changedSince = git(worktree, ["diff", "--name-only", normalized.candidateRevision, candidateRevision])
        .split("\n").map((line) => line.trim()).filter(Boolean);
      if (changedSince.some((file) => !isSettlementRecordPath(file))) continue;
      return { id: row.id, documentsCommit: receipt.documentsCommit };
    } catch {
      continue;
    }
  }
  return null;
}

/** A completed worker Session whose exact settled candidate still exists. */
export function findAcceptedTerminalCompletion(
  db: Database.Database,
  session: AgentSession
): { exitId: string; candidateHead: string; settlementId: string } | null {
  const current = getSession(db, session.id);
  if (!current || current.status !== "completed" || current.worktree_path !== session.worktree_path
    || current.branch !== session.branch || current.packet_sha256 !== session.packet_sha256) return null;
  const exit = db.prepare(`SELECT id, candidate_revision FROM session_exit_receipts
    WHERE session_id = ? AND request_id = ? AND outcome = 'accepted_completion'`)
    .get(session.id, `worker-tick-reconcile-${session.id}`) as { id: string; candidate_revision: string | null } | undefined;
  if (!exit?.candidate_revision) return null;
  let candidateHead: string;
  try {
    candidateHead = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
    git(session.worktree_path, ["merge-base", "--is-ancestor", exit.candidate_revision, candidateHead]);
    if (git(session.worktree_path, ["symbolic-ref", "--short", "HEAD"]).trim() !== session.branch) return null;
  } catch { return null; }
  const settlement = findCandidateSettledCompletion(db, session, candidateHead);
  if (!settlement || settlement.documentsCommit !== candidateHead) return null;
  return { exitId: exit.id, candidateHead, settlementId: settlement.id };
}

/** The managed records a `complete` settlement writes and commits. */
function isSettlementRecordPath(file: string): boolean {
  return file === "PROJECT.md"
    || file === "MISSION_LOG.md"
    || file.startsWith("docs/plans/")
    || file.startsWith("docs/decisions/")
    || file.startsWith(".arcadia/asks/");
}

/**
 * A Session inside a provider sandbox (Codex `workspace-write`, Claude Code's
 * sandbox) can write only its worktree: it cannot commit (a linked worktree's
 * commits write the main repository's Git common directory) and cannot settle
 * (settlement writes the workspace database). The most it can do is draft its
 * `complete` Ask into `.arcadia/asks/` -- which `agent-ask draft` supports
 * with no workspace -- and exit. Host preservation then commits the candidate,
 * draft included.
 *
 * Settle that draft here, on the host, onto the candidate branch, through the
 * same deterministic settler dispatch already uses for a draft left in the
 * base checkout (`attemptAutoSettlePendingCompletion`): its evidence must
 * cover every criterion verbatim and `met`, its revision must still be in the
 * candidate's history, and settlement refuses a dirty candidate. Returns the
 * settlement id, or null to leave the exit classified as it was.
 */
function settleCandidateDraftedCompletion(db: Database.Database, session: AgentSession, evidence: ExitEvidenceProbe): string | null {
  if (!evidence.worktreeExists) return null;
  const worktree = session.worktree_path;
  const plan = discoverDocs(worktree).docs.find(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug
  );
  const action = plan?.actions.find((candidate) => candidate.id === session.action_id);
  if (!action || action.status === "done" || action.acceptanceCriteria.length === 0) return null;
  const result = attemptAutoSettlePendingCompletion(db, {
    repoRoot: worktree,
    projectSlug: session.project_slug,
    activePlanSlug: session.plan_slug,
    action: { id: action.id, acceptanceCriteria: action.acceptanceCriteria },
    // Host preservation has already committed exactly the tree the Session
    // left, draft included, so that commit is what its evidence describes.
    evidencedRevision: evidence.candidateRevision
  });
  return result.settled ? result.receiptId ?? "unknown" : null;
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
  /**
   * Set when a caller has already decided this Session's candidate must not
   * be offered to a future `prepareSession` call for automatic resumption --
   * e.g. an identical-preservation-refusal budget was exhausted, so resuming
   * would only reproduce the same failure. The outcome this reconciliation
   * writes is unaffected (still `incomplete_resumable` when the evidence says
   * so: the candidate's work is genuinely incomplete); only `lease_handoff`
   * is forced to 0, and `getResumableLeaseHandoff` only ever returns a
   * receipt with `lease_handoff = 1`. Has no effect on an outcome other than
   * `incomplete_resumable`, which was never resumable to begin with.
   */
  suppressLeaseHandoff?: { reason: string };
  /** The workspace, so the Session's provider log can be read to name a provider sign-in failure. */
  workspace?: string;
  /** Extra receipt accounting, committed atomically with terminal state and the receipt.
   * Called once for a new receipt inside its SQLite transaction; never on replay. */
  onReceiptWrite?: (receipt: SessionExitReceipt) => void;
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
  const signInFailure = detectProviderSignInFailure(session, input.workspace);
  let { outcome, reason } = classifyExitOutcome(session, evidence, signInFailure);
  // Proven completion settles onto the Session's own candidate worktree,
  // so once it succeeds the fresh Plan and
  // Project documents live there -- not necessarily at whatever `--repo` this
  // reconciliation was called against -- until that candidate is pushed and
  // merged. Resolve the next move against the worktree in that one case; every
  // other outcome keeps reading `repoRoot` exactly as before.
  let nextMoveRepoRoot = repoRoot;
  if (outcome === "successful_exit" || outcome === "incomplete_resumable") {
    const settled = findCandidateSettledCompletion(db, session, evidence.candidateRevision);
    const drafted = settled ? null : settleCandidateDraftedCompletion(db, session, evidence);
    const attempt = settled
      ? { completed: true, reason: `The Session settled its own governed completion on its candidate (settlement ${settled.id}).` }
      : drafted
        ? { completed: true, reason: `Settled the Session's drafted complete Ask on its candidate (settlement ${drafted}).` }
        : { completed: false, reason: "Completion requires a canonical settlement or a drafted complete Ask with criterion-level evidence; a Run alone does not prove acceptance." };
    if (attempt.completed) {
      outcome = "accepted_completion";
      reason = attempt.reason;
      nextMoveRepoRoot = session.worktree_path;
    } else {
      reason = `${reason} ${attempt.reason}`;
    }
  }
  // Arcadia itself ended this Session (time limit or a persistent blocking pane
  // signal; see `src/production/sessionLifetime.ts`): the receipt says why.
  if (session.stop_reason && outcome !== "accepted_completion") {
    reason = `Stopped by Arcadia: ${session.stop_reason} ${reason}`;
  }
  const nextMove = resolveNextMove(db, nextMoveRepoRoot, session, outcome);
  const now = new Date().toISOString();
  const suppressHandoff = outcome === "incomplete_resumable" && input.suppressLeaseHandoff;
  const row: SessionExitReceipt = {
    id: createId("sessionExitReceipt"),
    session_id: session.id,
    request_id: input.requestId,
    outcome,
    reason: suppressHandoff ? `${reason} ${input.suppressLeaseHandoff!.reason}` : reason,
    run_id: evidence.runId,
    artifact_id: evidence.artifactId,
    decision_id: evidence.decisionId,
    candidate_revision: evidence.candidateRevision,
    evidence_json: JSON.stringify({
      ...evidence,
      ...(session.stop_reason ? { stopReason: session.stop_reason } : {}),
      ...(signInFailure && reason.startsWith(PROVIDER_SIGN_IN_FAILURE_PREFIX) ? { providerFailure: { kind: "sign_in", provider: session.provider, message: signInFailure } } : {})
    }),
    next_action_json: JSON.stringify(nextMove),
    lease_handoff: outcome === "incomplete_resumable" && !suppressHandoff ? 1 : 0,
    superseded_by_session_id: null,
    is_simulated: session.is_simulated ? 1 : 0,
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
      // Give the standing-policy admission slot back the moment this Session
      // reaches a terminal outcome, in the same transaction as the status
      // transition -- otherwise a committed admission with nothing left to run
      // stays "committed" until its host process is restarted, permanently
      // occupying a concurrency slot (Issue #610).
      if (session.admission_request_id) {
        releaseAdmission(db, session.admission_request_id, new Date(now));
      }
    }
    // A Session that ended without leaving anything to resume must give its
    // Action claim back too. Otherwise the claim outlives it for its full TTL,
    // every relaunch of the same Action is refused as "already claimed by a
    // live worktree", and two refusals exhaust the repair budget -- one
    // provider hiccup at start-up stops the Action. Only the claim columns
    // are cleared: the worktree reservation row still protects the (clean)
    // worktree from `tidy`, exactly as `releaseActionClaim` does.
    if ((outcome === "missing_evidence" || outcome === "failed_execution") && !evidence.candidateHasChanges && hasWorktreeReservationTable(db)) {
      db.prepare(`UPDATE agent_worktree_reservations
        SET project = NULL, action_id = NULL, claim_generation = NULL
        WHERE repository_path = ? AND worktree_path = ? AND project = ? AND action_id = ?`)
        .run(canonicalPath(session.repository_path), canonicalPath(session.worktree_path), session.project_slug, session.action_id);
    }
    db.prepare(`INSERT INTO session_exit_receipts
      (id, session_id, request_id, outcome, reason, run_id, artifact_id, decision_id, candidate_revision, evidence_json, next_action_json, lease_handoff, superseded_by_session_id, is_simulated, created_at, updated_at)
      VALUES (@id, @session_id, @request_id, @outcome, @reason, @run_id, @artifact_id, @decision_id, @candidate_revision, @evidence_json, @next_action_json, @lease_handoff, @superseded_by_session_id, @is_simulated, @created_at, @updated_at)`
    ).run(row);
    // The development attempt's terminal state commits with this receipt or
    // not at all, so a restart either replays both or neither; a resumable
    // exit leaves the attempt live for the next launch to resume.
    if (hasRoleAttemptTable(db)) settleDevelopmentAttemptForExit(db, { session, outcome, exitReceiptId: row.id, now: new Date(now) });
    input.onReceiptWrite?.(row);
  });
  write();

  return { receipt: row, nextMove, created: true };
}
