import { MAX_ARMED_HORIZON_MS, type ArmedWake, type BlockerClass, type IdleFrontRow } from "./idleFront.js";
import { blockerRemedyFor } from "./blockerRemedies.js";

/**
 * The Momentum Keeper's always-on alarm (Decision 0188 answered B; Issue #2231).
 *
 * `arcadia production liveness-check` runs once a minute on its launchd timer,
 * outside every agent session. After its own worker check it runs this: the
 * idle-front row (Layer 1, `idleFront.ts`) and the keeper's armed-until
 * heartbeat file (deferral D2) become two alarms, each paging once when its
 * episode opens and once when it closes:
 *
 * - **Idle**: the critical path has been idle for at least the threshold while
 *   a run window is open.
 * - **Keeper**: no Momentum Keeper heartbeat is live while a run window is open.
 *
 * Pure: every input is passed in. It calls no model, starts nothing and grants
 * nothing; under Decision 0188 only Rowan or the operator starts a keeper
 * (Decision 0114), so the keeper alarm says how and never does it.
 */

export const MOMENTUM_STATE_SCHEMA = "arcadia-momentum-watch-v1" as const;
/**
 * 20 minutes: the keeper's front 0 routes a block its owner left unrouted
 * after 10 minutes (Decision 0188), and a route needs about as long again to
 * land as a ready tap or admitted work. Past both, a human should know. It is
 * well clear of the 5-minute between-ticks grace (`ACTIVE_IDLE_GRACE_MS`) and
 * below the 30 minutes a day that revives the keeper role under its sunset rule.
 */
export const MOMENTUM_DEFAULT_IDLE_MINUTES = 20;
/** Under the between-ticks grace an Active run reads as moving, so a smaller threshold means nothing. */
export const MOMENTUM_MIN_IDLE_MINUTES = 5;
/** The armed-wake `role` a Momentum Keeper heartbeat carries. */
export const KEEPER_ROLE = "momentum-keeper" as const;
/** The keeper's heartbeat file inside the armed-wakes directory. One keeper at a time. */
export const KEEPER_HEARTBEAT_FILE = "momentum-keeper.json" as const;
/** The keeper's 55-minute fallback wake, rounded up: a refresh at every wake keeps it live. */
export const KEEPER_DEFAULT_HEARTBEAT_MINUTES = 60;
export const KEEPER_MAX_HEARTBEAT_MINUTES = MAX_ARMED_HORIZON_MS / 60_000;
/**
 * Past `armedUntil`, how long a waking keeper gets to take its turn and
 * refresh before the alarm: a wake at the fallback, a slow turn or a model
 * retry fit in 10 minutes; a dead session does not.
 */
export const KEEPER_DEFAULT_GRACE_MINUTES = 10;

export interface AlertSlot {
  open: { alertedAt: string; pingId: string; key: string } | null;
  /** When this alarm's last episode closed; an outbox row at or before it is another episode's. */
  closedAt: string | null;
}

export interface MomentumWatchState {
  schema: typeof MOMENTUM_STATE_SCHEMA;
  idle: AlertSlot;
  keeper: AlertSlot;
}

export function emptyMomentumState(): MomentumWatchState {
  return { schema: MOMENTUM_STATE_SCHEMA, idle: { open: null, closedAt: null }, keeper: { open: null, closedAt: null } };
}

/**
 * When a keeper must be live and idle time counts. Open while production is
 * Active, and while it is Off with a scope Action (active or retained) not yet
 * merged: that is the critical path waiting, usually on a START card. Closed
 * when production is Off with nothing waiting, so a finished run and a quiet
 * night page nobody. Unknown when production cannot be read; the worker check
 * already pages a policy that cannot be read while it may be Active.
 */
export type RunWindow = { open: boolean | null; reason: string };

export function runWindowOf(row: IdleFrontRow): RunWindow {
  if (row.critical_path.state === "unreadable") return { open: null, reason: "Production state is unreadable" };
  if (row.critical_path.desired_state === "active") return { open: true, reason: "Production is Active" };
  if (row.ready_actions !== null && row.ready_actions > 0) {
    return { open: true, reason: `Production is Off with ${row.ready_actions} scope Action${row.ready_actions === 1 ? "" : "s"} not merged` };
  }
  return { open: false, reason: "Production is Off and no scope Action is waiting" };
}

export type IdleObservation =
  | { kind: "idle"; minutes: number }
  | { kind: "clear"; reason: "moving" | "window_closed" }
  /** Holds whatever is open: an unknown is never read as all clear, and never pages on its own. */
  | { kind: "unknown"; reason: string };

export function observeIdle(row: IdleFrontRow, window: RunWindow, thresholdMinutes: number): IdleObservation {
  if (window.open === null) return { kind: "unknown", reason: window.reason };
  if (window.open === false) return { kind: "clear", reason: "window_closed" };
  if (row.idle_minutes === null) return { kind: "unknown", reason: row.notes.join(" ") || "Idle minutes are unknown" };
  return row.idle_minutes >= thresholdMinutes ? { kind: "idle", minutes: row.idle_minutes } : { kind: "clear", reason: "moving" };
}

export interface KeeperHeartbeat {
  session: string | null;
  armedAt: string | null;
  armedUntil: string;
  evidence: string;
}

export type KeeperObservation =
  | { kind: "fresh"; heartbeat: KeeperHeartbeat }
  /** `heartbeat`: the newest one ever seen, for its age; null when none exists. `staleSince`: when it lapsed. */
  | { kind: "stale"; heartbeat: KeeperHeartbeat | null; staleSince: string | null }
  | { kind: "not_required"; reason: string }
  | { kind: "unknown"; reason: string };

/**
 * Only an armed-until file whose role is the keeper's counts: a waiter process
 * names no role, and Rowan's own waits are not the keeper. An armed-until
 * beyond the 6-hour horizon is not believed, as in the idle-front check.
 */
export function observeKeeper(wakes: ArmedWake[], window: RunWindow, now: Date, graceMinutes: number): KeeperObservation {
  if (window.open === null) return { kind: "unknown", reason: window.reason };
  if (window.open === false) return { kind: "not_required", reason: window.reason };
  const at = now.getTime();
  const heartbeats = wakes
    .filter((wake) => wake.source === "heartbeat-file" && wake.role === KEEPER_ROLE && wake.armedUntil !== null)
    .map((wake) => ({ session: wake.session, armedAt: wake.armedAt, armedUntil: wake.armedUntil as string, evidence: wake.evidence }))
    .filter((heartbeat) => Date.parse(heartbeat.armedUntil) <= at + MAX_ARMED_HORIZON_MS)
    .sort((a, b) => Date.parse(b.armedUntil) - Date.parse(a.armedUntil));
  const newest = heartbeats[0] ?? null;
  if (newest && Date.parse(newest.armedUntil) + graceMinutes * 60_000 > at) return { kind: "fresh", heartbeat: newest };
  return { kind: "stale", heartbeat: newest, staleSince: newest ? new Date(Date.parse(newest.armedUntil) + graceMinutes * 60_000).toISOString() : null };
}

export type SlotTransition = "alert" | "close" | null;

/** One alarm's state table: page on open, page on close, and hold through an unknown. */
export function decideSlot(slot: AlertSlot, observed: "alarm" | "clear" | "hold"): SlotTransition {
  if (observed === "hold") return null;
  if (observed === "alarm") return slot.open ? null : "alert";
  return slot.open ? "close" : null;
}

export function idleSignal(observation: IdleObservation): "alarm" | "clear" | "hold" {
  return observation.kind === "idle" ? "alarm" : observation.kind === "clear" ? "clear" : "hold";
}

export function keeperSignal(observation: KeeperObservation): "alarm" | "clear" | "hold" {
  return observation.kind === "stale" ? "alarm" : observation.kind === "unknown" ? "hold" : "clear";
}

/** Fixed for the whole idle stretch, so the outbox recognises a retry of this alert. */
export function idleEpisodeKey(row: IdleFrontRow): string {
  return `idle since ${row.blocked_since ?? row.ts}`;
}

export function keeperEpisodeKey(observation: Extract<KeeperObservation, { kind: "stale" }>): string {
  return observation.staleSince ? `keeper lapsed ${observation.staleSince}` : "keeper heartbeat never written";
}

export function closingKey(pingId: string): string {
  return `(${pingId})`;
}

export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const CAUSE_TEXT: Record<BlockerClass, string> = {
  none: "none",
  no_route: "no route",
  waiting_on_operator: "waiting on operator",
  no_ready_work: "no ready work",
  unknown: "unknown",
  unreadable: "unreadable"
};

/** Where the remedy lives, for the ping's link: the to-do list when a tap waits there, else the production page. */
export function idleRemedy(row: IdleFrontRow): { text: string; route: "/todo" | "/production" } {
  const operatorBlocker = row.blockers.find((blocker) => blocker.operatorBound && blocker.tapReady)
    ?? row.blockers.find((blocker) => blocker.operatorBound)
    ?? null;
  const remedy = operatorBlocker ? blockerRemedyFor(operatorBlocker.kind) : null;
  const subject = operatorBlocker ? `${operatorBlocker.kind} on ${operatorBlocker.key}` : null;
  switch (row.blocker_class) {
    case "waiting_on_operator":
      return remedy && subject
        ? { text: `your tap is ready: "${remedy.label}" for ${subject}`, route: remedy.surface === "todo" ? "/todo" : "/production" }
        : { text: "a one-tap item is ready for you", route: "/todo" };
    case "no_route":
      return { text: `no tap is ready yet${subject ? ` for ${subject}` : ""}: Rowan or the Momentum Keeper routes it`, route: "/production" };
    case "no_ready_work":
      return { text: "every scope Action is merged: Rowan plans the next work", route: "/production" };
    default:
      return { text: "the cause is unknown: Rowan checks `arcadia production status`", route: "/production" };
  }
}

function split(row: IdleFrontRow): string {
  const causes = row.idle_minutes_by_cause;
  if (!causes) return "";
  const parts = Object.entries(causes).filter(([, value]) => value > 0).map(([cause, value]) => `${cause.replaceAll("_", " ")} ${value}`);
  return parts.length > 0 ? ` Split (min): ${parts.join(", ")}.` : "";
}

/** `arcadia ping` takes 500 characters; the head and the episode key always survive, the detail is cut. */
export function fitPing(head: string, detail: string, tail: string, max = 500): string {
  const whole = `${head}${detail}${tail}`;
  if (whole.length <= max) return whole;
  const room = Math.max(0, max - head.length - tail.length - 1);
  return `${head}${detail.slice(0, room)}…${tail}`.slice(0, max);
}

export function idleAlertMessage(row: IdleFrontRow, window: RunWindow): string {
  const minutes = Math.round(row.idle_minutes ?? 0);
  const remedy = idleRemedy(row);
  return fitPing(
    `🚨🚨🚨 MOMENTUM: critical path idle ${minutes} min — cause: ${CAUSE_TEXT[row.blocker_class]} — ${remedy.text}.`,
    ` ${window.reason}; ${row.critical_path.label}.${split(row)}`,
    ` Critical path ${idleEpisodeKey(row)}. Nothing was started.`
  );
}

export function idleCloseMessage(open: NonNullable<AlertSlot["open"]>, observation: IdleObservation, window: RunWindow, now: Date): string {
  const after = formatAge(now.getTime() - Date.parse(open.alertedAt));
  const what = observation.kind === "clear" && observation.reason === "window_closed"
    ? `run window closed (${window.reason})`
    : "critical path moving again";
  return `✅ MOMENTUM: ${what}, ${after} after the idle alert ${closingKey(open.pingId)}.`;
}

function heartbeatAge(heartbeat: KeeperHeartbeat | null, now: Date): string {
  if (!heartbeat) return "never";
  const armedAt = heartbeat.armedAt ? Date.parse(heartbeat.armedAt) : Number.NaN;
  return Number.isFinite(armedAt) ? `${formatAge(now.getTime() - armedAt)} ago` : `unknown (armed until ${heartbeat.armedUntil})`;
}

export function keeperAlertMessage(observation: Extract<KeeperObservation, { kind: "stale" }>, window: RunWindow, now: Date): string {
  const lapsed = observation.heartbeat ? ` Armed until ${observation.heartbeat.armedUntil}${observation.heartbeat.session ? ` by ${observation.heartbeat.session}` : ""}, grace included.` : "";
  return fitPing(
    `🚨🚨🚨 MOMENTUM KEEPER NOT ACTIVE — last heartbeat ${heartbeatAge(observation.heartbeat, now)} — start a keeper: Rowan (or you) starts a Momentum Keeper helper under Decisions 0188 and 0114; it runs \`arcadia production keeper-heartbeat\` at every wake.`,
    ` ${window.reason}.${lapsed}`,
    ` Nothing was started (${keeperEpisodeKey(observation)}).`
  );
}

export function keeperCloseMessage(open: NonNullable<AlertSlot["open"]>, observation: KeeperObservation, now: Date): string {
  const after = formatAge(now.getTime() - Date.parse(open.alertedAt));
  if (observation.kind === "fresh") {
    const { heartbeat } = observation;
    return `✅ MOMENTUM KEEPER active again: heartbeat ${heartbeatAge(heartbeat, now)}${heartbeat.session ? ` from ${heartbeat.session}` : ""}, armed until ${heartbeat.armedUntil}; ${after} after the alert ${closingKey(open.pingId)}.`;
  }
  const reason = observation.kind === "not_required" ? observation.reason : "the run window closed";
  return `✅ MOMENTUM KEEPER alarm closed: ${reason}, so no keeper is required; ${after} after the alert ${closingKey(open.pingId)}.`;
}
