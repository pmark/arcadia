import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:net";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allocateLoopbackPortPool, loopbackProfileClauses, loopbackShimEnv, writeLoopbackShim, type LoopbackPortPool } from "../src/sessions/loopbackPortBroker.js";

// Issue #2521 prototype fixture. Seatbelt cannot nest, so this runs only on a
// host that can apply a profile; inside another sandbox it skips (reported,
// not silently passing: see the `applicable` probe).
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const applicable = process.platform === "darwin"
  && spawnSync(SANDBOX_EXEC, ["-p", "(version 1)(allow default)", "/usr/bin/true"]).status === 0;

// The shape of the production confinement profile in completionValidation.ts:
// deny default, no network rule. Reads are broad here only because the fixture
// has nothing secret to protect; the property under test is network.
const BASE_PROFILE = `(version 1) (deny default) (allow file-read*) (allow process-exec) (allow process-fork) (allow sysctl-read) (allow signal (target same-sandbox))`;

const CHILD = `
const net = require("node:net");
const [mode, port] = process.argv.slice(2);
const done = (line) => { console.log(line); process.exit(0); };
if (mode === "own") {
  // The child starts its own server (port 0, as test suites do) and reaches it.
  const server = net.createServer((c) => c.end("pong"));
  server.on("error", (e) => done("BIND_ERR " + e.code));
  server.listen(0, () => {
    const owned = server.address().port;
    const c = net.connect(owned, "127.0.0.1");
    c.on("data", (d) => done("OWN_OK " + owned + " " + d));
    c.on("error", (e) => done("OWN_CONNECT_ERR " + e.code));
  });
} else {
  const c = net.connect(Number(port), "127.0.0.1");
  c.on("connect", () => done("CONNECTED"));
  c.on("error", (e) => done("CONNECT_ERR " + e.code));
}
`;

describe.skipIf(!applicable)("loopback port broker prototype (#2521)", () => {
  let scratch: string;
  let pool: LoopbackPortPool;
  let shim: string;
  let decoy: Server;
  let decoyPort: number;
  let decoyHits = 0;
  let script: string;

  beforeAll(async () => {
    scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-loopback-")));
    script = path.join(scratch, "child.cjs");
    writeFileSync(script, CHILD);
    pool = await allocateLoopbackPortPool(8);
    shim = writeLoopbackShim(scratch);
    // The unrelated host service: outside the sandbox, on a random port.
    // Never let the random decoy land on a pool port (that port is allowed by design).
    for (;;) {
      decoy = createServer((socket) => { decoyHits += 1; socket.end("host-secret"); });
      await new Promise<void>((resolve) => decoy.listen(0, "127.0.0.1", resolve));
      decoyPort = (decoy.address() as { port: number }).port;
      if (!pool.ports.includes(decoyPort)) break;
      await new Promise<void>((resolve) => decoy.close(() => resolve()));
    }
  });
  afterAll(() => { decoy?.close(); if (scratch) rmSync(scratch, { recursive: true, force: true }); });

  const run = (profile: string, args: string[], env: Record<string, string> = {}) => {
    const result = spawnSync(SANDBOX_EXEC, ["-p", profile, process.execPath, script, ...args], {
      encoding: "utf8", timeout: 20_000, env: { PATH: "/usr/bin:/bin", ...env }
    });
    return { status: result.status, out: (result.stdout + result.stderr).trim() };
  };
  const confined = () => `${BASE_PROFILE} ${loopbackProfileClauses(pool)}`;
  const shimEnv = () => loopbackShimEnv(pool, shim);

  it("control: the existing profile alone denies a loopback bind", () => {
    expect(run(BASE_PROFILE, ["own"]).out).toBe("BIND_ERR EPERM");
  });

  it("(1) a child under the prototype profile binds a loopback port and connects to it", () => {
    const { out } = run(confined(), ["own"], shimEnv());
    const match = /^OWN_OK (\d+) pong$/.exec(out);
    expect(match, out).not.toBeNull();
    expect(pool.ports).toContain(Number(match![1]));
  });

  it("(2) the same child is denied an unrelated listening host port with EPERM", () => {
    expect(run(confined(), ["connect", String(decoyPort)], shimEnv()).out).toBe("CONNECT_ERR EPERM");
    expect(decoyHits).toBe(0);
    // And the decoy really is reachable from outside the sandbox.
    expect(run("(version 1)(allow default)", ["connect", String(decoyPort)]).out).toBe("CONNECTED");
  });

  it("(2b) an explicit bind outside the pool is denied too", () => {
    let outside = 1024 + ((decoyPort + 7) % 60000);
    while (pool.ports.includes(outside) || outside === decoyPort) outside += 1;
    const script2 = path.join(scratch, "bind-outside.cjs");
    writeFileSync(script2, `require("node:net").createServer().on("error", (e) => console.log("BIND_ERR " + e.code)).listen(${outside}, "127.0.0.1", () => console.log("BOUND"));`);
    const result = spawnSync(SANDBOX_EXEC, ["-p", confined(), process.execPath, script2], { encoding: "utf8", timeout: 20_000, env: { PATH: "/usr/bin:/bin" } });
    expect(result.stdout.trim()).toBe("BIND_ERR EPERM");
  });

  it("pins the real address scope: pool ports are open on every local address (0.0.0.0, [::], ::1), 127.0.0.2 is not", () => {
    // Seatbelt accepts only `*` or `localhost` as host, so no tighter filter exists. This documents the pool-race exposure.
    const probe = path.join(scratch, "addr.cjs");
    writeFileSync(probe, `const net = require("node:net"); const [mode, host, port] = process.argv.slice(2);
const done = (l) => { console.log(l); process.exit(0); };
if (mode === "bind") { const s = net.createServer(); s.on("error", (e) => done("ERR " + e.code)); s.listen(Number(port), host, () => done("BOUND")); }
else { const c = net.connect(Number(port), host); c.on("connect", () => done("CONNECTED")); c.on("error", (e) => done("ERR " + e.code)); }`);
    const probeRun = (...args: string[]) => spawnSync(SANDBOX_EXEC, ["-p", confined(), process.execPath, probe, ...args], { encoding: "utf8", timeout: 20_000, env: { PATH: "/usr/bin:/bin" } }).stdout.trim();
    const port = String(pool.ports[0]);
    for (const host of ["127.0.0.1", "0.0.0.0", "::", "::1"]) expect(probeRun("bind", host, port), host).toBe("BOUND");
    expect(probeRun("bind", "127.0.0.2", port)).toBe("ERR EPERM");
    // Outbound to a pool port on ::1 is allowed (nothing listens, so refused rather than denied).
    expect(probeRun("connect", "::1", port)).toBe("ERR ECONNREFUSED");
    expect(probeRun("connect", "::1", String(decoyPort))).toBe("ERR EPERM");
  });

  it("(1b) two servers in one confined process both get distinct pool ports (shim retries on EADDRINUSE)", () => {
    const two = path.join(scratch, "two.cjs");
    writeFileSync(two, `const net = require("node:net"); const ports = []; let n = 0;
for (let i = 0; i < 2; i++) { const s = net.createServer(); s.on("error", (e) => { console.log("ERR " + e.code); process.exit(0); }); s.listen(0, () => { ports.push(s.address().port); if (++n === 2) { console.log("PORTS " + ports.join(",")); process.exit(0); } }); }`);
    const result = spawnSync(SANDBOX_EXEC, ["-p", confined(), process.execPath, two], { encoding: "utf8", timeout: 20_000, env: { PATH: "/usr/bin:/bin", ...shimEnv() } });
    const match = /^PORTS (\d+),(\d+)$/.exec(result.stdout.trim());
    expect(match, result.stdout + result.stderr).not.toBeNull();
    expect(match![1]).not.toBe(match![2]);
    expect(pool.ports).toContain(Number(match![1]));
    expect(pool.ports).toContain(Number(match![2]));
  });

});

describe("loopback profile clauses (pure, run everywhere)", () => {
  let pool: LoopbackPortPool;
  beforeAll(async () => { pool = await allocateLoopbackPortPool(8); });

  it("(3) the added profile text is only pool-port network rules and the base profile is untouched", () => {
    const clauses = loopbackProfileClauses(pool);
    expect(`${BASE_PROFILE} ${loopbackProfileClauses(pool)}`.startsWith(BASE_PROFILE)).toBe(true);
    const rules = clauses.match(/\(allow [a-z-]+/g);
    expect(rules).toEqual(["(allow network-bind", "(allow network-inbound", "(allow network-outbound"]);
    const ports = [...clauses.matchAll(/"localhost:(\d+)"/g)].map((m) => Number(m[1]));
    expect(new Set(ports)).toEqual(new Set(pool.ports));
    expect(clauses).not.toMatch(/\*|network\*|"[^"]*:\*"|0\.0\.0\.0|file-|process-|mach-|system-|default/);
  });

  it("refuses pools the broker did not issue, including host service ports and malformed ports", () => {
    for (const ports of [[], [80], [3000], [3020], [8000], [1.5], [70000], [-1], [Number.NaN]]) {
      expect(() => loopbackProfileClauses({ ports }), JSON.stringify(ports)).toThrow();
    }
    expect(() => loopbackProfileClauses({ ports: [...pool.ports] })).toThrow(/not issued/);
  });
});

describe("allocateLoopbackPortPool", () => {
  it("returns distinct bounded ports and refuses silly sizes", async () => {
    const pool = await allocateLoopbackPortPool(5);
    expect(new Set(pool.ports).size).toBe(5);
    await expect(allocateLoopbackPortPool(0)).rejects.toThrow();
    await expect(allocateLoopbackPortPool(1000)).rejects.toThrow();
  });
});
