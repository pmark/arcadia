import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Read-only view of the preservation/go transport heartbeat. A leaf module (no
 * transport, audit or launch imports) so cheap readiness probes -- the Session
 * capability preflight, the dashboard's import graph, the out-of-process
 * -- do not pull the whole host transport in.
 * `preservationTransport.ts` re-exports everything here.
 */
export const HEARTBEAT_FILE = ".arcadia/preservation.heartbeat";

export const PRESERVATION_HEARTBEAT_SCHEMA = "arcadia-preservation-transport-v1";

/**
 * How often the worker's in-process timer re-stamps the heartbeat. It shares
 * the tick's event loop on purpose: `at` must mean the route's owner is making
 * progress, so an out-of-process beacon never re-stamps it. A long synchronous
 * tick step therefore stretches the real gap (live 2026-11-02: ~33s); the
 * worker refreshes immediately before its own pre-launch probe
 * (`ownWorkerCapability` in `production/tick.ts`) so it never walls itself.
 */
export const PRESERVATION_HEARTBEAT_REFRESH_MS = 5_000;

/** Missed refreshes a reader tolerates before calling a heartbeat stale. */
export const HEARTBEAT_MISSED_REFRESHES = 3;

/**
 * The lowest staleness limit any heartbeat gets, however short the interval it
 * declares: below this, a loaded host's scheduling jitter alone would read as a
 * dead worker.
 */
export const HEARTBEAT_STALENESS_FLOOR_MS = 15_000;

/**
 * The interval assumed for a heartbeat that does not declare `intervalMs` (a
 * writer older than the self-describing format). That writer's 5s timer ran on
 * the worker's own event loop, which a tick step blocks; its real cadence was
 * observed at ~25-35s, so it is credited 20s (a 60s limit), never the strict
 * 15s it used to be judged by.
 */
export const LEGACY_HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * The strict window at the worker's current cadence. Exported because the
 * worker daemon uses the very same number to decide whether its own liveness
 * record has gone stale (GitHub issue #485): two independent constants would
 * let `arcadia worker status` call a process healthy while
 * `arcadia-preserve-broker-*` refuses it, on the same evidence.
 */
export const TRANSPORT_FRESHNESS_MS = Math.max(HEARTBEAT_MISSED_REFRESHES * PRESERVATION_HEARTBEAT_REFRESH_MS, HEARTBEAT_STALENESS_FLOOR_MS);

/**
 * How long a stale preservation reading is rechecked before it is a genuine
 * environment wall. The launch preflight runs synchronously inside the
 * worker's tick, so it never sleeps there (that would starve every other
 * Action and the in-process writer): a stale reading inside this window is a
 * retryable refusal re-read on the following ticks, and only a reading that
 * stays stale past it -- or a heartbeat already older than its limit plus this
 * window, a dead writer -- escalates.
 */
export const PRESERVATION_RECHECK_CAP_MS = 60_000;

/** The heartbeat fields the readiness checks read. */
export interface TransportHeartbeatReading {
  schema: string;
  at: number;
  /** The writer's own refresh interval; absent from older writers. */
  intervalMs?: number;
  goRequests?: boolean;
  goRequestsAt?: number;
}

export function readTransportHeartbeat(workspace: string): TransportHeartbeatReading {
  return JSON.parse(readFileSync(path.join(workspace, HEARTBEAT_FILE), "utf8")) as TransportHeartbeatReading;
}

/**
 * The staleness limit a heartbeat declares for itself: three of its own
 * refresh intervals, never below the floor. Changing the writer's cadence
 * therefore needs no change here.
 */
export function heartbeatStalenessLimitMs(heartbeat: Pick<TransportHeartbeatReading, "intervalMs">): number {
  const interval = typeof heartbeat.intervalMs === "number" && Number.isFinite(heartbeat.intervalMs) && heartbeat.intervalMs > 0
    ? heartbeat.intervalMs
    : LEGACY_HEARTBEAT_INTERVAL_MS;
  return Math.max(HEARTBEAT_MISSED_REFRESHES * interval, HEARTBEAT_STALENESS_FLOOR_MS);
}

/** A readable, well-formed heartbeat's age and its own limit, or null when there is none. */
export function preservationHeartbeatAge(workspace: string): { ageMs: number; limitMs: number } | null {
  try {
    const value = readTransportHeartbeat(workspace);
    if (value.schema !== PRESERVATION_HEARTBEAT_SCHEMA || typeof value.at !== "number") return null;
    const ageMs = Date.now() - value.at;
    return ageMs < 0 ? null : { ageMs, limitMs: heartbeatStalenessLimitMs(value) };
  } catch { return null; }
}

export function preservationTransportReady(workspace: string): boolean {
  const reading = preservationHeartbeatAge(workspace);
  return reading !== null && reading.ageMs < reading.limitMs;
}

/**
 * How the agent go transport can currently be used:
 *
 * - `ready` -- the worker has run the go route within the freshness window.
 * - `busy` -- a go-capable worker is alive (fresh heartbeat) but has not run the
 *   go route recently. It may be mid-tick; it is not the same as a missing or
 *   outdated worker, so an operator should retry shortly rather than restart it.
 * - `unavailable` -- no fresh heartbeat, or a heartbeat from a worker that does
 *   not advertise go support at all (an older preservation-only worker).
 */
export type AgentGoTransportState = "ready" | "busy" | "unavailable";

/**
 * Readiness is liveness of the go route, not of the worker process. The
 * heartbeat's `at` is deliberately re-stamped off-tick to keep preservation
 * usable during a long synchronous tick; if go readiness trusted that stamp it
 * would keep reporting READY while the stuck tick never services a request. So
 * `ready` requires `goRequestsAt`, written only by the pass that actually runs
 * the go route, to be within the strict window. A fresh heartbeat with a stale
 * `goRequestsAt` is `busy`, not `ready`.
 */
export function agentGoTransportState(workspace: string): AgentGoTransportState {
  let heartbeat: TransportHeartbeatReading;
  try {
    if (!preservationTransportReady(workspace)) return "unavailable";
    heartbeat = readTransportHeartbeat(workspace);
  } catch { return "unavailable"; }
  if (heartbeat.goRequests !== true || typeof heartbeat.goRequestsAt !== "number") return "unavailable";
  const age = Date.now() - heartbeat.goRequestsAt;
  return age >= 0 && age < TRANSPORT_FRESHNESS_MS ? "ready" : "busy";
}

/**
 * Why a route is not servicing requests, naming the route and the heartbeat
 * file so an operator can tell a missing worker from a stale one.
 */
export function transportHeartbeatDiagnostic(workspace: string, route: "preservation" | "go"): string {
  const file = path.join(workspace, HEARTBEAT_FILE);
  let heartbeat: TransportHeartbeatReading;
  try { heartbeat = readTransportHeartbeat(workspace); } catch {
    return `The ${route} route has no readable heartbeat at ${file}; the Arcadia worker has not published one (worker not running).`;
  }
  const age = Date.now() - heartbeat.at;
  const limit = heartbeatStalenessLimitMs(heartbeat);
  if (heartbeat.schema !== PRESERVATION_HEARTBEAT_SCHEMA || age < 0 || age >= limit) {
    return `The ${route} route heartbeat at ${file} is stale (${Math.round(age / 1000)}s old, limit ${Math.round(limit / 1000)}s); the Arcadia worker stopped refreshing it.`;
  }
  if (route === "go" && agentGoTransportState(workspace) !== "ready") {
    return `The go route heartbeat at ${file} is fresh but the worker has not serviced go recently; it may be mid-tick or an older worker without go support.`;
  }
  return `The ${route} route heartbeat at ${file} is fresh.`;
}
