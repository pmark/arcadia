import { AsyncLocalStorage } from "node:async_hooks";
import { normalizeError } from "../cli/errors.js";

export type PreservationProgress = (stage: string, details?: Record<string, unknown>) => void;
const progress = new AsyncLocalStorage<{ report: PreservationProgress; stage: string }>();

export function withPreservationProgress<T>(report: PreservationProgress, run: () => T): T {
  return progress.run({ report, stage: "host.start" }, run);
}

export function preservationStage(stage: string, details?: Record<string, unknown>): void {
  const current = progress.getStore();
  if (!current) return;
  current.stage = stage;
  current.report(stage, details);
}

/** Keep the failure's own stage when a finally block reports cleanup later. */
export function preservationStageFailure(error: unknown) {
  const failure = normalizeError(error);
  failure.details.stage ??= progress.getStore()?.stage;
  return failure;
}

/** Native process bounds also apply while the host's JS thread is blocked. */
export function preservationProcessLimits(): { timeout?: number; killSignal?: "SIGKILL" } {
  return progress.getStore() ? { timeout: 30_000, killSignal: "SIGKILL" } : {};
}
