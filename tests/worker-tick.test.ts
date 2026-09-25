import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyWorkerHealth,
  createWorkerTick,
  decideWorkerStart,
  isProcessAlive,
  isWorkspaceWorkerCommand,
  runManagedProductionIteration,
  runWorkerInstallCommand,
  runWorkerStartCommand,
  runWorkerStatusCommand,
  runWorkerStopCommand,
  terminateStaleWorker
} from "../src/commands/worker.js";
import { startHeartbeatBeacon } from "../src/commands/workerHeartbeatBeaconExecutor.js";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork } from "../src/db/repositories.js";
import { TRANSPORT_FRESHNESS_MS, preservationTransportReady } from "../src/sessions/preservationTransport.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { repoRoot, runCli } from "./cli-response-fixture.js";

const temporary: string[] = [];
const fixtures: ChildProcess[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const child of fixtures.splice(0)) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): { root: string; logfile: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-worker-tick-"));
  temporary.push(root);
  initWorkspace(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  return { root, logfile: path.join(root, ".arcadia", "worker.log") };
}

function pidfileOf(root: string): string {
  return path.join(root, ".arcadia", "worker.pid");
}

function writeRecord(root: string, record: { pid: number; owner: string; at: number }): void {
  writeFileSync(pidfileOf(root), JSON.stringify(record), "utf8");
}

function readRecord(root: string): { pid: number; owner: string; at: number } {
  return JSON.parse(readFileSync(pidfileOf(root), "utf8"));
}

function captureStdout(run: () => void): string {
  let captured = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    captured += String(chunk);
    return true;
  });
  try { run(); } finally { write.mockRestore(); }
  return captured;
}

/**
 * `runWorkerStartCommand` installs SIGINT/SIGTERM handlers that call
 * `process.exit`, which is correct for the daemon and wrong for the test
 * runner. Drop only the handlers that call installed, so any the runner owns
 * survive.
 */
function dropSignalHandlersInstalledBy(run: () => void): void {
  const signals = ["SIGINT", "SIGTERM"] as const;
  const before = Object.fromEntries(signals.map((signal) => [signal, process.listeners(signal)]));
  run();
  for (const signal of signals) {
    for (const listener of process.listeners(signal)) {
      if (!before[signal].includes(listener)) process.removeListener(signal, listener);
    }
  }
}

/**
 * A real live process that ignores SIGTERM, so recovery has to escalate to
 * SIGKILL — the closest honest fixture to the hung daemon in Issue #485
 * without waiting for one to hang for 159 minutes. It announces readiness
 * after installing its SIGTERM handler, so the test never races a signal
 * against process startup.
 *
 * `exited` resolves once the child is reaped. Recovery sleeps with a blocked
 * event loop, so a killed child stays a zombie — alive to `kill(pid, 0)` —
 * until the loop turns, and asserting on liveness before that would fail on
 * the fixture rather than on the behaviour.
 */
async function stubbornProcess(): Promise<{ pid: number; exited: Promise<void>; kill: (signal?: NodeJS.Signals) => void }> {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"], {
    stdio: ["ignore", "pipe", "ignore"]
  });
  fixtures.push(child);
  await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return { pid: child.pid, exited, kill: (signal) => { child.kill(signal); } };
}

describe("worker start already-running guard", () => {
  it("starts when no live worker owns the pidfile", () => {
    const now = 1_000_000;
    expect(decideWorkerStart(null, () => true, now)).toEqual({ action: "start", pid: null });
    expect(decideWorkerStart({ pid: 4242, owner: "old", at: now }, () => false, now)).toEqual({ action: "start", pid: null });
  });

  it("treats a live pidfile holder with a fresh heartbeat as already running rather than a failure", () => {
    const now = 1_000_000;
    expect(decideWorkerStart({ pid: 4242, owner: "worker", at: now }, () => true, now)).toEqual({ action: "already-running", pid: 4242 });
  });

  it("decides recovery, not already-running, for a live worker whose heartbeat is stale (Issue #485)", () => {
    const now = 1_000_000;
    expect(decideWorkerStart({ pid: 4242, owner: "hung", at: now - TRANSPORT_FRESHNESS_MS }, () => true, now)).toEqual({ action: "recover", pid: 4242 });
    // One millisecond inside the window is still a live worker, not a hang.
    expect(decideWorkerStart({ pid: 4242, owner: "busy", at: now - TRANSPORT_FRESHNESS_MS + 1 }, () => true, now)).toEqual({ action: "already-running", pid: 4242 });
    // A record stamped in the future is clock skew, not evidence of a hang.
    expect(decideWorkerStart({ pid: 4242, owner: "skewed", at: now + 60_000 }, () => true, now)).toEqual({ action: "already-running", pid: 4242 });
  });

  it("treats EPERM as live and only ESRCH as dead", () => {
    const kill = vi.spyOn(process, "kill");
    const error = (code: string) => Object.assign(new Error(code), { code });
    kill.mockImplementationOnce(() => { throw error("EPERM"); });
    expect(isProcessAlive(4242)).toBe(true);
    kill.mockImplementationOnce(() => { throw error("ESRCH"); });
    expect(isProcessAlive(4242)).toBe(false);
    kill.mockRestore();
  });

  // Issue #303: exiting 1 here is what turned the benign path into a launchd
  // crash loop. The guard must exit 0, and the CLI-level test proves the exit
  // code rather than only the decision that precedes it.
  it("exits 0 from the CLI when another worker already holds the workspace pidfile", () => {
    const { root } = workspace();
    writeRecord(root, { pid: process.pid, owner: "existing", at: Date.now() });

    const result = runCli(["worker", "start", "--workspace", root]);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("already running");
    expect(result.stdout).toContain("already running");
  });

  it("does not replace a live legacy numeric pidfile before the worker has restarted", () => {
    const { root } = workspace();
    const pidfile = pidfileOf(root);
    writeFileSync(pidfile, String(process.pid), "utf8");

    const result = runCli(["worker", "start", "--workspace", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Legacy worker still running");
    expect(readFileSync(pidfile, "utf8")).toBe(String(process.pid));
  });
});

describe("worker health classification", () => {
  it("uses the same staleness threshold the preservation transport refuses at", () => {
    const at = 1_000_000;
    const record = { pid: 4242, owner: "hung", at };

    expect(classifyWorkerHealth(record, null, () => true, at + TRANSPORT_FRESHNESS_MS)).toEqual({ health: "unhealthy", pid: 4242 });
    expect(classifyWorkerHealth(record, null, () => true, at + TRANSPORT_FRESHNESS_MS - 1)).toEqual({ health: "running", pid: 4242 });
    expect(classifyWorkerHealth(record, null, () => false, at + TRANSPORT_FRESHNESS_MS)).toEqual({ health: "stopped", pid: 4242 });
    expect(classifyWorkerHealth(null, null, () => true, at)).toEqual({ health: "stopped", pid: null });
    // A legacy numeric pidfile has no heartbeat to age, so a live PID with no
    // ownership record is unhealthy rather than running.
    expect(classifyWorkerHealth(null, 4242, () => true, at)).toEqual({ health: "unhealthy", pid: 4242 });
  });

  it("reports an alive-but-stale process as unhealthy and names its age", async () => {
    const { root } = workspace();
    const fixture = await stubbornProcess();
    writeRecord(root, { pid: fixture.pid, owner: "hung", at: Date.now() - 60_000 });

    const output = captureStdout(() => runWorkerStatusCommand({ workspace: root }));

    expect(output).toContain("unhealthy");
    expect(output).toContain(String(fixture.pid));
    expect(output).toContain("60s old");
    expect(output).not.toContain("already running");
  });
});

describe("worker process identity", () => {
  const workspacePath = "/Users/example/workspaces/one";
  const otherWorkspacePath = "/Users/example/workspaces/two";
  const recognized = (commandLine: string, workspace = workspacePath, fallback: string | null = workspacePath) =>
    isWorkspaceWorkerCommand(commandLine, workspace, fallback);

  it("binds an explicit --workspace by exact match", () => {
    expect(recognized(
      `mise exec -- node /repo/node_modules/tsx/dist/cli.mjs /repo/src/cli.ts worker start --workspace ${workspacePath}`
    )).toBe(true);
    expect(recognized(`node /repo/src/cli.ts worker start --workspace=${workspacePath}`)).toBe(true);
    // Another workspace's worker is not this workspace's worker.
    expect(recognized(`node /repo/src/cli.ts worker start --workspace ${otherWorkspacePath}`)).toBe(false);
    // A path that merely contains this one is a different workspace.
    expect(recognized(`node /repo/src/cli.ts worker start --workspace ${workspacePath}-two`)).toBe(false);
    // Same workspace, different verb.
    expect(recognized(`node /repo/src/cli.ts worker status --workspace ${workspacePath}`)).toBe(false);
    // An unrelated process the kernel recycled the PID onto.
    expect(recognized("node -e setInterval(() => {}, 1000)")).toBe(false);
  });

  // Issue #492: the live worker on the operator's host is started without
  // `--workspace`, so refusing that shape outright made the recovery added for
  // Issue #485 unreachable on the one host where it had actually happened.
  it("binds a workspace-less invocation only to the default workspace", () => {
    const argv = "node /repo/node_modules/tsx/dist/cli.mjs /repo/src/cli.ts worker start";
    expect(recognized(argv, workspacePath, workspacePath)).toBe(true);
    // Same invocation, but this is not the workspace a default resolves to.
    expect(recognized(argv, otherWorkspacePath, workspacePath)).toBe(false);
    // A host that cannot resolve a default refuses rather than assumes.
    expect(recognized(argv, workspacePath, null)).toBe(false);
    // The `pnpm arcadia worker start` shape is the same claim.
    expect(recognized("pnpm arcadia worker start", workspacePath, workspacePath)).toBe(true);
  });

  it("refuses to signal a stale PID that is not this workspace's worker", async () => {
    const { root } = workspace();
    const fixture = await stubbornProcess();
    writeRecord(root, { pid: fixture.pid, owner: "recycled", at: Date.now() - 60_000 });

    const result = runCli(["worker", "start", "--workspace", root]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(String(fixture.pid));
    expect(`${result.stdout}${result.stderr}`).toMatch(/Refusing to signal/);
    // The unrelated process was never signalled.
    expect(isProcessAlive(fixture.pid)).toBe(true);
  });
});

describe("worker stale-heartbeat recovery (Issue #485)", () => {
  it("recovers a hung worker through worker start and leaves no duplicate or orphaned pidfile", async () => {
    const { root, logfile } = workspace();
    const fixture = await stubbornProcess();
    writeRecord(root, { pid: fixture.pid, owner: "hung", at: Date.now() - 60_000 });

    expect(captureStdout(() => runWorkerStatusCommand({ workspace: root }))).toContain("unhealthy");

    // The tick loop and its heartbeat interval are what keep `worker start`
    // resident; this test asserts the recovery that happens before them.
    const intervals = vi.spyOn(globalThis, "setInterval").mockReturnValue(0 as unknown as NodeJS.Timeout);
    const timeouts = vi.spyOn(globalThis, "setTimeout").mockReturnValue(0 as unknown as NodeJS.Timeout);
    const resume = vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
    dropSignalHandlersInstalledBy(() => runWorkerStartCommand({ workspace: root }, {
      // The exact shape the operator's own launch agent runs: no
      // `--workspace`, the workspace resolved as the default (Issue #492).
      identify: () => `node ${path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs")} ${path.join(repoRoot, "src", "cli.ts")} worker start`,
      defaultWorkspace: () => root,
      terminateGraceMs: 50,
      killGraceMs: 50,
      // A real beacon would fork an actual OS process; this test only cares
      // about the recovery that happens before the beacon or the tick loop.
      startHeartbeatBeacon: () => ({ stop: () => {} })
    }));
    intervals.mockRestore();
    timeouts.mockRestore();
    resume.mockRestore();
    // No manual intervention: the hung process is gone and the workspace has a
    // fresh owner whose heartbeat is inside the shared freshness window.
    await fixture.exited;
    expect(isProcessAlive(fixture.pid)).toBe(false);
    const recovered = readRecord(root);
    expect(recovered.pid).toBe(process.pid);
    expect(Date.now() - recovered.at).toBeLessThan(TRANSPORT_FRESHNESS_MS);

    // The escalation is recorded where the operator's own restart would be.
    const logged = readFileSync(logfile, "utf8");
    expect(logged).toContain(`Recovered hung worker: PID ${fixture.pid}`);
    expect(logged).toContain("ended with SIGKILL");

    // Recovery leaves no duplicate: the next start sees a healthy owner.
    expect(captureStdout(() => runWorkerStatusCommand({ workspace: root }))).toContain("running");
    expect(decideWorkerStart(recovered, () => true)).toEqual({ action: "already-running", pid: process.pid });
  });

  it("force-kills a hung worker from worker stop after SIGTERM is ignored", async () => {
    const { root } = workspace();
    const fixture = await stubbornProcess();
    writeRecord(root, { pid: fixture.pid, owner: "hung", at: Date.now() - 60_000 });

    const output = captureStdout(() => runWorkerStopCommand({ workspace: root }, {
      identify: () => `node ${path.join(repoRoot, "src", "cli.ts")} worker start --workspace ${root}`,
      terminateGraceMs: 50,
      killGraceMs: 50
    }));

    expect(output).toContain("ignored SIGTERM");
    expect(output).toContain("SIGKILL");
    await fixture.exited;
    expect(isProcessAlive(fixture.pid)).toBe(false);
    // A force-killed worker never runs its own cleanup, so stop must clear the
    // record rather than leave a pidfile naming a dead PID.
    expect(existsSync(pidfileOf(root))).toBe(false);
  });

  it("leaves a worker that is mid-tick alone rather than killing it", async () => {
    const { root } = workspace();
    const fixture = await stubbornProcess();
    // Alive and refusing SIGTERM, but its heartbeat is inside the window: it
    // may simply be blocked in a long tick, which is not a hang.
    writeRecord(root, { pid: fixture.pid, owner: "busy", at: Date.now() });

    const output = captureStdout(() => runWorkerStopCommand({ workspace: root }, {
      identify: () => `node ${path.join(repoRoot, "src", "cli.ts")} worker start --workspace ${root}`,
      terminateGraceMs: 50,
      killGraceMs: 50
    }));

    expect(output).toContain("mid-tick");
    expect(output).not.toContain("SIGKILL");
    expect(isProcessAlive(fixture.pid)).toBe(true);
  });

  it("re-reads the heartbeat after the SIGTERM grace before escalating", async () => {
    const { root } = workspace();
    const fixture = await stubbornProcess();
    writeRecord(root, { pid: fixture.pid, owner: "slow", at: Date.now() - 60_000 });

    const output = captureStdout(() => runWorkerStopCommand({ workspace: root }, {
      identify: () => `node ${path.join(repoRoot, "src", "cli.ts")} worker start --workspace ${root}`,
      terminateGraceMs: 50,
      killGraceMs: 50,
      // Stand in for a worker that was merely slow: it refreshes its own
      // record while the grace period is still running. The pre-SIGTERM
      // record said "hung", and escalating on it would kill live work.
      sleep: () => writeRecord(root, { pid: fixture.pid, owner: "slow", at: Date.now() })
    }));

    expect(output).toContain("refreshed its heartbeat during the grace period");
    expect(output).not.toContain("SIGKILL");
    expect(isProcessAlive(fixture.pid)).toBe(true);
  });

  it("refuses to escalate when the workspace changed hands during the grace", async () => {
    const { root } = workspace();
    const fixture = await stubbornProcess();
    writeRecord(root, { pid: fixture.pid, owner: "replaced", at: Date.now() - 60_000 });

    const output = captureStdout(() => runWorkerStopCommand({ workspace: root }, {
      identify: () => `node ${path.join(repoRoot, "src", "cli.ts")} worker start --workspace ${root}`,
      terminateGraceMs: 50,
      killGraceMs: 50,
      sleep: () => writeRecord(root, { pid: fixture.pid, owner: "successor", at: Date.now() })
    }));

    expect(output).toContain("no longer owns the workspace pidfile");
    expect(output).not.toContain("SIGKILL");
    expect(isProcessAlive(fixture.pid)).toBe(true);
  });

  it("treats a target that died during the grace as terminated, not as a failure", async () => {
    const { root } = workspace();
    const fixture = await stubbornProcess();
    const commandLine = `node ${path.join(repoRoot, "src", "cli.ts")} worker start --workspace ${root}`;

    // Kill the fixture through the real `process.kill` path without letting the
    // caller know: the next signal raises ESRCH, which a termination path must
    // read as "already gone" rather than as a failed kill.
    fixture.kill("SIGKILL");
    await fixture.exited;

    expect(() => terminateStaleWorker(root, { pid: fixture.pid, owner: "gone", at: Date.now() - 60_000 }, {
      identify: () => commandLine,
      sleep: () => {}
    })).not.toThrow();
  });
});

/**
 * Polls rather than sleeping a fixed duration: forking a real OS process
 * (running under the `tsx` ESM loader) has startup latency that varies with
 * the host, and a fixed short sleep made these tests flaky on a slower or
 * more loaded machine without making them any faster on a fast one.
 */
async function waitFor(check: () => boolean, timeoutMs: number, pollMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

describe("worker heartbeat beacon (Issue #617)", () => {
  // A managed-production tick step can block the worker's own event loop for
  // 170s-292s (Issue #617) — far longer than the freshness window the
  // in-process `setInterval` (also on that same blocked event loop) needs to
  // refresh the record before recovery reads it as hung. The beacon is a
  // genuinely separate OS process, so it is not blocked by anything the
  // worker's own thread does; these tests prove that independence directly,
  // at a small interval, rather than by literally blocking a test for the
  // length of the real freshness window. `runWorkerStopCommand`'s existing
  // "leaves a worker that is mid-tick alone" test above already proves the
  // consuming side: a fresh record, however it was refreshed, stops recovery.
  it("refreshes the worker's own record on its own, independent of anything the caller does", async () => {
    const { root } = workspace();
    const identity = { pid: process.pid, owner: "beacon-refresh" };
    const beacon = startHeartbeatBeacon(root, identity, { intervalMs: 20 });
    try {
      await waitFor(() => existsSync(pidfileOf(root)), 5_000);
      const first = readRecord(root);
      await waitFor(() => readRecord(root).at > first.at, 5_000);
      const second = readRecord(root);
      expect(second.at).toBeGreaterThan(first.at);
      expect(second.pid).toBe(process.pid);
      expect(second.owner).toBe("beacon-refresh");
    } finally {
      beacon.stop();
    }
  }, 15_000);

  it("keeps refreshing while the calling process is busy in a synchronous loop", async () => {
    const { root } = workspace();
    const identity = { pid: process.pid, owner: "beacon-busy" };
    const beacon = startHeartbeatBeacon(root, identity, { intervalMs: 20 });
    try {
      await waitFor(() => existsSync(pidfileOf(root)), 5_000);
      const before = readRecord(root).at;

      // Block this process's own event loop synchronously — no timer, no I/O
      // callback, nothing this process owns can run here. The beacon is a
      // different process and is unaffected.
      const blockUntil = Date.now() + 200;
      while (Date.now() < blockUntil) { /* busy-wait */ }

      const after = readRecord(root).at;
      expect(after).toBeGreaterThan(before);
    } finally {
      beacon.stop();
    }
  }, 15_000);

  it("self-terminates once its watched parent process is gone, so a truly dead worker's record stops advancing", async () => {
    const { root } = workspace();
    const fixture = await stubbornProcess();
    const identity = { pid: fixture.pid, owner: "beacon-orphan" };
    const beacon = startHeartbeatBeacon(root, identity, { intervalMs: 20, parentPid: fixture.pid });
    await waitFor(() => existsSync(pidfileOf(root)), 5_000);

    fixture.kill("SIGKILL");
    await fixture.exited;
    // Give the beacon time to notice and exit; its own record stops moving.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const staleAt = readRecord(root).at;

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readRecord(root).at).toBe(staleAt);
    beacon.stop();
  }, 15_000);
});

describe("managed production iteration liveness", () => {
  // A managed-production tick is synchronous, so the worker's 5s heartbeat
  // timer cannot fire while it runs. The worker's own record is re-stamped from
  // the same between-Projects point that already re-stamps the preservation
  // projection; without that, a healthy worker mid-tick ages past the freshness
  // window and `worker start` replaces it as if it had hung.
  it("re-stamps the worker's own heartbeat from inside a blocking iteration", () => {
    const { root, logfile } = workspace();
    withDatabase(root, (db) => {
      createProjectWithInitialWork(db, {
        name: "Liveness Fixture Project",
        mission: "Give the tick a Project to walk.",
        status: "active",
        currentMilestone: "Initial milestone",
        nextAction: "Give the tick something to iterate over",
        workClassification: "agent"
      });
    });

    let progress = 0;
    const db = openDatabase(root);
    try {
      runManagedProductionIteration(db, root, logfile, () => { progress += 1; });
    } finally {
      db.close();
    }

    expect(progress).toBeGreaterThan(0);
  });
});

describe("worker install readiness", () => {
  it("refuses clearly when launchd cannot load the worker", () => {
    const { root } = workspace();

    expect(() => runWorkerInstallCommand({ workspace: root }, {
      execFileSync: () => { throw new Error("bootstrap failed"); }
    })).toThrow(/launchctl load failed.*bootstrap failed.*worker was not started/i);
  });

  it("reports ready only after a fresh preservation and Go-route heartbeat", () => {
    const { root } = workspace();
    const load = vi.fn();
    const waitForRoutes = vi.fn(() => true);
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    runWorkerInstallCommand({ workspace: root }, {
      execFileSync: load,
      waitForRoutes,
      now: () => 123_456
    });

    expect(load).toHaveBeenCalledWith("launchctl", expect.arrayContaining(["load"]), { stdio: "pipe" });
    expect(waitForRoutes).toHaveBeenCalledWith(root, 30_000, 123_456);
    expect(output).toHaveBeenCalledWith(expect.stringContaining("preservation and go heartbeats are fresh"));
  });

  it("refuses stale worker readiness without relying on a live launchd service", () => {
    const { root } = workspace();

    expect(() => runWorkerInstallCommand({ workspace: root }, {
      execFileSync: vi.fn(),
      waitForRoutes: () => false
    })).toThrow(/did not publish fresh heartbeats/i);
  });
});

describe("createWorkerTick", () => {
  it("logs a transient SQLITE_BUSY from opening the database and schedules the next tick instead of exiting", () => {
    const { root, logfile } = workspace();
    const scheduled: Array<() => void> = [];
    let opens = 0;
    const openDb = () => {
      opens += 1;
      if (opens === 1) {
        const error = new Error("database is locked") as Error & { code: string };
        error.code = "SQLITE_BUSY";
        throw error;
      }
      return openDatabase(root);
    };

    const tick = createWorkerTick({
      workspacePath: root,
      pid: process.pid,
      logfile,
      openDb,
      schedule: (callback) => { scheduled.push(callback); }
    });

    expect(() => tick()).not.toThrow();
    expect(scheduled).toHaveLength(1);
    const afterFailure = readFileSync(logfile, "utf8");
    expect(afterFailure).toContain("Worker tick error: database is locked");

    // The rescheduled tick opens the real database and completes a real
    // iteration, so a transient open-time failure never ends the loop and the
    // recovery path is clean rather than merely reaching a second open.
    scheduled.shift()!();
    expect(opens).toBe(2);
    expect(scheduled).toHaveLength(1);
    const afterRecovery = readFileSync(logfile, "utf8");
    expect(afterRecovery.slice(afterFailure.length)).not.toContain("Worker tick error:");
  });

  it("summarizes a persistent open failure instead of logging every tick, then reports recovery", () => {
    const { root, logfile } = workspace();
    const scheduled: Array<() => void> = [];
    let failing = true;
    const openDb = () => {
      if (failing) {
        const error = new Error("database is locked") as Error & { code: string };
        error.code = "SQLITE_BUSY";
        throw error;
      }
      return openDatabase(root);
    };

    const tick = createWorkerTick({
      workspacePath: root,
      pid: process.pid,
      logfile,
      openDb,
      schedule: (callback) => { scheduled.push(callback); }
    });

    for (let attempt = 0; attempt < 100; attempt += 1) tick();

    const errorLines = () => readFileSync(logfile, "utf8").split("\n").filter((line) => line.includes("Worker tick error:"));
    // The first failure plus one summary per interval — not one line per tick.
    expect(errorLines()).toHaveLength(4);

    failing = false;
    tick();

    expect(readFileSync(logfile, "utf8")).toContain("Worker tick recovered after 100 consecutive failures.");
    expect(errorLines()).toHaveLength(4);
  });

  it("adds no error line to the log on a healthy tick", () => {
    const { root, logfile } = workspace();
    const scheduled: Array<() => void> = [];

    const tick = createWorkerTick({
      workspacePath: root,
      pid: process.pid,
      logfile,
      schedule: (callback) => { scheduled.push(callback); }
    });

    tick();

    expect(scheduled).toHaveLength(1);
    // A healthy tick adds no log line, so the file may not exist at all.
    const logged = existsSync(logfile) ? readFileSync(logfile, "utf8") : "";
    expect(logged).not.toContain("Worker tick error:");
  });

  it("publishes the preservation heartbeat from a host worker tick", () => {
    const { root, logfile } = workspace();
    const scheduled: Array<() => void> = [];
    vi.stubEnv("CODEX_SANDBOX", "");

    const tick = createWorkerTick({
      workspacePath: root,
      pid: process.pid,
      logfile,
      schedule: (callback) => { scheduled.push(callback); }
    });

    tick();

    expect(preservationTransportReady(root)).toBe(true);
    expect(scheduled).toHaveLength(1);
  });

  it("fences a worker that loses ownership after a blocked iteration", () => {
    const { root, logfile } = workspace();
    const scheduled: Array<() => void> = [];
    let ownershipChecks = 0;
    let ownershipLosses = 0;
    const tick = createWorkerTick({
      workspacePath: root,
      pid: process.pid,
      logfile,
      ownsWorker: () => {
        ownershipChecks += 1;
        return ownershipChecks === 1;
      },
      onOwnershipLost: () => { ownershipLosses += 1; },
      schedule: (callback) => { scheduled.push(callback); }
    });

    tick();

    expect(ownershipLosses).toBe(1);
    expect(scheduled).toHaveLength(0);
  });
});
