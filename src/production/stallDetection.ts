import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { AgentSession, TmuxAdapter } from "../sessions/index.js";

export interface SessionActivityObservation {
  /** The Session shows no progress and has just crossed the stall deadline this tick. */
  newlyStalled: boolean;
  /** The Session was flagged stalled and has now shown new activity. */
  recovered: boolean;
  /** The Session is currently flagged stalled (true on the tick it was newly flagged, and every tick after until it recovers). */
  stalled: boolean;
}

function latestRunSignal(db: Database.Database, workItemId: string): { status: string | null; updatedAt: string | null } {
  const row = db
    .prepare("SELECT status, updated_at FROM execution_runs WHERE work_item_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(workItemId) as { status: string; updated_at: string } | undefined;
  return { status: row?.status ?? null, updatedAt: row?.updated_at ?? null };
}

function activitySignature(paneText: string | null, run: { status: string | null; updatedAt: string | null }): string {
  return createHash("sha256").update(`${paneText ?? ""}\u0000${run.status ?? ""}\u0000${run.updatedAt ?? ""}`).digest("hex");
}

/**
 * Observe whether a live (tmux-alive) managed Session has made any progress
 * since it was last observed, and flag it stalled once neither its tmux pane
 * output nor its Run/receipt state has changed for `deadlineMs`.
 *
 * This never touches `agent_sessions.status`, and therefore never releases
 * the repository lease that status holds (`getRepositoryLease` only reads
 * `status IN ('prepared', 'running')`) -- a suspected stall is exactly the
 * case where the lease must survive untouched, pending operator judgment or a
 * separately bounded repair, per this Action's own acceptance criteria. Only
 * a confirmed-dead tmux (the caller's other branch, `!tmux.hasSession(...)`)
 * goes through `reconcileSessionExit`.
 *
 * The very first observation of a Session establishes a baseline rather than
 * flagging it: a Session already mid-work when this check first runs against
 * it (e.g. right after this capability ships) has no prior signature to
 * compare against, and assuming "no prior signature" means "no progress"
 * would flag every live Session in the portfolio on the same tick.
 */
export function observeSessionActivity(
  db: Database.Database,
  session: AgentSession,
  tmux: Pick<TmuxAdapter, "capturePane">,
  now: Date,
  deadlineMs: number
): SessionActivityObservation {
  const paneText = tmux.capturePane ? tmux.capturePane(session.tmux_session_name) : null;
  const run = latestRunSignal(db, session.work_item_id);
  const signature = activitySignature(paneText, run);
  const nowIso = now.toISOString();

  if (session.last_activity_signature === null) {
    db.prepare(
      "UPDATE agent_sessions SET last_activity_at = ?, last_activity_signature = ?, updated_at = ? WHERE id = ?"
    ).run(nowIso, signature, nowIso, session.id);
    return { newlyStalled: false, recovered: false, stalled: false };
  }

  if (signature !== session.last_activity_signature) {
    const recovered = session.stall_flagged_at !== null;
    db.prepare(
      "UPDATE agent_sessions SET last_activity_at = ?, last_activity_signature = ?, stall_flagged_at = NULL, updated_at = ? WHERE id = ?"
    ).run(nowIso, signature, nowIso, session.id);
    return { newlyStalled: false, recovered, stalled: false };
  }

  const lastActivityMs = new Date(session.last_activity_at ?? nowIso).getTime();
  const elapsedMs = now.getTime() - lastActivityMs;
  if (elapsedMs < deadlineMs) {
    return { newlyStalled: false, recovered: false, stalled: false };
  }
  if (session.stall_flagged_at !== null) {
    return { newlyStalled: false, recovered: false, stalled: true };
  }
  db.prepare("UPDATE agent_sessions SET stall_flagged_at = ?, updated_at = ? WHERE id = ?").run(nowIso, nowIso, session.id);
  return { newlyStalled: true, recovered: false, stalled: true };
}
