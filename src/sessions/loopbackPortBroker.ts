// Issue #2521 PROTOTYPE (option A of #2519). Not imported by any production path.
//
// Goal: a process confined by the pre-acceptance Seatbelt profile may bind and
// reach loopback ports it owns, and is still denied (EPERM) every other
// loopback port (the dashboard, Intelligence API, LiteLLM on the host).
//
// What Seatbelt can and cannot say (verified on macOS 26 with sandbox-exec):
//   - `(local ip "localhost:PORT")` / `(remote ip "localhost:PORT")` accept one
//     numeric port or `*`. A range such as `58000-58010` is a profile syntax
//     error ("invalid port in network address"). Several filters may share one
//     rule.
//   - Seatbelt decides at bind(2) time, before the kernel picks an ephemeral
//     port, so `listen(0)` cannot be allowed "for whatever port results". There
//     is no "ports this sandbox bound" predicate and no dynamic profile update.
// So the broker reserves a small per-run POOL of concrete ports, the profile
// allows bind, inbound and outbound for exactly those, and an in-process shim
// (`node --require`) maps `listen(0)` onto the pool. The isolation guarantee
// comes from the kernel (Seatbelt); the shim only supplies convenience and is
// not a boundary.

import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface LoopbackPortPool {
  /** Concrete loopback ports reserved for this run, ascending. */
  ports: readonly number[];
}

export const DEFAULT_POOL_SIZE = 16;
export const MAX_POOL_SIZE = 64;
export const POOL_ENV = "ARCADIA_LOOPBACK_POOL";

/** Pick `size` distinct loopback ports that are free right now. Race: a host service may take one later; see "Known limits" in the PR. */
export async function allocateLoopbackPortPool(size = DEFAULT_POOL_SIZE): Promise<LoopbackPortPool> {
  if (!Number.isInteger(size) || size < 1 || size > MAX_POOL_SIZE) throw new Error(`pool size must be 1..${MAX_POOL_SIZE}`);
  const held = [];
  const ports = new Set<number>();
  try {
    // Hold every probe open until the pool is complete so the kernel cannot hand the same port out twice.
    while (ports.size < size) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      held.push(server);
      const address = server.address();
      if (address && typeof address === "object") ports.add(address.port);
    }
  } finally {
    await Promise.all(held.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
  return { ports: [...ports].sort((a, b) => a - b) };
}

function checked(pool: LoopbackPortPool): number[] {
  if (!pool.ports.length) throw new Error("empty port pool");
  for (const port of pool.ports) if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`invalid pool port ${port}`);
  return [...pool.ports];
}

/**
 * The ONLY profile text this prototype adds to the confinement profile: bind,
 * inbound and outbound on `localhost:<pool port>`. Append it to the existing
 * profile; it never contains a wildcard port or host, `network*`, or
 * `network-outbound` to a non-pool port, and it loosens nothing else.
 */
export function loopbackProfileClauses(pool: LoopbackPortPool): string {
  const ports = checked(pool);
  const local = ports.map((port) => `(local ip "localhost:${port}")`).join(" ");
  const remote = ports.map((port) => `(remote ip "localhost:${port}")`).join(" ");
  return `(allow network-bind ${local}) (allow network-inbound ${local}) (allow network-outbound ${remote})`;
}

/** Environment the confined process needs for the shim: the pool and the preload. */
export function loopbackShimEnv(pool: LoopbackPortPool, shimPath: string, baseNodeOptions = ""): Record<string, string> {
  const ports = checked(pool);
  return { [POOL_ENV]: ports.join(","), NODE_OPTIONS: `${baseNodeOptions} --require ${JSON.stringify(shimPath)}`.trim() };
}

/** Write the shim into `dir` (a scratch directory readable by the confined process) and return its path. */
export function writeLoopbackShim(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "arcadia-loopback-shim.cjs");
  writeFileSync(target, LOOPBACK_SHIM_SOURCE, { mode: 0o444 });
  return target;
}

/**
 * Node-only convenience, inherited by child Node processes through
 * NODE_OPTIONS: `server.listen(0[, host])` and host-less `listen(port)` become a
 * listen on the first free pool port, on 127.0.0.1 (a wildcard bind is not in
 * the profile). Concurrent processes share the pool, so on EADDRINUSE the shim
 * quietly tries the next pool port. An explicit port outside the pool is left
 * alone and fails with EPERM from Seatbelt, which is the point.
 */
export const LOOPBACK_SHIM_SOURCE = `"use strict";
const net = require("node:net");
const pool = (process.env.${POOL_ENV} || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (pool.length) {
  const original = net.Server.prototype.listen;
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  net.Server.prototype.listen = function (...args) {
    const first = args[0];
    let options = null;
    let port = first;
    if (first && typeof first === "object" && !Array.isArray(first)) { options = first; port = first.port; }
    if (typeof first === "function" || typeof port === "string" && !/^\\d+$/.test(port) || options && (options.path || options.fd !== undefined || options.handle)) return original.apply(this, args);
    if (!(port === undefined || port === null || Number(port) === 0) ) return original.apply(this, args);
    let host = options ? options.host : typeof args[1] === "string" ? args[1] : undefined;
    if (host !== undefined && !loopback.has(host)) return original.apply(this, args);
    const callback = args.find((a) => typeof a === "function");
    const server = this;
    const start = process.pid % pool.length;
    let attempt = 0;
    const emit = server.emit;
    const restore = () => { if (server.emit !== emit) server.emit = emit; };
    const tryNext = () => {
      const candidate = pool[(start + attempt) % pool.length];
      attempt += 1;
      server.emit = function (event, error) {
        if (event === "error" && error && error.code === "EADDRINUSE" && attempt < pool.length) { restore(); setImmediate(tryNext); return true; }
        if (event === "listening" || event === "error") restore();
        return emit.apply(this, arguments);
      };
      original.call(server, { port: candidate, host: "127.0.0.1", backlog: options && options.backlog, exclusive: true }, attempt === 1 ? callback : undefined);
    };
    tryNext();
    return this;
  };
}
`;
