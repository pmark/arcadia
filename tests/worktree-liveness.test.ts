import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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


describe("terminal recovery's complete macOS lsof scan", () => {
  let root: string;
  let clear: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-strict-lsof-")));
    roots.push(root);
    mkdirSync(path.join(root, "nested"));
    clear = `p123\ncother\nfcwd\nn${realpathSync(tmpdir())}\n`;
  });
  it.each([
    { status: 1, stdout: clear, stderr: "" },
    { status: 0, stdout: clear, stderr: "lsof: WARNING: cannot stat a filesystem" },
    { status: 1, stdout: clear, stderr: "partial inspection" }
  ])("refuses partial coverage even with parseable unrelated process output: %j", result => {
    expect(lsofProbe(root, { requireCompleteScan: true }, () => result)).toMatchObject({ ok: false });
  });
  it("accepts a complete clear scan and still identifies a live candidate process", () => {
    expect(lsofProbe(root, { requireCompleteScan: true }, () => ({ status: 0, stdout: clear, stderr: "" })))
      .toEqual({ ok: true, processes: [] });
    expect(lsofProbe(root, { requireCompleteScan: true }, () => ({ status: 0, stdout: `p123\ncwriter\nfcwd\nn${root}/nested\n`, stderr: "" })))
      .toEqual({ ok: true, processes: [{ pid: 123, command: "writer", cwd: `${root}/nested` }] });
  });
  it.each(["p123\ncother\n", "p123\ncother\nn\n", "unparseable\np123\ncother\nn/tmp/elsewhere\n"])("refuses incomplete or malformed records despite status zero: %j", stdout => {
    expect(lsofProbe(root, { requireCompleteScan: true }, () => ({ status: 0, stdout, stderr: "" }))).toMatchObject({ ok: false });
  });
  it.each(["unknown", "relative/cwd", "/arcadia-missing-cwd-does-not-exist", "/tmp/deleted (deleted)"])("refuses unusable cwd despite status zero: %s", cwd => {
    expect(lsofProbe(root, { requireCompleteScan: true }, () => ({ status: 0, stdout: `p123\ncother\nfcwd\nn${cwd}\n`, stderr: "" })))
      .toMatchObject({ ok: false });
  });
  it.each(["cother\np123\nfcwd\nn/\n", "p123\ncother\nn/\n", "p123\ncother\nfcwd\nn/\nn/\n", "p123\ncother\nfcwd\nn/\ncother\n"])("refuses invalid cwd record structure: %j", stdout => {
    expect(lsofProbe(root, { requireCompleteScan: true }, () => ({ status: 0, stdout, stderr: "" }))).toMatchObject({ ok: false });
  });
  it("preserves the existing non-recovery caller behavior", () => {
    expect(lsofProbe(root, {}, () => ({ status: 1, stdout: clear, stderr: "partial inspection" })))
      .toEqual({ ok: true, processes: [] });
  });
});
