import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Read-only view of the preservation/go transport heartbeat. A leaf module (no
 * transport, audit or launch imports) so cheap readiness probes -- the Session
 * capability preflight, the dashboard's import graph -- do not pull the whole
 * host transport in. `preservationTransport.ts` re-exports everything here.
 */
export const HEARTBEAT_FILE = ".arcadia/preservation.heartbeat";

/**
 * How long a published route projection is trusted before it is stale.
 *
 * Exported because the worker daemon uses the very same number to decide
 * whether its own heartbeat has gone stale (GitHub issue #485). They describe
 * one failure -- a worker that stopped refreshing -- and two independent
 * constants would let `arcadia worker status` call a process healthy while
 * `arcadia-preserve-broker-*` refuses it, on the same evidence.
 */
export const TRANSPORT_FRESHNESS_MS = 15_000;

/** The heartbeat fields the readiness checks read. */
export interface TransportHeartbeatReading {
  schema: string;
  at: number;
  goRequests?: boolean;
  goRequestsAt?: number;
}

export function readTransportHeartbeat(workspace: string): TransportHeartbeatReading {
  return JSON.parse(readFileSync(path.join(workspace, HEARTBEAT_FILE), "utf8")) as TransportHeartbeatReading;
}

export function preservationTransportReady(workspace: string): boolean {
  try {
    const value = readTransportHeartbeat(workspace);
    return value.schema === "arcadia-preservation-transport-v1" && Date.now() - value.at >= 0 && Date.now() - value.at < TRANSPORT_FRESHNESS_MS;
  } catch { return false; }
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
 * the go route, to be within the same freshness window. A fresh heartbeat with a
 * stale `goRequestsAt` is `busy`, not `ready`.
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
  if (heartbeat.schema !== "arcadia-preservation-transport-v1" || age < 0 || age >= TRANSPORT_FRESHNESS_MS) {
    return `The ${route} route heartbeat at ${file} is stale (${Math.round(age / 1000)}s old, limit ${TRANSPORT_FRESHNESS_MS / 1000}s); the Arcadia worker stopped refreshing it.`;
  }
  if (route === "go" && agentGoTransportState(workspace) !== "ready") {
    return `The go route heartbeat at ${file} is fresh but the worker has not serviced go recently; it may be mid-tick or an older worker without go support.`;
  }
  return `The ${route} route heartbeat at ${file} is fresh.`;
}
