import type Database from "better-sqlite3";
import { discoverDocs } from "../docs/discover.js";
import type { PlanActionDoc } from "../docs/types.js";
import { isAncestor, isPatchEquivalent, resolveBaseBranch } from "../git/worktrees.js";
import { canonicalPath, getSession, type AgentSession } from "../sessions/index.js";
import { developedForSupersededInput } from "../sessions/roleLineage.js";
import { readProductionPolicySafely } from "./policy.js";
import { REVIEW_REPAIR_ESCALATIONS, REVIEW_REPAIR_ROUNDS_EXHAUSTED } from "./reviewRepair.js";

/**
 * The one definition of "a terminal Session candidate that terminal recovery
 * still owns", shared by the tick's `recoverTerminalHandoff` and the
 * scheduler's pointer hold (Issue #1512) so the two can never disagree: the
 * scheduler holds the pointer exactly while recovery would act on the
 * candidate, and never for one recovery ignores.
 *
 * A Session qualifies when its worker-recorded exit (`worker-tick-reconcile-*`)
 * is an accepted completion, or an unsuperseded `incomplete_resumable` exit
 * whose candidate already carries the Action's recorded completion settlement
 * (Issue #994); its Action is not done in the base checkout; its branch has
 * not landed on the base branch; and it was not developed for a superseded
 * input of its Action (Issue #1158). An accepted exit a review repair Session
 * superseded (src/production/reviewRepair.ts) no longer qualifies: the repair
 * owns the Action now. Newest exit first. Read-only.
 */

/**
 * Operator decision 2026-10-21 (Release Manager session): an Action whose
 * review repair stopped for the operator (`review_repair_rounds_exhausted`,
 * `review_repair_gated`) is "held": its candidate stays preserved and
 * un-integrated until the operator acts, and it must not block admission of
 * in-scope Actions that do not depend on it. Returns that open escalation, or
 * null. Read-only; a missing table answers null.
 *
 * Issue #1929: the stop binds only the candidate it was recorded for. Once the
 * Action's input (criteria or packet) differs from that candidate's, or (for
 * spent repair rounds) the production run (epoch) has changed, the escalation
 * no longer holds the Action and a fresh attempt may be admitted. The
 * escalation row and its repair record are kept for history, never rewritten,
 * and no consumed allowance is reset: the new epoch's own repair-round bound
 * and the per-input attempt lineages still govern the fresh attempt.
 */
export function operatorHeldEscalation(db: Database.Database, actionKey: string, context: RepairStopContext = {}): { kind: string; firstDetectedAt: string } | null {
  const state = reviewRepairEscalationState(db, actionKey, context);
  return state && state.staleReason === null ? { kind: state.kind, firstDetectedAt: state.firstDetectedAt } : null;
}

/** What a caller knows about the Action now, so the staleness check need not rediscover it. */
export interface RepairStopContext {
  /** The checked-in repository, read only when `action` is not supplied. */
  repoRoot?: string | null;
  /** The Plan the Action is read from; defaults to the stopped candidate Session's Plan. */
  planSlug?: string | null;
  /** The Action as the base checkout defines it now. */
  action?: PlanActionDoc;
}

/**
 * This Action's open review repair escalation, with the reason it no longer
 * binds (`staleReason`), or null when there is none. A stop whose repair
 * record cannot be found, or whose staleness cannot be judged, stays binding
 * (fail closed). Read-only.
 */
export function reviewRepairEscalationState(
  db: Database.Database,
  actionKey: string,
  context: RepairStopContext = {}
): { kind: string; firstDetectedAt: string; staleReason: string | null } | null {
  let row: { kind: string; first_detected_at: string } | undefined;
  try {
    row = db.prepare("SELECT kind, first_detected_at FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as { kind: string; first_detected_at: string } | undefined;
  } catch { return null; }
  if (!row || !REVIEW_REPAIR_ESCALATIONS.has(row.kind)) return null;
  const stop = latestRepairStop(db, actionKey, row.kind === REVIEW_REPAIR_ROUNDS_EXHAUSTED ? "escalated" : "gated");
  return { kind: row.kind, firstDetectedAt: row.first_detected_at, staleReason: stop ? staleRepairStopReason(db, actionKey, stop, context) : null };
}

/** The fields of a stopped `production_review_repairs` row the staleness check reads. */
interface RepairStop { failed_session_id: string; policy_epoch: number; outcome: string }

function latestRepairStop(db: Database.Database, actionKey: string, outcome: "escalated" | "gated"): RepairStop | null {
  try {
    return (db.prepare(`SELECT failed_session_id, policy_epoch, outcome FROM production_review_repairs
      WHERE action_key = ? AND outcome = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get(actionKey, outcome) as RepairStop | undefined) ?? null;
  } catch { return null; }
}

/** The current production epoch, or null when the policy cannot be read. */
function currentProductionEpoch(db: Database.Database): number | null {
  const read = readProductionPolicySafely(db);
  return read.status === "ok" ? read.policy.epoch : null;
}

/** Spent repair rounds bind only the production run (epoch) that spent them. */
function epochStaleReason(stop: RepairStop, epoch: number | null): string | null {
  if (stop.outcome !== "escalated" || epoch === null || epoch === stop.policy_epoch) return null;
  return `its repair rounds were spent in production epoch ${stop.policy_epoch}, and production now runs epoch ${epoch}`;
}

/**
 * Why a stopped repair no longer binds its Action, or null while it does:
 * its repair rounds were spent in an earlier production epoch, or the stopped
 * candidate was developed for a superseded input of the Action (Issue #1158's
 * test). A gated stop is never released by an epoch change alone.
 */
function staleRepairStopReason(db: Database.Database, actionKey: string, stop: RepairStop, context: RepairStopContext): string | null {
  const byEpoch = epochStaleReason(stop, currentProductionEpoch(db));
  if (byEpoch) return byEpoch;
  const slash = actionKey.indexOf("/");
  if (slash < 1) return null;
  const projectSlug = actionKey.slice(0, slash);
  const actionId = actionKey.slice(slash + 1);
  let planSlug = context.planSlug ?? null;
  if (!planSlug) {
    try { planSlug = getSession(db, stop.failed_session_id)?.plan_slug ?? null; } catch { planSlug = null; }
  }
  if (!planSlug) return null;
  let action = context.action;
  if (!action && context.repoRoot) {
    try {
      const plan = discoverDocs(context.repoRoot).docs.find((doc) => doc.type === "plan" && doc.project === projectSlug && doc.slug === planSlug);
      action = plan?.type === "plan" ? plan.actions.find((entry) => entry.id === actionId) : undefined;
    } catch { action = undefined; }
  }
  if (!action || action.id !== actionId) return null;
  try {
    return developedForSupersededInput(db, { id: stop.failed_session_id, project_slug: projectSlug, plan_slug: planSlug, action_id: actionId }, action)
      ? "its stopped candidate was developed for a superseded input of the Action (criteria or packet changed)"
      : null;
  } catch { return null; }
}

/**
 * Why this Session's own spent-rounds repair stop no longer claims the
 * repository's handoff (a later production epoch), or null. Read-only.
 */
function candidateRepairStopStaleByEpoch(db: Database.Database, sessionId: string, epoch: number | null): string | null {
  if (epoch === null) return null;
  let stop: RepairStop | undefined;
  try {
    stop = db.prepare(`SELECT failed_session_id, policy_epoch, outcome FROM production_review_repairs
      WHERE failed_session_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get(sessionId) as RepairStop | undefined;
  } catch { return null; }
  return stop ? epochStaleReason(stop, epoch) : null;
}

export interface PendingTerminalCandidates {
  baseBranch: string;
  /** Qualifying Sessions, newest exit first. */
  pending: AgentSession[];
}

export function listPendingTerminalCandidates(
  db: Database.Database,
  repoRoot: string,
  projectSlug: string,
  options: {
    /** Only this Action's exits (filtered in SQL). Recovery passes none. */
    actionId?: string;
    /** Throw, rather than return null, when the base branch cannot be resolved. */
    strict?: boolean;
    onSuperseded?: (session: AgentSession, action: PlanActionDoc | undefined) => void;
    /** A candidate whose own spent-rounds repair stop belongs to an earlier production epoch (Issue #1929). */
    onStaleRepairStop?: (session: AgentSession, reason: string) => void;
  } = {}
): PendingTerminalCandidates | null {
  const hasExits = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_exit_receipts'").get();
  if (!hasExits) return null;
  const actionId = options.actionId ?? null;
  const exits = db.prepare(`SELECT r.session_id, r.outcome, r.evidence_json FROM session_exit_receipts r
    JOIN agent_sessions s ON s.id = r.session_id
    WHERE s.repository_path = ? AND s.project_slug = ?
      AND (? IS NULL OR s.action_id = ?)
      AND r.superseded_by_session_id IS NULL AND r.outcome IN ('accepted_completion', 'incomplete_resumable')
      AND r.request_id = ('worker-tick-reconcile-' || r.session_id)
    ORDER BY r.created_at DESC, r.rowid DESC`).all(canonicalPath(repoRoot), projectSlug, actionId, actionId) as Array<{ session_id: string; outcome: string; evidence_json: string | null }>;
  if (exits.length === 0) return null;

  let baseBranch: string;
  try {
    baseBranch = resolveBaseBranch(repoRoot);
  } catch (error) {
    if (options.strict) throw error;
    return null;
  }
  const docs = discoverDocs(repoRoot).docs;
  const basePlans = docs.filter((doc) => doc.type === "plan");
  // Recovery (no `actionId`) leaves a held Action's candidate to the operator
  // once the pointer has moved past it, so it neither refuses the handoff of
  // the Action now running nor makes two candidates "ambiguous". While the
  // pointer still names it, it stays the candidate recovery refuses today.
  const pointer = actionId === null ? docs.find((doc) => doc.type === "project" && doc.slug === projectSlug) : undefined;
  const pointerAction = pointer?.type === "project" ? pointer.currentAction : null;
  const epoch = currentProductionEpoch(db);
  const pending: AgentSession[] = [];
  for (const exit of exits) {
    const session = getSession(db, exit.session_id);
    if (!session) continue;
    // Issue #1615: a settled completion the host refused is the operator's, never recovery's to integrate.
    if (exit.evidence_json?.includes("completionSettlementNotInCandidate")) continue;
    const plan = basePlans.find((doc) => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug);
    const action = plan?.type === "plan" ? plan.actions.find((entry) => entry.id === session.action_id) : undefined;
    if (actionId === null && session.action_id !== pointerAction
      && operatorHeldEscalation(db, `${session.project_slug}/${session.action_id}`, { planSlug: session.plan_slug, action })) continue;
    if (action?.status === "done") continue;
    if (exit.outcome !== "accepted_completion" && !latestCandidateSettlementCommit(db, session, repoRoot)) continue;
    if (isAncestor(repoRoot, session.branch, baseBranch) || isPatchEquivalent(repoRoot, baseBranch, session.branch)) continue;
    if (developedForSupersededInput(db, session, action)) {
      options.onSuperseded?.(session, action);
      continue;
    }
    // Issue #1929: spent repair rounds bind only their own production run. In
    // a later epoch the stopped candidate stays preserved (its PR and repair
    // record untouched) and no longer claims the handoff, so the Action can be
    // admitted afresh under the development lineage's own bounds.
    const staleStop = candidateRepairStopStaleByEpoch(db, session.id, epoch);
    if (staleStop) {
      options.onStaleRepairStop?.(session, staleStop);
      continue;
    }
    pending.push(session);
  }
  return { baseBranch, pending };
}

export type TerminalCandidateCheck =
  | { kind: "none" }
  | { kind: "pending"; session: AgentSession }
  /** The check could not answer (Git or store failure); callers must hold, never treat it as "none". */
  | { kind: "unknown"; reason: string };

/**
 * The newest pending terminal candidate (per `listPendingTerminalCandidates`,
 * filtered to `actionId`) for the pointer hold. Fails closed: a failure to
 * answer is `unknown`, which holds the pointer exactly like a pending
 * candidate, so a Git or store fault never lets the scheduler commit a
 * pointer move under work recovery may still own.
 */
export function pendingTerminalCandidateFor(
  db: Database.Database,
  repoRoot: string,
  projectSlug: string,
  actionId: string
): TerminalCandidateCheck {
  try {
    const session = listPendingTerminalCandidates(db, repoRoot, projectSlug, { actionId, strict: true })?.pending[0];
    return session ? { kind: "pending", session } : { kind: "none" };
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The newest documents commit any applied completion settlement recorded on
 * this Session's branch (not yet on the base): for the remedy text, and to
 * recognise an unfinished exit whose candidate already settled its Action.
 */
export function latestCandidateSettlementCommit(db: Database.Database, session: AgentSession, repoRoot: string): string | null {
  try {
    const baseBranch = resolveBaseBranch(repoRoot);
    const rows = db.prepare(`SELECT s.receipt_json, p.proposal_json FROM agent_ask_settlements s
      JOIN agent_ask_proposals p ON p.id = s.proposal_id
      WHERE s.project_slug = ? AND s.disposition = 'accepted' AND p.intent_kind = 'complete'
      ORDER BY s.created_at DESC LIMIT 20`)
      .all(session.project_slug) as Array<{ receipt_json: string; proposal_json: string }>;
    const targets = new Set([`action/${session.action_id}`, `plan/${session.plan_slug}#${session.action_id}`]);
    for (const row of rows) {
      const receipt = JSON.parse(row.receipt_json) as { applied?: boolean; documentsCommit?: string | null };
      const targetRef = (JSON.parse(row.proposal_json) as { normalized?: { targetRef?: string | null } }).normalized?.targetRef;
      if (!receipt.applied || !receipt.documentsCommit || !targetRef || !targets.has(targetRef)) continue;
      // An earlier attempt's settlement already on the base is not this candidate's.
      if (isAncestor(session.worktree_path, receipt.documentsCommit, baseBranch)) continue;
      if (isAncestor(session.worktree_path, receipt.documentsCommit, "HEAD")) return receipt.documentsCommit;
    }
  } catch { /* the remedy then names no settlement commit */ }
  return null;
}
