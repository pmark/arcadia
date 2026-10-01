import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeError, validationError } from "../cli/errors.js";
import { goTransportFailure } from "./goRequestExecutor.js";
import type { GoTransportResult } from "./goRequestProtocol.js";

export const PRESERVATION_EXECUTION_TIMEOUT_MS = 1_320_000;
export const PRESERVATION_STAGE_TIMEOUT_MS = 150_000;

export interface PreservationAttempt {
  stage: string;
  at: number;
  evidenceRef?: string;
  command?: string;
}

/** Journal files are host-owned; no caller-supplied command or proof crosses IPC. */
export function writePreservationAttempt(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

export function readPreservationAttempt(file: string): PreservationAttempt | undefined {
  try { return JSON.parse(readFileSync(file, "utf8")) as PreservationAttempt; } catch { return; }
}

/** Each attempt owns one process group. Kill the checks too, and wait for the
 * child exit before releasing the claim or reporting a result. */
export async function executeHostPreservation(input: {
  source: string; workspace: string; attemptFile: string; onSpawn?: (pid: number) => void;
}, limits = { total: PRESERVATION_EXECUTION_TIMEOUT_MS, stage: PRESERVATION_STAGE_TIMEOUT_MS }): Promise<GoTransportResult> {
  if (process.env.CODEX_SANDBOX) throw validationError("Preservation execution must run on the host.");
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const startedAt = Date.now();
  writePreservationAttempt(input.attemptFile, { stage: "host.start", at: startedAt });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      ...(extension === "ts" ? ["--import", import.meta.resolve("tsx")] : []),
      fileURLToPath(new URL(`./preservationRequestWorker.${extension}`, import.meta.url)),
      input.source, input.workspace, input.attemptFile
    ], { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let result: GoTransportResult | undefined;
    let failure: GoTransportResult | undefined;
    let stderr = "";
    child.stderr?.on("data", bytes => { stderr = (stderr + String(bytes)).slice(-4000); });
    child.once("message", message => { result = message as GoTransportResult; });
    const timer = setInterval(() => {
      if (failure) return;
      const last = readPreservationAttempt(input.attemptFile);
      if (Date.now() - startedAt < limits.total && Date.now() - (last?.at ?? startedAt) < limits.stage) return;
      failure = goTransportFailure(validationError(`Protected preservation timed out at stage ${last?.stage ?? "host.start"}; candidate and evidence retained.`, {
        stage: last?.stage ?? "host.start", evidenceRef: last?.evidenceRef ?? null,
        attemptRef: input.attemptFile, command: last?.command ?? null,
        remedy: "Inspect the retained attempt and validation receipt, then retry through protected preservation; a commit may already exist and will be recovered by its trailer. Do not clear claims or bypass validation."
      }));
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") process.stderr.write(`Could not stop preservation child: ${String(error)}\n`); }
      }
    }, Math.min(250, limits.stage));
    const finish = (value: GoTransportResult) => {
      clearInterval(timer);
      try {
        writePreservationAttempt(`${input.attemptFile}.result.json`, { result: value, stderr, finishedAt: new Date().toISOString() });
        resolve(value);
      } catch (error) { reject(normalizeError(error)); }
    };
    child.once("error", error => { failure = goTransportFailure(error); });
    child.once("close", (code, signal) => finish(failure ?? (code === 0 ? result : undefined) ?? goTransportFailure(validationError(
      "Protected preservation child exited without a response; candidate and evidence retained.",
      { ...readPreservationAttempt(input.attemptFile), attemptRef: input.attemptFile, code, signal, stderr }
    ))));
    try { if (child.pid) input.onSpawn?.(child.pid); }
    catch (error) {
      failure = goTransportFailure(error);
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    }
  });
}
