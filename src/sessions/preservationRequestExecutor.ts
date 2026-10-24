import { randomUUID } from "node:crypto";
import type { PreservationLifecycle } from "./preservationProcessLifecycle.js";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeError, validationError } from "../cli/errors.js";
import { goTransportFailure } from "./goRequestExecutor.js";
import type { GoTransportResult } from "./goRequestProtocol.js";
import { PRESERVATION_STAGE_TIMEOUT_MS } from "./preservationStages.js";

export { PRESERVATION_STAGE_TIMEOUT_MS };
export const PRESERVATION_EXECUTION_TIMEOUT_MS = 1_320_000;

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

/** The async attempt owner controls payload and validation groups. Cancellation
 * requests a drain; parent exit alone never supplies terminal proof. */
export async function executeHostPreservation(input: {
  source: string; workspace: string; attemptFile: string; custodyToken?: string; signal?: AbortSignal; onSpawn?: (pid: number) => void;
}, limits = { total: PRESERVATION_EXECUTION_TIMEOUT_MS, stage: PRESERVATION_STAGE_TIMEOUT_MS }): Promise<GoTransportResult & { lifecycle: PreservationLifecycle }> {
  if (process.env.CODEX_SANDBOX) throw validationError("Preservation execution must run on the host.");
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const startedAt = Date.now();
  const token = input.custodyToken ?? randomUUID();
  writePreservationAttempt(input.attemptFile, { stage: "host.start", at: startedAt });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      ...(extension === "ts" ? ["--import", import.meta.resolve("tsx")] : []),
      fileURLToPath(new URL(`./preservationRequestWorker.${extension}`, import.meta.url)),
      input.source, input.workspace, input.attemptFile, token, String(limits.total)
    ], { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let result: (GoTransportResult & { lifecycle: PreservationLifecycle }) | undefined;
    let finished = false;
    let cancellationBound: NodeJS.Timeout | undefined;
    let failure: GoTransportResult | undefined;
    let stderr = "";
    child.stderr?.on("data", bytes => { stderr = (stderr + String(bytes)).slice(-4000); });
    child.on("message", message => {
      const value = message as GoTransportResult & { lifecycle?: PreservationLifecycle };
      if (value.lifecycle?.token === token) result = value as typeof result;
    });
    const cancel = () => {
      failure ??= goTransportFailure(validationError("Protected preservation cancelled; candidate and evidence retained.", { attemptRef: input.attemptFile }));
      if (child.connected) child.send({ cancel: true });
      cancellationBound ??= setTimeout(() => finish(failure!), 10_000);
    };
    input.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setInterval(() => {
      if (failure) return;
      const last = readPreservationAttempt(input.attemptFile);
      if (Date.now() - startedAt < limits.total && Date.now() - (last?.at ?? startedAt) < limits.stage) return;
      failure = goTransportFailure(validationError(`Protected preservation timed out at stage ${last?.stage ?? "host.start"}; candidate and evidence retained.`, {
        stage: last?.stage ?? "host.start", evidenceRef: last?.evidenceRef ?? null,
        attemptRef: input.attemptFile, command: last?.command ?? null,
        remedy: "Inspect the retained attempt and validation receipt, then retry through protected preservation; a commit may already exist and will be recovered by its trailer. Do not clear claims or bypass validation."
      }));
      cancel();
    }, Math.min(250, limits.stage));
    const finish = (value: GoTransportResult) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      clearTimeout(cancellationBound);
      input.signal?.removeEventListener("abort", cancel);
      const lifecycle = result?.lifecycle ?? { state: "drain_unknown" as const, token, executionRoots: [], detail: "owner exited without matching terminal proof" };
      const final = { ...value, lifecycle };
      try {
        writePreservationAttempt(`${input.attemptFile}.result.json`, { result: final, stderr, finishedAt: new Date().toISOString() });
        resolve(final);
      } catch (error) { reject(normalizeError(error)); }
    };
    child.once("error", error => { failure = goTransportFailure(error); });
    child.once("close", (code, signal) => finish(failure ?? (code === 0 ? result : undefined) ?? goTransportFailure(validationError(
      "Protected preservation child exited without a response; candidate and evidence retained.",
      { ...readPreservationAttempt(input.attemptFile), attemptRef: input.attemptFile, code, signal, stderr }
    ))));
    if (input.signal?.aborted) cancel();
    try { if (child.pid) input.onSpawn?.(child.pid); }
    catch (error) {
      failure = goTransportFailure(error);
      cancel();
    }
  });
}
