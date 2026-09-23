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

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Observe whether a live (tmux-alive) managed Session has made any progress
 * since it was last observed, and flag it stalled once neither its tmux pane
 * scrollback nor its Run/receipt state has changed for `deadlineMs`.
 *
 * Pane and Run signals are tracked as two independent signatures, never
 * merged into one hash. A tick where `capturePane` is unavailable or fails
 * returns `null`, which contributes no pane signal at all that tick -- it can
 * never look like "the pane went blank" (spuriously clearing a stall flag) or
 * "definitely no output" (spuriously starting or extending a stall) on its
 * own. A confirmed stall or confirmed activity always requires the Run/receipt
 * signal to agree, or the pane signal to agree, on their own separate terms.
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
 *
 * Callers should run this and any resulting event write inside one write
 * transaction (see `runManagedProductionTick`): if the event insert for a
 * newly-flagged stall fails, the flag write must roll back with it, or a
 * later tick would see `stall_flagged_at` already set and never retry the
 * event.
 */
export function observeSessionActivity(
  db: Database.Database,
  session: AgentSession,
  tmux: Pick<TmuxAdapter, "capturePane">,
  now: Date,
  deadlineMs: number
): SessionActivityObservation {
  const paneText = tmux.capturePane ? tmux.capturePane(session.tmux_session_name) : null;
  const paneSignature = paneText === null ? null : hashOf(paneText);
  const run = latestRunSignal(db, session.work_item_id);
  const runSignature = hashOf(`${run.status ?? ""}\u0000${run.updatedAt ?? ""}`);
  const nowIso = now.toISOString();

  if (session.last_activity_at === null) {
    db.prepare(
      "UPDATE agent_sessions SET last_activity_at = ?, last_pane_signature = ?, last_run_signature = ?, updated_at = ? WHERE id = ?"
    ).run(nowIso, paneSignature, runSignature, nowIso, session.id);
    return { newlyStalled: false, recovered: false, stalled: false };
  }

  // A capture failure/unavailability (paneSignature === null) never counts as
  // a pane change -- only a *successful* capture that differs from the last
  // one does. And a successful capture only counts as a change when there was
  // a prior successful capture to differ from: if every earlier tick's
  // capture failed (`last_pane_signature` still null), this tick's capture is
  // establishing the pane baseline for the first time, not observing new
  // output -- exactly like the very first observation above.
  const paneEstablishesBaseline = paneSignature !== null && session.last_pane_signature === null;
  const paneChanged = paneSignature !== null && session.last_pane_signature !== null && paneSignature !== session.last_pane_signature;
  const runChanged = runSignature !== session.last_run_signature;

  if (paneChanged || runChanged) {
    const recovered = session.stall_flagged_at !== null;
    db.prepare(
      "UPDATE agent_sessions SET last_activity_at = ?, last_pane_signature = ?, last_run_signature = ?, stall_flagged_at = NULL, updated_at = ? WHERE id = ?"
    ).run(nowIso, paneSignature ?? session.last_pane_signature, runSignature, nowIso, session.id);
    return { newlyStalled: false, recovered, stalled: false };
  }

  if (paneEstablishesBaseline) {
    // Record the baseline without touching the activity clock or an existing
    // stall flag -- neither is evidence one way or the other yet.
    db.prepare("UPDATE agent_sessions SET last_pane_signature = ?, updated_at = ? WHERE id = ?").run(paneSignature, nowIso, session.id);
    return { newlyStalled: false, recovered: false, stalled: session.stall_flagged_at !== null };
  }

  const lastActivityMs = new Date(session.last_activity_at).getTime();
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
