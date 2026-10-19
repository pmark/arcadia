export interface SingleFlight<Args extends unknown[]> {
  /** Explicit refresh (after a press, manual Refresh): if a call is in flight, coalesces ONE trailing run after it. */
  (...args: Args): Promise<void>;
  /** Interval tick: skipped while a call is in flight, never queues a trailing run, so a slow read leaves idle gaps. */
  tick: (...args: Args) => Promise<void>;
}

/**
 * Wraps an async poll so calls never overlap. Slow endpoints (tens of seconds) otherwise pile up
 * requests. Interval ticks (`.tick`) are dropped while busy; an explicit call is remembered and run
 * once after the in-flight call settles, so a request for fresh data is never lost to an older,
 * slower read. The returned promise resolves when the call it started or joined is done.
 */
export function singleFlight<Args extends unknown[]>(run: (...args: Args) => Promise<void>): SingleFlight<Args> {
  let current: Promise<void> | null = null;
  let trailing: Promise<void> | null = null;
  let trailingArgs: Args | null = null;

  const start = (args: Args): Promise<void> => {
    const flight = (async () => {
      try {
        await run(...args);
      } finally {
        current = null;
        if (trailingArgs) {
          const next = trailingArgs;
          trailingArgs = null;
          trailing = null;
          current = start(next);
        }
      }
    })();
    current = flight;
    return flight;
  };

  const explicit = (...args: Args): Promise<void> => {
    if (!current) return start(args);
    trailingArgs = args;
    if (!trailing) {
      const flight = current;
      trailing = flight.then(() => current ?? undefined, () => current ?? undefined);
    }
    return trailing;
  };
  const tick = (...args: Args): Promise<void> => current ?? start(args);
  return Object.assign(explicit, { tick });
}
