import type Database from "better-sqlite3";
import type { AgentSession, TmuxAdapter } from "../sessions/index.js";
import { PRODUCTION_CONTROL_DEADLINES, readProductionPolicySafely } from "./policy.js";
import { scanPane, type PaneSignalClass } from "./sessionSignals.js";

/**
 * Bounded Session lifetime: a Session can never hold the repository lease
 * indefinitely.
 *
 * Arcadia ends a live Session's tmux session when either
 *  1. its wall-clock limit has passed (per-launch `time_limit_ms`, else the
 *     active policy scope's `sessionTimeLimitMs`, else the built-in default --
 *     so an unreadable or Inactive policy still bounds it), or
 *  2. the pane classifier reports a blocking condition (permission prompt, auth
 *     failure, provider limit) that persisted past the stall deadline. Persisting
 *     is read from `observeSessionActivity`'s `stalled` flag: it is set only
 *     once neither the pane nor the Run has changed for the whole deadline, so a
 *     stale limit message above live, progressing output never trips it.
 *
 * Stopping is exactly `tmux kill-session`. The worktree and branch are never
 * touched. The tick's existing dead-session branch then preserves, reconciles
 * and releases the lease exactly as for any other exit; the reason recorded in
 * `agent_sessions.stop_reason` before the kill is copied onto the Session exit
 * receipt by `reconcileSessionExit`.
 */

/** Pane classes that a Session cannot resolve by itself or by waiting. */
export const BLOCKING_PANE_CLASSES: readonly PaneSignalClass[] = ["permission_prompt", "auth_failure", "provider_limit"];

export type SessionStopKind = "time_limit" | "blocking_signal";

export interface SessionStopDecision {
  kind: SessionStopKind;
  /** Human-readable reason, stored as `stop_reason` and shown on the exit receipt. */
  reason: string;
}

/** Per-launch override, else the active policy scope's value, else the default. Never throws. */
export function resolveSessionTimeLimitMs(db: Database.Database, session: Pick<AgentSession, "time_limit_ms">): number {
  if (session.time_limit_ms !== null && session.time_limit_ms !== undefined && session.time_limit_ms > 0) return session.time_limit_ms;
  const read = readProductionPolicySafely(db);
  const fromPolicy = read.status === "ok" ? read.policy.scope?.sessionTimeLimitMs : undefined;
  return fromPolicy && fromPolicy > 0 ? fromPolicy : PRODUCTION_CONTROL_DEADLINES.defaultSessionTimeLimitMs;
}

/**
 * Pure decision: should this live Session be ended now, and why. Time is
 * measured from `prepared_at`: that is when the repository lease is taken, and
 * it is stamped from the same injected clock as the tick (`started_at` is not).
 */
export function decideSessionStop(input: {
  session: Pick<AgentSession, "prepared_at">;
  now: Date;
  limitMs: number;
  /** `observeSessionActivity(...).stalled` this tick. */
  stalled: boolean;
  paneText: string | null;
  stallDeadlineMs?: number;
}): SessionStopDecision | null {
  const startedMs = new Date(input.session.prepared_at).getTime();
  const runningMs = input.now.getTime() - startedMs;
  if (Number.isFinite(runningMs) && runningMs >= input.limitMs) {
    return { kind: "time_limit", reason: `Session time limit of ${Math.round(input.limitMs / 60_000)} minutes reached (running ${Math.round(runningMs / 60_000)} minutes).` };
  }
  if (!input.stalled) return null;
  const scan = scanPane(input.paneText);
  const blocking = scan.classes.find((paneClass) => BLOCKING_PANE_CLASSES.includes(paneClass));
  if (!blocking) return null;
  const deadline = input.stallDeadlineMs ?? PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs;
  return {
    kind: "blocking_signal",
    reason: `Pane showed a ${blocking.replace("_", " ")} (${scan.matched.join(", ")}) with no progress for more than ${Math.round(deadline / 60_000)} minutes.`
  };
}

/**
 * Decide and, when warranted, end the Session: record `stop_reason`, then kill
 * its tmux session. Returns the decision when a stop was carried out, or null
 * (nothing to stop, or the adapter cannot kill). The caller records the event;
 * the next reconcile writes the receipt and releases the lease.
 */
export function enforceSessionLifetime(
  db: Database.Database,
  input: {
    session: AgentSession;
    tmux: Pick<TmuxAdapter, "capturePane" | "killSession">;
    now: Date;
    stalled: boolean;
    stallDeadlineMs?: number;
  }
): SessionStopDecision | null {
  if (!input.tmux.killSession) return null;
  const paneText = input.tmux.capturePane ? input.tmux.capturePane(input.session.tmux_session_name) : null;
  const decision = decideSessionStop({
    session: input.session,
    now: input.now,
    limitMs: resolveSessionTimeLimitMs(db, input.session),
    stalled: input.stalled,
    paneText,
    stallDeadlineMs: input.stallDeadlineMs
  });
  if (!decision) return null;
  // Written first: if the tick dies between here and the reconcile, the next
  // tick still finds the reason on the Session row.
  db.prepare("UPDATE agent_sessions SET stop_reason = ?, updated_at = ? WHERE id = ?").run(decision.reason, input.now.toISOString(), input.session.id);
  input.tmux.killSession(input.session.tmux_session_name);
  return decision;
}
