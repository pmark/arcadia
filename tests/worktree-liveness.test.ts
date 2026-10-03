import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lsofProbe, probeWorktreeLiveness } from "../src/sessions/worktreeLiveness.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// The probe reads /proc on Linux (ubuntu-latest CI) and lsof elsewhere.
const probeAvailable = existsSync("/proc/self/cwd") || !spawnSync("lsof", ["-v"]).error;

describe("probeWorktreeLiveness against the real host process table (Issue #884)", () => {
  it.skipIf(!probeAvailable)("detects a process whose cwd is inside the worktree, and none once it exits (skipped only when neither /proc nor lsof exists)", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-liveness-")));
    roots.push(root);
    const worktree = path.join(root, "repo");
    mkdirSync(path.join(worktree, "nested"), { recursive: true });

    const child = spawn("sleep", ["30"], { cwd: path.join(worktree, "nested"), stdio: "ignore" });
    try {
      const live = probeWorktreeLiveness(worktree);
      expect(live.ok).toBe(true);
      expect(live.ok && live.processes.map((entry) => entry.pid)).toContain(child.pid);
    } finally {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }

    const after = probeWorktreeLiveness(worktree);
    expect(after).toEqual({ ok: true, processes: [] });
  });

  it("fails closed on the lsof path for a worktree path lsof would escape (non-ASCII)", () => {
    const result = lsofProbe("/tmp/arcadia-caf\u00e9/repo");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("non-ASCII");
  });

  it("reports a worktree path that does not exist as unable to tell", () => {
    const missing = path.join(tmpdir(), "arcadia-liveness-missing-does-not-exist");
    expect(probeWorktreeLiveness(missing).ok).toBe(false);
  });
});
