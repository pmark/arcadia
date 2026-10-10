/**
 * A small stale-while-revalidate cache with in-flight de-duplication, for one
 * expensive read that many polls and tabs share.
 *
 * - With a cached copy, `get()` returns it at once and never waits on a rebuild.
 *   A copy older than `ttlMs` starts one background rebuild.
 * - Without a cached copy, callers wait on the single shared rebuild.
 * - Concurrent callers share one rebuild; a rebuild never runs twice at once.
 * - `invalidate()` (after a write) drops the copy and orphans any rebuild that
 *   began earlier, so the next `get()` waits for a rebuild that started after
 *   the write.
 * - A copy older than `maxStaleMs` is too old to show: `get()` waits for the
 *   rebuild (an idle tab must not reopen on hour-old buttons), falling back to
 *   that copy only if the rebuild fails.
 * - A failed rebuild keeps the previous copy (served stale) and is not cached;
 *   with no copy, the failure reaches every waiting caller.
 * - `cacheable(data)` false keeps a degraded result out of the cache.
 */
export interface SharedCache<T> {
  get(): Promise<T>;
  invalidate(): void;
}

export function createSharedCache<T>(options: {
  ttlMs: number;
  maxStaleMs?: number;
  load: () => Promise<T>;
  cacheable?: (data: T) => boolean;
  now?: () => number;
}): SharedCache<T> {
  const now = options.now ?? Date.now;
  let value: { at: number; data: T } | null = null;
  let inFlight: { generation: number; promise: Promise<T> } | null = null;
  let generation = 0;

  function rebuild(): Promise<T> {
    if (inFlight && inFlight.generation === generation) return inFlight.promise;
    const started = generation;
    const promise = options.load().then(
      (data) => {
        if (started === generation && (options.cacheable?.(data) ?? true)) value = { at: now(), data };
        return data;
      }
    );
    const entry = { generation: started, promise };
    inFlight = entry;
    const clear = () => {
      if (inFlight === entry) inFlight = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  return {
    get() {
      if (value) {
        const copy = value.data;
        const age = now() - value.at;
        if (options.maxStaleMs !== undefined && age >= options.maxStaleMs) return rebuild().catch(() => copy);
        if (age >= options.ttlMs) rebuild().catch(() => undefined);
        return Promise.resolve(copy);
      }
      return rebuild();
    },
    invalidate() {
      generation += 1;
      value = null;
    }
  };
}
