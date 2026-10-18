/**
 * Wraps an async poll so a tick that arrives while the previous call is still running is skipped
 * rather than stacked. Slow endpoints (tens of seconds) otherwise pile up overlapping requests.
 */
export function singleFlight<Args extends unknown[]>(run: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> {
  let inFlight = false;
  return async (...args: Args) => {
    if (inFlight) return;
    inFlight = true;
    try {
      await run(...args);
    } finally {
      inFlight = false;
    }
  };
}
