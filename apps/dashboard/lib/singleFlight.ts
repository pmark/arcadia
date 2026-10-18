/**
 * Wraps an async poll so a tick that arrives while the previous call is still running is not
 * stacked. Slow endpoints (tens of seconds) otherwise pile up overlapping requests.
 *
 * A call made during a flight is remembered and coalesced into ONE trailing run after the flight
 * settles, so a request for fresh data (such as a refresh right after a press) is never lost to
 * an older, slower read. The returned promise resolves when the call it started or joined is done.
 */
export function singleFlight<Args extends unknown[]>(run: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> {
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

  return (...args: Args) => {
    if (!current) return start(args);
    trailingArgs = args;
    if (!trailing) {
      const flight = current;
      trailing = flight.then(() => current ?? undefined, () => current ?? undefined);
    }
    return trailing;
  };
}
