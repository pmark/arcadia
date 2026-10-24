import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { chmodSync, rmSync, readFileSync, mkdtempSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { goTransportFailure } from "./goRequestExecutor.js";
import type { GoTransportResult } from "./goRequestProtocol.js";
import { writePreservationAttempt } from "./preservationRequestExecutor.js";
import type { OwnedValidationResult, PreservationLifecycle, ValidationLaunch } from "./preservationProcessLifecycle.js";

const [source, workspace, attemptFile, token, totalMs] = process.argv.slice(2);
const standalone = source === "--validation";
// A disconnected synchronous caller may have closed this pipe while the owner
// still owes a durable terminal receipt. Pipe delivery never decides custody.
process.stdout.on("error", () => {});
const parentPid = process.ppid;
const parentIPC = typeof process.send === "function";
const parentAlive = () => parentIPC ? process.connected : process.ppid === parentPid;
const socketRoot = mkdtempSync("/tmp/arcadia-owner-");
const socket = `${socketRoot}/control`;
writePreservationAttempt(`${attemptFile}.owner.json`, { token, socket });
const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
const roots = new Set<string>();
const slots = new Set<Promise<unknown>>();
let closing = false;
let unknown = false;
let payload: ChildProcess | undefined;
let result: GoTransportResult | undefined;
let standaloneOutput = false;
let finishPromise: Promise<void> | undefined;

// The trusted leader remains alive until its owner drains the slot. Candidate
// children inherit this group. Candidate-created independent sessions are a
// separate confinement boundary, not covered by this topology proof.
const LEADER = String.raw`
const { spawn } = require('node:child_process');
let started = false;
let stopping = false;
process.on('SIGTERM', () => {});
process.on('message', input => {
  if (input.stop === true && !stopping) {
    stopping = true;
    process.send({stopping:true}, () => process.kill(-process.pid, 'SIGKILL'));
    return;
  }
  if (stopping || started || input.go !== true) return;
  started = true;
  const child = spawn(input.argv[0], input.argv.slice(1), { cwd: input.cwd, env: input.env, stdio: input.payload ? ['ignore','pipe','pipe','ipc'] : ['ignore','pipe','pipe'] });
  if (input.payload) child.on('message', payloadResult => process.send({payloadResult}));
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout = (stdout + b).slice(-1048576); });
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-1048576); });
  child.on('error', e => process.send({done:true,status:null,signal:null,stdout,stderr,error:String(e)}));
  // Direct exit must drain the group even if a grandchild inherited its pipes.
  child.on('exit', (status,signal) => setTimeout(() => process.send({done:true,status,signal,stdout,stderr}), 25));
});
// Owner loss cannot provide a receipt, but a surviving trusted leader can
// still stop its own current group without touching historical identities.
process.on('disconnect', () => process.kill(-process.pid, 'SIGKILL'));
process.send({ready:true});
`;

const live = (child: ChildProcess) => child.pid !== undefined && child.exitCode === null && child.signalCode === null;
function members(pgid: number): number[] | undefined {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,pgid=,stat="], { encoding: "utf8", timeout: 1000 });
  if (result.status !== 0 || result.error) return;
  return result.stdout.trim().split("\n").flatMap(line => {
    const [pid, group, state] = line.trim().split(/\s+/);
    return Number(group) === pgid && !state?.startsWith("Z") ? [Number(pid)] : [];
  });
}
async function stopGroup(child: ChildProcess): Promise<boolean> {
  // Only a live trusted leader can signal its own group identity. The owner
  // never signals a numeric PGID (including after a crash/reap/reuse race).
  let acknowledged = false;
  const acknowledge = (raw: unknown) => { if ((raw as { stopping?: boolean }).stopping) acknowledged = true; };
  child.on("message", acknowledge);
  if (!child.connected) { child.off("message", acknowledge); return false; }
  child.send({ stop: true }, () => {});
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (acknowledged && members(child.pid!)?.length === 0) {
      child.off("message", acknowledge);
      return true;
    }
    if (!acknowledged && !live(child)) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  child.off("message", acknowledge);
  return false;
}

function reply(client: Socket, value: unknown) { if (!client.destroyed) client.end(JSON.stringify(value)); }
async function runSlot(input: ValidationLaunch): Promise<OwnedValidationResult> {
  roots.add(input.executionRoot);
  appendFileSync(`${attemptFile}.slots.jsonl`, JSON.stringify({ stage: "slot.admitted", executionRoot: input.executionRoot, at: Date.now() }) + "\n", { mode: 0o600 });
  const child = spawn(process.execPath, ["-e", LEADER], { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let completed = false;
  let timedOut = false;
  let output: OwnedValidationResult = { status: null, signal: null, stdout: "", stderr: "", timedOut: false, terminalProven: false };
  const stopped = new Promise<void>(resolve => {
    const timer = setTimeout(() => { timedOut = true; completed = true; finish(); }, input.timeoutMs);
    const poll = setInterval(() => { if (closing) { completed = true; finish(); } }, 20);
    const finish = () => { clearTimeout(timer); clearInterval(poll); resolve(); };
    child.on("message", raw => {
      const message = raw as { ready?: boolean; done?: boolean } & OwnedValidationResult;
      if (message.ready) {
        if (!closing && parentAlive() && live(child)) child.send({ go: true, ...input });
        else { completed = true; finish(); }
      }
      if (message.done) { output = message; completed = true; finish(); }
    });
    child.once("error", error => { output.error = String(error); completed = true; finish(); });
    child.once("exit", () => { if (!completed) output.error = "Trusted validation leader exited before drain"; finish(); });
  });
  await stopped;
  output = { ...output, timedOut, terminalProven: await stopGroup(child) };
  appendFileSync(`${attemptFile}.slots.jsonl`, JSON.stringify({ stage: "slot.drained", pgid: child.pid, terminalProven: output.terminalProven, at: Date.now() }) + "\n", { mode: 0o600 });
  if (!output.terminalProven) { unknown = true; void finishAttempt("validation drain unavailable"); }
  return output;
}

async function finishAttempt(reason: string): Promise<void> {
  if (finishPromise) return finishPromise;
  closing = true;
  finishPromise = (async () => {
    // Closing admission precedes waiting for pending startup/launch slots.
    await Promise.all([...slots]);
    if (payload && live(payload)) {
      if (!await stopGroup(payload)) unknown = true;
    } else if (payload) unknown = true;
    const lifecycle: PreservationLifecycle = { state: unknown ? "drain_unknown" : "terminal_proven", token, executionRoots: [...roots], detail: reason };
    if (!unknown && reason !== "standalone completed") for (const root of roots) rmSync(root, { recursive: true, force: true });
    if (standalone && parentAlive() && !standaloneOutput) {
      standaloneOutput = true;
      process.stdout.write(JSON.stringify({ status: null, signal: null, stdout: "", stderr: "", timedOut: false, terminalProven: !unknown, error: reason }));
    }
    const transportResult = result ?? goTransportFailure(new Error(`Protected preservation cancelled: ${reason}`));
    const response = { ...transportResult, lifecycle };
    writePreservationAttempt(`${attemptFile}.owner-result.json`, response);
    server.close();
    if (socketRoot) rmSync(socketRoot, { recursive: true, force: true });
    if (process.connected) process.send?.(response, () => { if (process.connected) process.disconnect(); });
  })();
  return finishPromise;
}
const server = createServer({ allowHalfOpen: true }, client => {
  let bytes = "";
  client.on("data", chunk => { bytes += String(chunk); if (bytes.length > 2 * 1024 * 1024) client.destroy(); });
  client.on("end", () => {
    try {
      const request = JSON.parse(bytes);
      if (request.token !== token) { reply(client, { error: "owner capability mismatch" }); return; }
      if (request.cancel) { void finishAttempt("caller cancellation").then(() => reply(client, { cancelled: true })); return; }
      if (closing || !parentAlive()) { reply(client, { terminalProven: true, status: null, error: "preservation admission closed" }); return; }
      const task = runSlot(request.launch).then(value => reply(client, value)).catch(error => { unknown = true; reply(client, { terminalProven: false, error: String(error) }); });
      slots.add(task);
      void task.finally(() => slots.delete(task));
    } catch { client.destroy(); }
  });
});
process.on("message", raw => { if ((raw as { cancel?: boolean }).cancel) void finishAttempt("caller cancellation"); });
process.once("disconnect", () => { void finishAttempt("parent disconnected"); });
process.once("SIGTERM", () => { void finishAttempt("owner interrupted"); });
process.once("SIGINT", () => { void finishAttempt("owner interrupted"); });
const deadline = setTimeout(() => { void finishAttempt("attempt deadline"); }, Math.max(1, Number(totalMs) - 5000));
deadline.unref();
server.once("error", () => { unknown = true; void finishAttempt("owner socket unavailable"); });
server.listen(socket, () => {
  chmodSync(socket, 0o600);
  if (closing || !parentAlive()) { void finishAttempt("parent disconnected before ready"); return; }
  if (standalone) {
    const poll = setInterval(() => { if (!parentAlive()) void finishAttempt("parent disconnected"); }, 25);
    poll.unref();
    const task = runSlot(JSON.parse(readFileSync(0, "utf8"))).then(output => {
      standaloneOutput = true;
      if (parentAlive()) process.stdout.write(JSON.stringify(output));
    });
    slots.add(task);
    void task.finally(() => { slots.delete(task); void finishAttempt("standalone completed"); });
    return;
  }
  payload = spawn(process.execPath, ["-e", LEADER], { detached: true, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  payload.on("message", raw => {
    const message = raw as { ready?: boolean; payloadResult?: GoTransportResult; done?: boolean; status?: number; signal?: string; error?: string };
    if (message.ready && !closing && parentAlive()) payload!.send({ go: true, payload: true,
      argv: [process.execPath, ...(extension === "ts" ? ["--import", import.meta.resolve("tsx")] : []),
        fileURLToPath(new URL(`./preservationRequestPayload.${extension}`, import.meta.url)), source, workspace, attemptFile],
      env: { ...process.env, ARCADIA_PRESERVATION_OWNER_SOCKET: socket, ARCADIA_PRESERVATION_OWNER_TOKEN: token }
    });
    if (message.payloadResult) { result = message.payloadResult; void finishAttempt("payload completed"); }
    if (message.done && !closing) {
      result = goTransportFailure(new Error(`Protected preservation payload exited without a result (${message.error ?? message.signal ?? message.status}).`));
      void finishAttempt("payload exited");
    }
  });
  payload.once("error", () => { unknown = true; void finishAttempt("payload spawn failed"); });
  payload.once("exit", () => { if (!closing) void finishAttempt("payload exited"); });
  process.send?.({ ready: true });
});
