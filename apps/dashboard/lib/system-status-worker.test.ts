import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readManagedRunWorker } from "./system-status";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspaceWithPidfile(contents: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-system-status-"));
  roots.push(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  writeFileSync(path.join(root, ".arcadia", "worker.pid"), contents);
  return root;
}

describe("readManagedRunWorker (Issue #582)", () => {
  it("reads the JSON pidfile the worker actually writes", async () => {
    const at = Date.now();
    const root = workspaceWithPidfile(JSON.stringify({ pid: process.pid, owner: "uuid", at }));
    const worker = await readManagedRunWorker(root);
    expect(worker.running).toBe(true);
    expect(worker.heartbeat).toEqual({ timestamp: new Date(at).toISOString(), fresh: true, available: true });
  });

  it("reports a stale pidfile record as running but not fresh", async () => {
    const root = workspaceWithPidfile(JSON.stringify({ pid: process.pid, owner: "uuid", at: Date.now() - 120_000 }));
    const worker = await readManagedRunWorker(root);
    expect(worker.running).toBe(true);
    expect(worker.heartbeat.fresh).toBe(false);
  });

  it("reports stopped when the recorded pid is not alive or the record is unreadable", async () => {
    const dead = await readManagedRunWorker(workspaceWithPidfile(JSON.stringify({ pid: 2_147_483_646, owner: "uuid", at: Date.now() })));
    expect(dead.running).toBe(false);
    const garbage = await readManagedRunWorker(workspaceWithPidfile("not a pidfile"));
    expect(garbage.running).toBe(false);
  });

  it("still reads the older plain-integer pidfile", async () => {
    const worker = await readManagedRunWorker(workspaceWithPidfile(String(process.pid)));
    expect(worker.running).toBe(true);
  });
});
