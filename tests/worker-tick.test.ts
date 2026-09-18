import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerTick } from "../src/commands/worker.js";
import { openDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): { root: string; logfile: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-worker-tick-"));
  temporary.push(root);
  initWorkspace(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  return { root, logfile: path.join(root, ".arcadia", "worker.log") };
}

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
    expect(readFileSync(logfile, "utf8")).toContain("Worker tick error: database is locked");

    // The rescheduled tick opens the real database, so a transient open-time
    // failure never ends the loop.
    scheduled.shift()!();
    expect(opens).toBe(2);
    expect(scheduled).toHaveLength(1);
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
});
