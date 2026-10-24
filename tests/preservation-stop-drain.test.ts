import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { processPreservationRequests } from "../src/sessions/preservationTransport.js";
import { preservationFixture } from "../scripts/preservation-fixture.js";
import { executeHostPreservation, readPreservationAttempt } from "../src/sessions/preservationRequestExecutor.js";
import { custodyPath, drainPreservationWorkspace, ownerRequest, runOwnedValidation, runOwnedValidationAsync } from "../src/sessions/preservationProcessLifecycle.js";

const roots: string[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = read(); if (value !== undefined) return value; await sleep(25); }
  throw new Error("bounded process fixture did not reach expected state");
}
function running(pid: number): boolean {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  return result.status === 0 && !result.stdout.trim().startsWith("Z");
}
const root = () => { const value = mkdtempSync(path.join(tmpdir(), "arcadia-drain-test-")); roots.push(value); return value; };
afterEach(context => { if (context.task.result?.state === "fail") return; for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });

// Real processes, no kill-call mock. These reviewed fixture commands keep all
// descendants in their trusted leader's group; independently detached candidate
// code is outside this topology contract. Host sandbox proof is separately gated.
describe("owned validation groups", () => {
  it("does not launch a pre-aborted command and drains cancellation during startup", async () => {
    const executionRoot = root(); const controller = new AbortController(); controller.abort();
    const input = { argv: [process.execPath, "-e", "require('node:fs').writeFileSync('started','yes'); setTimeout(()=>{},3000)"], cwd: executionRoot, env: {}, timeoutMs: 5000, executionRoot };
    expect(await runOwnedValidationAsync(input, controller.signal)).toMatchObject({ terminalProven: true, status: null });
    expect(existsSync(path.join(executionRoot, "started"))).toBe(false);
    const startup = new AbortController();
    const operation = runOwnedValidationAsync(input, startup.signal); startup.abort();
    expect(await operation).toMatchObject({ terminalProven: true, status: null });
    expect(existsSync(path.join(executionRoot, "started"))).toBe(false);
  });
  it("workspace cancellation drains a standalone owner while its parent is still alive", async () => {
    const workspace = root(); const executionRoot = root();
    const operation = runOwnedValidationAsync({ argv: [process.execPath, "-e", "require('node:fs').writeFileSync('started',String(process.pid)); setTimeout(()=>{},20000)"],
      cwd: executionRoot, env: {}, timeoutMs: 25_000, executionRoot, workspace });
    const pid = await until(() => existsSync(path.join(executionRoot, "started")) ? Number(readFileSync(path.join(executionRoot, "started"), "utf8")) : undefined);
    const started = Date.now();
    const proof = await drainPreservationWorkspace(workspace);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(proof).toMatchObject([{ state: "terminal_proven" }]);
    expect(await operation).toMatchObject({ terminalProven: true, status: null });
    expect(running(pid)).toBe(false);
  }, 10_000);
  it("owner crash stops held groups but keeps missing durable proof unresolved", async () => {
    const workspace = root(); const executionRoot = root();
    const operation = runOwnedValidationAsync({ argv: [process.execPath, "-e", "require('node:fs').writeFileSync('started',JSON.stringify([process.pid,process.ppid])); setTimeout(()=>{},3000)"],
      cwd: executionRoot, env: {}, timeoutMs: 5000, executionRoot, workspace });
    // Register the expected failure handler before killing this fixture's owner.
    const failure = expect(operation).rejects.toThrow(/no terminal proof/);
    const [command, leader] = await until(() => existsSync(path.join(executionRoot, "started")) ? JSON.parse(readFileSync(path.join(executionRoot, "started"), "utf8")) as number[] : undefined);
    const owner = Number(spawnSync("/bin/ps", ["-p", String(leader), "-o", "ppid="], { encoding: "utf8" }).stdout.trim());
    expect(owner).toBeGreaterThan(1);
    process.kill(owner, "SIGKILL"); // exact newly observed fixture owner, never recovery signaling
    await failure;
    await until(() => running(command) || running(leader) ? undefined : true);
    expect(existsSync(executionRoot)).toBe(true);
    await expect(drainPreservationWorkspace(workspace, 100)).rejects.toThrow(/no terminal proof/);
  }, 10_000);
  it("refuses an unresolved durable custody marker after caller restart even for dead aged claim", async () => {
    const f = preservationFixture(); roots.push(f.root, f.candidate);
    const file = custodyPath(f.workspace, f.lease.id);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ token: "lost-owner", attemptFile: path.join(path.dirname(file), "lost.attempt") }));
    writeFileSync(path.join(f.candidate, ".arcadia-preserve-request"), JSON.stringify({ nonce: "00000000-0000-0000-0000-000000000000" }));
    withDatabase(f.workspace, db => db.prepare("INSERT INTO candidate_preservation_claims (session_id,pid,token,claimed_at) VALUES (?,?,?,?)").run(f.lease.id, 999999999, "lost-owner", 1));
    const execute = vi.fn();
    expect(withDatabase(f.workspace, db => processPreservationRequests(db, f.workspace, { executeHostPreservation: execute }))).toBe(true);
    vi.resetModules();
    const restarted = await import("../src/sessions/preservationTransport.js");
    expect(withDatabase(f.workspace, db => restarted.processPreservationRequests(db, f.workspace, { executeHostPreservation: execute }))).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(withDatabase(f.workspace, db => db.prepare("SELECT token FROM candidate_preservation_claims WHERE session_id=?").get(f.lease.id))).toEqual({ token: "lost-owner" });
  });

  it("drains lingering descendants before returning, then admits a second command", () => {
    const executionRoot = root();
    const code = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'inherit'}); console.log(c.pid); c.unref();`;
    const first = runOwnedValidation({ argv: [process.execPath, "-e", code], cwd: executionRoot, env: { PATH: process.env.PATH }, timeoutMs: 2000, executionRoot });
    expect(first).toMatchObject({ status: 0, terminalProven: true });
    expect(running(Number(first.stdout.trim()))).toBe(false);
    const second = runOwnedValidation({ argv: [process.execPath, "-e", "console.log('second')"], cwd: executionRoot, env: {}, timeoutMs: 2000, executionRoot });
    expect(second).toMatchObject({ status: 0, stdout: "second\n", terminalProven: true });
  });
  it("proves terminal after timeout and spawn error", () => {
    const executionRoot = root();
    const timed = runOwnedValidation({ argv: [process.execPath, "-e", "console.log(process.pid); setTimeout(()=>{},20000)"], cwd: executionRoot, env: {}, timeoutMs: 250, executionRoot });
    expect(timed).toMatchObject({ timedOut: true, terminalProven: true });
    const missing = runOwnedValidation({ argv: ["/nonexistent/arcadia-command"], cwd: executionRoot, env: {}, timeoutMs: 1000, executionRoot });
    expect(missing).toMatchObject({ status: null, terminalProven: true, error: expect.stringContaining("ENOENT") });
  });
});

const host = process.env.ARCADIA_PRESERVATION_HOST_TEST === "1" && !process.env.CODEX_SANDBOX;
describe.skipIf(!host)("real protected preservation interruption", () => {
  function fixture() {
    // Both the candidate command and its nested worker remain alive long enough
    // for independent observation; their own finite timers bound test teardown.
    const code = `const fs=require('node:fs'); const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setTimeout(()=>{},6000)'],{stdio:'ignore'}); fs.writeFileSync(process.env.TMPDIR+'/owned-pids.json',JSON.stringify([process.pid,c.pid,process.ppid])); setTimeout(()=>{},6000);`;
    const f = preservationFixture(undefined, "node owned.cjs", repo => writeFileSync(path.join(repo, "owned.cjs"), code));
    roots.push(f.root, f.candidate);
    const attemptFile = path.join(f.workspace, "artifacts", "preservation", f.lease.id, "test.attempt.json");
    return { ...f, attemptFile };
  }
  async function pids(attemptFile: string) {
    return until(() => {
      const attempt = readPreservationAttempt(attemptFile) as { executionRoot?: string } | undefined;
      // Later progress retains evidence but not executionRoot; use journal too.
      let executionRoot = attempt?.executionRoot;
      if (!executionRoot) try { executionRoot = readFileSync(`${attemptFile}.events.jsonl`, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).find(v => v.executionRoot)?.executionRoot; } catch { /* not yet started */ }
      if (!executionRoot) return;
      const file = path.join(executionRoot, "scratch", "owned-pids.json");
      if (!existsSync(file)) return;
      return { executionRoot, values: JSON.parse(readFileSync(file, "utf8")) as number[] };
    });
  }

  it("admits two sequential slots in one attempt after first lingering descendant is terminal", async () => {
    const first = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const c=spawn(process.execPath,['-e','setTimeout(()=>{},6000)'],{stdio:'ignore'}); fs.writeFileSync(process.env.TMPDIR+'/first-pid',String(c.pid)); c.unref();`;
    const second = `require('node:fs').writeFileSync(process.env.TMPDIR+'/second-started','yes'); setTimeout(()=>{},1000);`;
    const f = preservationFixture(undefined, ["node first.cjs", "node second.cjs"], repo => {
      writeFileSync(path.join(repo, "first.cjs"), first); writeFileSync(path.join(repo, "second.cjs"), second);
    });
    roots.push(f.root, f.candidate);
    const attemptFile = path.join(f.workspace, "artifacts", "preservation", f.lease.id, "sequential.attempt.json");
    const operation = executeHostPreservation({ source: f.candidate, workspace: f.workspace, attemptFile });
    await until(() => {
      try {
        const events = readFileSync(`${attemptFile}.events.jsonl`, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
        const executionRoot = events.find(v => v.executionRoot)?.executionRoot;
        if (!executionRoot || !existsSync(path.join(executionRoot, "scratch/second-started"))) return;
        expect(running(Number(readFileSync(path.join(executionRoot, "scratch/first-pid"), "utf8")))).toBe(false);
        return true;
      } catch (error) { if (error instanceof Error && "code" in error) return; throw error; }
    });
    expect(await operation).toMatchObject({ ok: true, lifecycle: { state: "terminal_proven" } });
    const slots = readFileSync(`${attemptFile}.slots.jsonl`, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(slots.map(v => v.stage)).toEqual(["slot.admitted", "slot.drained", "slot.admitted", "slot.drained"]);
    expect(slots.filter(v => v.stage === "slot.drained").every(v => v.terminalProven)).toBe(true);
  }, 15_000);
  it("cancels protected validation and nested workers before cleanup/terminal result", async () => {
    const f = fixture(); const controller = new AbortController();
    const operation = executeHostPreservation({ source: f.candidate, workspace: f.workspace, attemptFile: f.attemptFile, signal: controller.signal });
    const observed = await pids(f.attemptFile);
    expect(observed.values.every(running)).toBe(true);
    controller.abort();
    const result = await operation;
    expect(result).toMatchObject({ ok: false, lifecycle: { state: "terminal_proven" } });
    expect(observed.values.some(running)).toBe(false);
    expect(existsSync(observed.executionRoot)).toBe(false);
  }, 15_000);
  it("drains on parent disconnect and exposes durable workspace proof", async () => {
    const f = fixture(); const token = "disconnect-test";
    mkdirSync(path.dirname(f.attemptFile), { recursive: true });
    writeFileSync(custodyPath(f.workspace, f.lease.id), JSON.stringify({ token, attemptFile: f.attemptFile }));
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), path.resolve("src/sessions/preservationRequestWorker.ts"), f.candidate, f.workspace, f.attemptFile, token, "20000"], { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const observed = await pids(f.attemptFile);
    child.disconnect();
    const proof = await drainPreservationWorkspace(f.workspace);
    expect(proof).toMatchObject([{ token, state: "terminal_proven" }]);
    expect(observed.values.some(running)).toBe(false);
    expect(existsSync(observed.executionRoot)).toBe(false);
  }, 15_000);
  it("retains roots and custody after trusted leader loss, never claims terminal", async () => {
    const f = fixture(); const controller = new AbortController();
    const operation = executeHostPreservation({ source: f.candidate, workspace: f.workspace, attemptFile: f.attemptFile, signal: controller.signal });
    const observed = await pids(f.attemptFile);
    process.kill(observed.values[2], "SIGKILL"); // fixture's exact trusted leader
    const result = await operation;
    expect(result.lifecycle.state).toBe("drain_unknown");
    expect(existsSync(observed.executionRoot)).toBe(true);
    // Surviving command ends on its own fixed deadline; no historical group kill.
    await until(() => observed.values.some(running) ? undefined : true, 9000);
    await expect(ownerRequest(JSON.parse(readFileSync(`${f.attemptFile}.owner.json`, "utf8")).socket, { token: result.lifecycle.token, cancel: true })).rejects.toThrow();
  }, 15_000);
});
