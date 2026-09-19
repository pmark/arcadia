interface Entry<T> {
  value: T | undefined;
  hasValue: boolean;
  at: number;
  pending: Promise<T> | null;
}

const entries = new Map<string, Entry<unknown>>();

/**
 * Stale-while-revalidate for slow, read-only CLI projections. A cached value is
 * returned immediately even when older than `ttlMs`; the refresh runs in the
 * background so the next request sees it. Only the first request per key waits.
 * Failures are never cached, and concurrent callers share one in-flight load.
 */
export async function cachedStale<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const entry = (entries.get(key) as Entry<T> | undefined) ?? { value: undefined, hasValue: false, at: 0, pending: null };
  entries.set(key, entry);

  const start = (): Promise<T> => {
    if (!entry.pending) {
      entry.pending = load()
        .then((value) => {
          entry.value = value;
          entry.hasValue = true;
          entry.at = Date.now();
          return value;
        })
        .finally(() => {
          entry.pending = null;
        });
    }
    return entry.pending;
  };

  if (entry.hasValue) {
    if (Date.now() - entry.at > ttlMs) void start().catch(() => undefined);
    return entry.value as T;
  }
  return start();
}
