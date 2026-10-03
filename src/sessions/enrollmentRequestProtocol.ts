import { validationError, type ArcadiaErrorCode, type ArcadiaErrorDetails, type ArcadiaExitCode } from "../cli/errors.js";
import type { GoBrokerAgent } from "../goBroker.js";

export const ENROLLMENT_REQUEST_FILE = ".arcadia-enrollment-request";
export const ENROLLMENT_EXECUTION_TIMEOUT_MS = 300_000;
export const ENROLLMENT_RESPONSE_TIMEOUT_MS = ENROLLMENT_EXECUTION_TIMEOUT_MS + 30_000;
export const ENROLLMENT_REQUEST_ID_ENV = "ARCADIA_ENROLLMENT_REQUEST_ID";
export const ENROLLMENT_CALLER_ID_ENV = "ARCADIA_ENROLLMENT_CALLER_ID";
export const ENROLLMENT_MODE_ENV = "ARCADIA_ENROLLMENT_MODE";
/** Kept here (not in enrollment.ts) so the sandbox-side helper loads no host modules. */
export const ENROLLMENT_REQUEST_MODES = ["prepare", "managed-launch", "native-adopt"] as const;
export type EnrollmentRequestMode = typeof ENROLLMENT_REQUEST_MODES[number];

const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/** Resolve semantic replay identity separately from the one-shot transport nonce. */
export function resolveEnrollmentRequestIdentity(
  agent: GoBrokerAgent,
  env: NodeJS.ProcessEnv = process.env
): { requestId: string; callerId: string } {
  const runtimeId = env.ARCADIA_ENROLLMENT_RUNTIME_ID ??
    (agent === "codex" ? env.CODEX_SESSION_ID ?? env.CODEX_THREAD_ID : undefined) ??
    (agent === "claude" ? env.CLAUDE_SESSION_ID : undefined) ??
    (agent === "opencode" ? env.OPENCODE_SESSION_ID : undefined);
  const requestId = env[ENROLLMENT_REQUEST_ID_ENV] ?? (runtimeId ? `enroll:${agent}:${runtimeId}` : undefined);
  const callerId = env[ENROLLMENT_CALLER_ID_ENV] ?? (runtimeId ? `${agent}:${runtimeId}` : undefined);
  if (!requestId || !callerId || !BOUNDED_ID.test(requestId) || !BOUNDED_ID.test(callerId)) {
    throw validationError("Protected enrollment requires stable host-observable request and caller identities.", {
      code: "enrollment_identity_unavailable",
      remedy: `Launch through a managed Arcadia dispatcher, or bind ${ENROLLMENT_REQUEST_ID_ENV} and ${ENROLLMENT_CALLER_ID_ENV} to stable non-secret identifiers before invoking the fixed no-argument helper.`
    });
  }
  return { requestId, callerId };
}

/** The requested mode is an enum, never a command; absent means preparation. */
export function resolveEnrollmentRequestMode(env: NodeJS.ProcessEnv = process.env): EnrollmentRequestMode {
  const value = env[ENROLLMENT_MODE_ENV]?.trim() || "prepare";
  if (!ENROLLMENT_REQUEST_MODES.includes(value as EnrollmentRequestMode)) {
    throw validationError("Unknown enrollment mode.", {
      code: "invalid_enrollment_mode", mode: value, allowed: [...ENROLLMENT_REQUEST_MODES]
    });
  }
  return value as EnrollmentRequestMode;
}

export type EnrollmentTransportResult =
  | { ok: true; response: unknown }
  | { ok: false; error: { code: ArcadiaErrorCode; message: string; exitCode: ArcadiaExitCode; details: ArcadiaErrorDetails } };
