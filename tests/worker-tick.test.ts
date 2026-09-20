import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerTick, decideWorkerStart, isProcessAlive, runWorkerInstallCommand } from "../src/commands/worker.js";
import { openDatabase } from "../src/db/connection.js";
import { preservationTransportReady } from "../src/sessions/preservationTransport.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { runCli } from "./cli-response-fixture.js";

const temporary: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): { root: string; logfile: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-worker-tick-"));
  temporary.push(root);
  initWorkspace(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  return { root, logfile: path.join(root, ".arcadia", "worker.log") };
}

describe("worker start already-running guard", () => {
  it("starts when no live worker owns the pidfile", () => {
    expect(decideWorkerStart(null, () => true)).toEqual({ action: "start", pid: null });
    expect(decideWorkerStart({ pid: 4242, owner: "old" }, () => false)).toEqual({ action: "start", pid: null });
  });

  it("treats a live pidfile holder as already running rather than a failure", () => {
    expect(decideWorkerStart({ pid: 4242, owner: "worker" }, () => true)).toEqual({ action: "already-running", pid: 4242 });
  });

  it("does not replace a live worker merely because its heartbeat is stale", () => {
    expect(decideWorkerStart({ pid: 4242, owner: "stale" }, () => true)).toEqual({ action: "already-running", pid: 4242 });
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
    writeFileSync(path.join(root, ".arcadia", "worker.pid"), JSON.stringify({ pid: process.pid, owner: "existing", at: Date.now() }), "utf8");

    const result = runCli(["worker", "start", "--workspace", root]);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("already running");
    expect(result.stdout).toContain("already running");
  });

  it("does not replace a live legacy numeric pidfile before the worker has restarted", () => {
    const { root } = workspace();
    const pidfile = path.join(root, ".arcadia", "worker.pid");
    writeFileSync(pidfile, String(process.pid), "utf8");

    const result = runCli(["worker", "start", "--workspace", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Legacy worker still running");
    expect(readFileSync(pidfile, "utf8")).toBe(String(process.pid));
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
