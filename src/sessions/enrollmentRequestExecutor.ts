import { fork } from "node:child_process";
import { validationError } from "../cli/errors.js";
import type { GoBrokerAgent } from "../goBroker.js";
import { goTransportFailure } from "./goRequestExecutor.js";
import { ENROLLMENT_EXECUTION_TIMEOUT_MS, type EnrollmentRequestMode, type EnrollmentTransportResult } from "./enrollmentRequestProtocol.js";

/** Execute only Arcadia's fixed host enrollment worker; no request supplies a command or flags. */
export function executeHostEnrollmentRequest(
  source: string,
  agent: GoBrokerAgent,
  requestId: string,
  callerId: string,
  mode: EnrollmentRequestMode
): Promise<EnrollmentTransportResult> {
  if (process.env.CODEX_SANDBOX) throw validationError("Enrollment must run on the host.");
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return new Promise(resolve => {
    const child = fork(new URL(`./enrollmentRequestWorker.${extension}`, import.meta.url), [source, agent, requestId, callerId, mode], {
      execArgv: extension === "ts" ? ["--import", import.meta.resolve("tsx")] : [],
      stdio: ["ignore", "ignore", "ignore", "ipc"], timeout: ENROLLMENT_EXECUTION_TIMEOUT_MS
    });
    let result: EnrollmentTransportResult | undefined;
    child.once("message", message => { result = message as EnrollmentTransportResult; });
    child.once("error", error => resolve(goTransportFailure(error)));
    child.once("exit", (code, signal) => resolve(result ?? goTransportFailure(validationError(
      "Host enrollment child exited without a result; inspect the durable request before retrying.",
      { source, requestId, code, signal }
    ))));
  });
}
