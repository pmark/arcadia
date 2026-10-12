#!/usr/bin/env node
// Session capability probe: runs INSIDE the coding Session as its first step.
// Dependency-free and deterministic; its cost is one short Bash command.
//
//   node scripts/session-capability-probe.mjs --workspace <dir> --worktree <dir> --nonce <hex>
//   (the host accepts only a probe line echoing the Session's recorded nonce)
//   (or ARCADIA_WORKSPACE / ARCADIA_PROBE_WORKTREE; the worktree defaults to cwd)
//
// Prints exactly one JSON line {probe, ok, checks:[{name, ok, error?}], ms} and
// exits 1 when any check failed. Check names are the environment-wall classes
// the worker understands: workspace_write, host_validation, preservation.
// It never touches the SQLite file itself: only a uniquely named temp file
// beside it, removed afterwards.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const started = Date.now();
const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const workspace = arg("workspace") ?? process.env.ARCADIA_WORKSPACE;
const worktree = path.resolve(arg("worktree") ?? process.env.ARCADIA_PROBE_WORKTREE ?? process.cwd());
const nonce = arg("nonce") ?? process.env.ARCADIA_PROBE_NONCE ?? null;
const token = `.session-capability-probe-${process.pid}-${started}`;

function check(name, fn) {
  try {
    fn();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 240) };
  }
}

function writeReadDelete(file, expected) {
  const fd = openSync(file, "w");
  try {
    writeSync(fd, expected);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    if (readFileSync(file, "utf8") !== expected) throw new Error(`read-back mismatch for ${file}`);
  } finally {
    unlinkSync(file);
  }
}

const checks = [
  check("workspace_write", () => {
    if (!workspace) throw new Error("no workspace path given (--workspace or ARCADIA_WORKSPACE)");
    writeReadDelete(path.join(workspace, "database", token), "probe");
  }),
  check("host_validation", () => {
    const result = spawnSync(process.execPath, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`node --version exited ${result.status}`);
  }),
  check("preservation", () => {
    // The completion receipt is a drafted Ask under the worktree's .arcadia/asks.
    const dir = path.join(worktree, ".arcadia", "asks");
    mkdirSync(dir, { recursive: true });
    writeReadDelete(path.join(dir, token), "receipt-probe");
  })
];

const ok = checks.every((entry) => entry.ok);
process.stdout.write(`${JSON.stringify({ probe: "session-capability/v1", nonce, ok, checks, ms: Date.now() - started })}\n`);
process.exit(ok ? 0 : 1);
