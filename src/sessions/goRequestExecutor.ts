import { fork } from "node:child_process";
import { normalizeError, validationError } from "../cli/errors.js";
import type { GoBrokerAgent } from "../goBroker.js";
import { GO_EXECUTION_TIMEOUT_MS, type GoTransportResult } from "./goRequestProtocol.js";

export function goTransportFailure(error: unknown): GoTransportResult {
  const { code, message, exitCode, details } = normalizeError(error);
  return { ok: false, error: { code, message, exitCode, details } };
}

/** Launch only our own host module. No request supplies executable code or flags.
 * Returning immediately lets worker heartbeats and Run admission keep ticking. */
export function executeHostGo(source: string, agent: GoBrokerAgent): Promise<GoTransportResult> {
  if (process.env.CODEX_SANDBOX) throw validationError("Go reconciliation must run on the host.");
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return new Promise(resolve => {
    const child = fork(new URL(`./goRequestWorker.${extension}`, import.meta.url), [source, agent], {
      execArgv: extension === "ts" ? ["--import", import.meta.resolve("tsx")] : [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      timeout: GO_EXECUTION_TIMEOUT_MS
    });
    let result: GoTransportResult | undefined;
    child.once("message", message => { result = message as GoTransportResult; });
    child.once("error", error => resolve(goTransportFailure(error)));
    child.once("exit", (code, signal) => resolve(result ?? goTransportFailure(validationError(
      "Host go child exited without a result; inspect source state before retrying.",
      { source, code, signal, remedy: "Inspect the host worker and source worktree; go may have partially prepared state." }
    ))));
  });
}
