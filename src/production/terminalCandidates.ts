import type Database from "better-sqlite3";
import { discoverDocs } from "../docs/discover.js";
import type { PlanActionDoc } from "../docs/types.js";
import { isAncestor, isPatchEquivalent, resolveBaseBranch } from "../git/worktrees.js";
import { canonicalPath, getSession, type AgentSession } from "../sessions/index.js";
import { developedForSupersededInput } from "../sessions/roleLineage.js";

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
 * input of its Action (Issue #1158). Newest exit first. Read-only.
 */

export interface PendingTerminalCandidates {
  baseBranch: string;
  /** Qualifying Sessions, newest exit first. */
  pending: AgentSession[];
}

export function listPendingTerminalCandidates(
  db: Database.Database,
  repoRoot: string,
  projectSlug: string,
  options: { onSuperseded?: (session: AgentSession, action: PlanActionDoc | undefined) => void } = {}
): PendingTerminalCandidates | null {
  const hasExits = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_exit_receipts'").get();
  if (!hasExits) return null;
  const exits = db.prepare(`SELECT r.session_id, r.outcome FROM session_exit_receipts r
    JOIN agent_sessions s ON s.id = r.session_id
    WHERE s.repository_path = ? AND s.project_slug = ?
      AND (r.outcome = 'accepted_completion' OR (r.outcome = 'incomplete_resumable' AND r.superseded_by_session_id IS NULL))
      AND r.request_id = ('worker-tick-reconcile-' || r.session_id)
    ORDER BY r.created_at DESC, r.rowid DESC`).all(canonicalPath(repoRoot), projectSlug) as Array<{ session_id: string; outcome: string }>;
  if (exits.length === 0) return null;

  let baseBranch: string;
  try { baseBranch = resolveBaseBranch(repoRoot); } catch { return null; }
  const basePlans = discoverDocs(repoRoot).docs.filter((doc) => doc.type === "plan");
  const pending: AgentSession[] = [];
  for (const exit of exits) {
    const session = getSession(db, exit.session_id);
    if (!session) continue;
    const plan = basePlans.find((doc) => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug);
    const action = plan?.type === "plan" ? plan.actions.find((entry) => entry.id === session.action_id) : undefined;
    if (action?.status === "done") continue;
    if (exit.outcome !== "accepted_completion" && !latestCandidateSettlementCommit(db, session, repoRoot)) continue;
    if (isAncestor(repoRoot, session.branch, baseBranch) || isPatchEquivalent(repoRoot, baseBranch, session.branch)) continue;
    if (developedForSupersededInput(db, session, action)) {
      options.onSuperseded?.(session, action);
      continue;
    }
    pending.push(session);
  }
  return { baseBranch, pending };
}

/**
 * The newest pending terminal candidate (per `listPendingTerminalCandidates`)
 * for `actionId`, or null. Any failure reads as "none", so it never holds a
 * pointer on an unreadable store or repository.
 */
export function pendingTerminalCandidateFor(
  db: Database.Database,
  repoRoot: string,
  projectSlug: string,
  actionId: string
): AgentSession | null {
  try {
    return listPendingTerminalCandidates(db, repoRoot, projectSlug)?.pending.find((session) => session.action_id === actionId) ?? null;
  } catch {
    return null;
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
