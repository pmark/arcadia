// Framework-free stale-while-revalidate cache for client reads, so revisiting a view paints at once.
export type ReadCacheOptions = {
  fetcher?: (url: string) => Promise<unknown>;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Arcadia could not read this context.");
  return body;
}

export function createReadCache({ fetcher = fetchJson, ttlMs = 5_000, maxEntries = 100, now = Date.now }: ReadCacheOptions = {}) {
  const entries = new Map<string, { data: unknown; at: number }>(); // Map order = age, oldest first
  const inflight = new Map<string, Promise<unknown>>();

  function store(url: string, data: unknown) {
    entries.delete(url);
    entries.set(url, { data, at: now() });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
  }

  function start(url: string): Promise<unknown> {
    const pending: Promise<unknown> = fetcher(url).then(data => { store(url, data); return data; }).finally(() => {
      if (inflight.get(url) === pending) inflight.delete(url);
    });
    inflight.set(url, pending);
    return pending;
  }

  function load<T>(url: string, { force = false }: { force?: boolean } = {}): Promise<T> {
    const entry = entries.get(url);
    if (!force && entry && now() - entry.at < ttlMs) return Promise.resolve(entry.data as T);
    return (inflight.get(url) ?? start(url)) as Promise<T>;
  }

  return {
    /** Last successful body, however old; undefined when never read. */
    peek<T>(url: string): T | undefined {
      return entries.get(url)?.data as T | undefined;
    },
    /** Fresh entries resolve from cache; otherwise one shared fetch. `force` skips the cached entry (refresh). Failures are never cached. */
    load,
    /** Warm the cache; errors are swallowed since a later real read reports them. */
    prefetch(url: string): void {
      load(url).catch(() => undefined);
    },
    clear() { entries.clear(); inflight.clear(); },
    size: () => entries.size,
  };
}

export const clientReadCache = createReadCache();
export const prefetchRead = (url: string) => clientReadCache.prefetch(url);
