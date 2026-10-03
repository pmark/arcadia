import { AsyncLocalStorage } from "node:async_hooks";
import { normalizeError, preservationGitTimeout, type ArcadiaError } from "../cli/errors.js";

export type PreservationProgress = (stage: string, details?: Record<string, unknown>) => void;
interface PreservationProgressState {
  report: PreservationProgress; stage: string; details?: Record<string, unknown>; lastReportAt: number; gitTimeoutMs: number;
}
const progress = new AsyncLocalStorage<PreservationProgressState>();

/** The host's idle watchdog kills an attempt whose last stage event is older than this. */
export const PRESERVATION_STAGE_TIMEOUT_MS = 150_000;
/** Default per-call bound, kept below the stage idle limit so a hung Git call
 * reports its own typed, retryable timeout before the watchdog kills the attempt. */
export const PRESERVATION_GIT_TIMEOUT_MS = 90_000;
const PRESERVATION_HEARTBEAT_INTERVAL_MS = 5_000;

/** `ARCADIA_PRESERVATION_GIT_TIMEOUT_MS` overrides the per-call bound; a value
 * that is not a positive integer below the stage idle limit is ignored. */
export function preservationGitTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.ARCADIA_PRESERVATION_GIT_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0 && configured < PRESERVATION_STAGE_TIMEOUT_MS
    ? configured : PRESERVATION_GIT_TIMEOUT_MS;
}

export function withPreservationProgress<T>(report: PreservationProgress, run: () => T, options: { gitTimeoutMs?: number } = {}): T {
  return progress.run({
    report, stage: "host.start", lastReportAt: Date.now(), gitTimeoutMs: options.gitTimeoutMs ?? preservationGitTimeoutMs()
  }, run);
}

export function preservationStage(stage: string, details?: Record<string, unknown>): void {
  const current = progress.getStore();
  if (!current) return;
  current.stage = stage;
  current.details = details;
  current.lastReportAt = Date.now();
  current.report(stage, details);
}

/** Re-report the current stage after bounded work. A stage made of many
 * individually bounded calls (one `hash-object` per file) then never looks idle
 * to the watchdog, while a single hung call still trips its own timeout. */
export function preservationHeartbeat(): void {
  const current = progress.getStore();
  if (!current || Date.now() - current.lastReportAt < PRESERVATION_HEARTBEAT_INTERVAL_MS) return;
  current.lastReportAt = Date.now();
  current.report(current.stage, { ...current.details, heartbeat: true });
}

/** Keep the failure's own stage when a finally block reports cleanup later. */
export function preservationStageFailure(error: unknown) {
  const failure = normalizeError(error);
  failure.details.stage ??= progress.getStore()?.stage;
  return failure;
}

/** Native process bounds also apply while the host's JS thread is blocked. */
export function preservationProcessLimits(): { timeout?: number; killSignal?: "SIGKILL" } {
  const current = progress.getStore();
  return current ? { timeout: current.gitTimeoutMs, killSignal: "SIGKILL" } : {};
}

function gitSubcommand(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-c" || args[index] === "-C") index += 1;
    else if (!args[index].startsWith("-")) return args[index];
  }
  return null;
}

/**
 * The typed, retryable failure for a native subprocess timeout (`ETIMEDOUT`
 * from `execFileSync`'s thrown error or `spawnSync`'s `result.error`), or null
 * for anything else so callers keep their own handling of genuine failures. A
 * timeout must never be read as a negative answer ("not an ancestor", "no
 * preservation commit") or as a refusal of the candidate.
 */
export function preservationTimeout(error: unknown, command: string, args: readonly string[], cwd: string | undefined): ArcadiaError | null {
  if ((error as { code?: unknown } | null | undefined)?.code !== "ETIMEDOUT") return null;
  const current = progress.getStore();
  const subcommand = command === "git" ? gitSubcommand(args) : null;
  const stage = current?.stage ?? null;
  const timeoutMs = current?.gitTimeoutMs ?? null;
  return preservationGitTimeout(
    `${subcommand ? `git ${subcommand}` : command} exceeded its ${timeoutMs ?? "configured"} ms preservation budget at stage ${stage ?? "unknown"}; retry the same protected launcher.`,
    {
      command, gitSubcommand: subcommand, args: [...args], cwd: cwd ?? null, timeoutMs, stage,
      remedy: "Retry the same fixed protected launcher unchanged. The retry reuses the same request id: a timeout before the commit left no commit and the candidate index and status unchanged, and a commit that already exists is recovered by its trailer rather than duplicated. Timeouts do not consume the identical-refusal budget. Set ARCADIA_PRESERVATION_GIT_TIMEOUT_MS (below 150000) on the host only if Git is persistently slower than the bound."
    }
  );
}
