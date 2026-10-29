#!/usr/bin/env node
// Session capability probe: runs INSIDE the coding Session as its first step.
// Deterministic; its cost is one short Bash command. Required DB writes use
// Arcadia's existing SQLite dependency inside a rolled-back transaction.
//
//   node scripts/session-capability-probe.mjs --workspace <dir> --worktree <dir> --nonce <hex>
//   (the host accepts only the exact command/result and nonce-bound contract digest)
//   (or ARCADIA_WORKSPACE / ARCADIA_PROBE_WORKTREE; the worktree defaults to cwd)
//
// Prints exactly one JSON line {probe, ok, checks:[{name, ok, error?}], ms} and
// exits 1 when any check failed. Check names are the environment-wall classes
// the worker understands: workspace_write, host_validation, preservation.
// It commits no database changes. Source-only Sessions never open the DB.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const started = Date.now();
const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const workspace = arg("workspace") ?? process.env.ARCADIA_WORKSPACE;
const worktree = path.resolve(arg("worktree") ?? process.env.ARCADIA_PROBE_WORKTREE ?? process.cwd());
const contract = arg("contract") ?? null;
const workspaceWrite = arg("workspace-write") ?? "required";
const token = `.session-capability-probe-${process.pid}-${started}`;

function check(name, fn) {
  try {
    fn();
    return { name, ok: true };
  } catch (error) {
    const message = error instanceof Error
      ? `${typeof error.code === "string" ? `${error.code}: ` : ""}${error.message}`
      : String(error);
    return { name, ok: false, error: message.slice(0, 240) };
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

function probeDatabaseWrite() {
  if (!workspace) throw new Error("no workspace path given (--workspace or ARCADIA_WORKSPACE)");
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(path.join(workspace, "database", "arcadia.sqlite3"), { fileMustExist: true, timeout: 1000 });
  try {
    // BEGIN IMMEDIATE alone can succeed without opening a rollback journal.
    // Writing the existing header value forces an actual main-DB write and
    // journal permission check without depending on any application table.
    const version = db.pragma("user_version", { simple: true });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.pragma(`user_version = ${version}`);
    } finally {
      if (db.inTransaction) db.exec("ROLLBACK");
    }
  } finally {
    db.close();
  }
}

const checks = [
  workspaceWrite === "unavailable"
    ? { name: "workspace_write", ok: false, required: false, unavailable: true }
    : check("workspace_write", probeDatabaseWrite),
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

const ok = checks.every((entry) => entry.required === false || entry.ok);
// Echo only a digest binding, never the nonce or a caller-supplied requirement.
process.stdout.write(`${JSON.stringify({ probe: "session-capability/v2", contract, ok, checks, ms: Date.now() - started })}\n`);
process.exit(ok ? 0 : 1);
