import { randomUUID } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { connect } from "node:net";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationError } from "../cli/errors.js";

export interface PreservationLifecycle {
  state: "terminal_proven" | "drain_unknown";
  token: string;
  executionRoots: string[];
  detail?: string;
}
export interface OwnedValidationResult {
  status: number | null; signal: NodeJS.Signals | null;
  stdout: string; stderr: string; error?: string; timedOut: boolean;
  terminalProven: boolean;
}
export interface ValidationLaunch {
  argv: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; executionRoot: string; workspace?: string;
}
export interface PreservationCustody { token: string; attemptFile: string }
export const custodyPath = (workspace: string, session: string) => path.join(workspace, "artifacts", "preservation", session, "custody.json");
export function terminalCustody(custody: PreservationCustody): boolean {
  try {
    const result = JSON.parse(readFileSync(`${custody.attemptFile}.owner-result.json`, "utf8"));
    return result.lifecycle?.token === custody.token && result.lifecycle?.state === "terminal_proven";
  } catch { return false; }
}

/** Host-only synchronous bridge. The socket/token are never given to candidate
 * code: validators build their existing scrubbed environment and Seatbelt argv. */
export function runOwnedValidation(input: ValidationLaunch): OwnedValidationResult {
  const socket = process.env.ARCADIA_PRESERVATION_OWNER_SOCKET;
  const token = process.env.ARCADIA_PRESERVATION_OWNER_TOKEN;
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const result = spawnSync(process.execPath, [
    ...(extension === "ts" ? ["--import", import.meta.resolve("tsx")] : []),
    fileURLToPath(new URL(`./preservationValidationClient.${extension}`, import.meta.url))
  ], { input: JSON.stringify({ socket, token, launch: input }), encoding: "utf8", maxBuffer: 3 * 1024 * 1024,
    timeout: input.timeoutMs + 15_000, killSignal: "SIGKILL" });
  try {
    if (result.status !== 0 || result.error) throw new Error(result.error?.message ?? result.stderr);
    return JSON.parse(result.stdout) as OwnedValidationResult;
  } catch (error) {
    throw validationError("Protected validation lifecycle proof is unavailable; execution root retained.", { executionRoot: input.executionRoot, cause: String(error) });
  }
}

export function ownerRequest(socket: string, request: unknown, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = connect(socket);
    let bytes = "";
    const timer = setTimeout(() => client.destroy(new Error("Preservation owner request timed out")), timeoutMs);
    client.once("connect", () => client.end(JSON.stringify(request) + "\n"));
    client.on("data", chunk => { bytes += String(chunk); });
    client.once("error", reject);
    client.once("close", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(bytes)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
    });
  });
}

export function preservationCustodies(workspace: string): PreservationCustody[] {
  const root = path.join(workspace, "artifacts", "preservation");
  const custody: PreservationCustody[] = [];
  if (existsSync(root)) for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = custodyPath(workspace, dir.name);
    if (existsSync(file)) custody.push(JSON.parse(readFileSync(file, "utf8")));
  }
  return custody;
}
export function hasUnresolvedPreservationCustody(workspace: string): boolean {
  return preservationCustodies(workspace).some(value => !terminalCustody(value));
}

/** Requires the enclosing caller to have stopped its dispatch loop. Observes
 * durable token-bound receipts, never kills a PID recovered from a journal.
 * Owners also autonomously drain on parent IPC disconnect. */
export async function drainPreservationWorkspace(workspace: string, timeoutMs = 10_000): Promise<PreservationLifecycle[]> {
  const custody = preservationCustodies(workspace);
  await Promise.all(custody.filter(value => !terminalCustody(value)).map(async value => {
    try {
      const owner = JSON.parse(readFileSync(`${value.attemptFile}.owner.json`, "utf8"));
      if (owner.token !== value.token) throw new Error("owner token mismatch");
      await ownerRequest(owner.socket, { token: value.token, cancel: true });
    }
    catch { /* Crash/disconnect is not proof: keep observing the durable receipt. */ }
  }));
  const deadline = Date.now() + timeoutMs;
  while (!custody.every(terminalCustody) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (!custody.every(terminalCustody)) throw validationError("Preservation drain has no terminal proof; retain workspace, claims and execution roots.", {
    attempts: custody.filter(value => !terminalCustody(value)), workspace
  });
  return custody.map(value => JSON.parse(readFileSync(`${value.attemptFile}.owner-result.json`, "utf8")).lifecycle as PreservationLifecycle);
}

/** Async enclosing-launcher form of the same fixed lifecycle owner. The caller
 * awaits result before removing its control directory or draining its workspace. */
export function runOwnedValidationAsync(input: ValidationLaunch, signal?: AbortSignal): Promise<OwnedValidationResult> {
  if (signal?.aborted) return Promise.resolve({ status: null, signal: null, stdout: "", stderr: "", timedOut: false, terminalProven: true, error: "cancelled before launch" });
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const token = randomUUID();
  let attemptFile = `${input.executionRoot}.attempt`;
  if (input.workspace) {
    const session = `validation-${token}`;
    const file = custodyPath(input.workspace, session);
    mkdirSync(path.dirname(file), { recursive: true });
    attemptFile = path.join(path.dirname(file), "validation.attempt.json");
    writeFileSync(file, JSON.stringify({ token, attemptFile }), { mode: 0o600 });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      ...(extension === "ts" ? ["--import", import.meta.resolve("tsx")] : []),
      fileURLToPath(new URL(`./preservationRequestWorker.${extension}`, import.meta.url)),
      "--validation", "", attemptFile, token, String(input.timeoutMs + 10_000)
    ], { detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"] });
    let stdout = "", stderr = "";
    child.stdout!.on("data", bytes => { stdout = (stdout + String(bytes)).slice(-3 * 1024 * 1024); });
    child.stderr!.on("data", bytes => { stderr = (stderr + String(bytes)).slice(-4000); });
    const cancel = () => { if (child.connected) child.send({ cancel: true }, () => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdin!.end(JSON.stringify(input));
    if (signal?.aborted) cancel();
    const bound = setTimeout(() => { cancel(); reject(validationError("Owned launcher terminal proof timed out; retain execution roots.", { executionRoot: input.executionRoot })); }, input.timeoutMs + 15_000);
    child.once("error", reject);
    child.once("close", code => {
      clearTimeout(bound); signal?.removeEventListener("abort", cancel);
      try {
        if (code !== 0) throw new Error(stderr || `owner exited ${code}`);
        resolve(JSON.parse(stdout));
      } catch (error) { reject(validationError("Owned launcher has no terminal proof; retain execution roots.", { executionRoot: input.executionRoot, cause: String(error) })); }
    });
  });
}

/** Synchronous adapter for the existing synchronous replay runner. */
export function drainPreservationWorkspaceSync(workspace: string, timeoutMs = 10_000): PreservationLifecycle[] {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const result = spawnSync(process.execPath, [
    ...(extension === "ts" ? ["--import", import.meta.resolve("tsx")] : []),
    fileURLToPath(new URL(`./preservationValidationClient.${extension}`, import.meta.url))
  ], { input: JSON.stringify({ drainWorkspace: workspace, timeoutMs }), encoding: "utf8", timeout: timeoutMs + 6000 });
  if (result.status !== 0 || result.error) throw validationError("Replay drain has no terminal proof; retain replay root.", { workspace, cause: result.error?.message ?? result.stderr });
  return JSON.parse(result.stdout) as PreservationLifecycle[];
}
