import type { ArcadiaErrorCode, ArcadiaErrorDetails, ArcadiaExitCode } from "../cli/errors.js";

export const GO_REQUEST_FILE = ".arcadia-go-request";
// Go performs remote reconciliation and worktree preparation, not candidate
// validation. Bound its child to five minutes, plus 30 seconds for transport.
export const GO_EXECUTION_TIMEOUT_MS = 300_000;
export const GO_RESPONSE_TIMEOUT_MS = GO_EXECUTION_TIMEOUT_MS + 30_000;
export type GoTransportResult =
  | { ok: true; response: unknown }
  | { ok: false; error: { code: ArcadiaErrorCode; message: string; exitCode: ArcadiaExitCode; details: ArcadiaErrorDetails } };
