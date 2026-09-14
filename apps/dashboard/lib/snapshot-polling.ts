/**
 * Pure polling-cadence policy for `useArcadiaSnapshot`, split out of the React
 * hook so the backoff/coalescing rules can be unit tested without a DOM.
 */
export interface PollDelayInput {
  /** Whether the last successful snapshot showed live Sessions or Runs. */
  hasActiveWork: boolean;
  /** Consecutive failed refreshes since the last success. */
  consecutiveFailures: number;
}

const ACTIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 45_000;
const MAX_BACKOFF_MS = 120_000;

/**
 * The next poll delay. A healthy poll uses the plain active/idle cadence.
 * Each consecutive failure doubles the delay, bounded at two minutes, so a
 * source that is down does not hammer it — but a single failure barely slows
 * the cadence, since transient errors are the common case.
 */
export function computeNextPollDelayMs(input: PollDelayInput): number {
  const base = input.hasActiveWork ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
  if (input.consecutiveFailures <= 0) return base;
  const backoff = base * Math.pow(2, Math.min(input.consecutiveFailures, 4));
  return Math.min(backoff, MAX_BACKOFF_MS);
}
