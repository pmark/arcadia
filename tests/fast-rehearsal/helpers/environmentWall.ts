import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sessionLogPath } from "../../../src/sessions/sessionRecording.js";

/**
 * The 2026-10-12 00:40Z production Session's receipts, as the headless log
 * shapes the lifecycle already parses: no diff, `incomplete_resumable`, the
 * workspace write denied, sandbox refusals of the validation, no preservation
 * receipt, about 11M input tokens of which almost all were cached re-reads.
 */
export const ENVIRONMENT_WALL_SESSION = {
  /** Codex `turn.completed` usage: input_tokens is the total, cached a subset. */
  totalInputTokens: 11_100_000,
  cachedInputTokens: 10_400_000,
  outputTokens: 4_000,
  /** The fixed bound: the attempt may spend this once and never again. */
  tokenBound: 12_000_000
} as const;

export function environmentWallSessionLog(): string {
  return [
    JSON.stringify({ type: "turn.completed", usage: {
      input_tokens: ENVIRONMENT_WALL_SESSION.totalInputTokens,
      cached_input_tokens: ENVIRONMENT_WALL_SESSION.cachedInputTokens,
      output_tokens: ENVIRONMENT_WALL_SESSION.outputTokens
    } }),
    "arcadia: SQLITE_WORKSPACE_WRITE_DENIED: attempt to write a readonly database",
    "go test ./... -> operation not permitted (sandbox refused 81 of 84 tests)",
    "preservation launcher produced no receipt"
  ].join("\n");
}

/** Write the recorded log where the tick reads a Session's own log. */
export function writeEnvironmentWallSessionLog(workspace: string, sessionId: string): string {
  const file = sessionLogPath(workspace, sessionId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, environmentWallSessionLog());
  return file;
}
