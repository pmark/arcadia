/**
 * A read cache that refreshes exactly when its source changes, for projections of checked-in files (Plans, Plan
 * summaries) that are expensive to build but cheap to fingerprint.
 *
 * - `get(key)` returns the cached value at once while it was checked within `checkAfterMs`.
 * - Past that, it still returns the copy at once and checks behind it: the key's fingerprint (a stat walk, not a
 *   parse) is computed after the response, and only a changed fingerprint rebuilds. The next read sees the result,
 *   so a change appears one read later and no request pays for the check.
 * - A copy not checked within `maxStaleMs`, or no copy at all, makes the caller wait for the check and any rebuild,
 *   so an idle page never reopens on an old record.
 * - Concurrent callers for one key share one rebuild; failures are never cached, and a failed rebuild leaves the
 *   previous copy for the next call to retry.
 * - `invalidate(key?)` drops one key or all of them, e.g. after the dashboard itself writes.
 * - Entries beyond `maxEntries` are evicted least recently used first.
 *
 * Caches are kept on `globalThis` by name, so every route bundle and a dev-server module reload share one copy
 * instead of each starting cold.
 */
export interface FingerprintCache<K, T> {
  get(key: K): Promise<T>;
  invalidate(key?: K): void;
}

interface Entry<T> {
  fingerprint: string;
  value: T;
  checkedAt: number;
}

export interface FingerprintCacheOptions<K, T> {
  /** Stable name; one cache per name per process. */
  name: string;
  /** Cache key as a string; distinct keys must map to distinct strings. */
  keyOf: (key: K) => string;
  /** Cheap, synchronous or async: equal results mean `load` would return the same value. */
  fingerprint: (key: K) => string | Promise<string>;
  load: (key: K, fingerprint: string) => T | Promise<T>;
  /** How long a checked copy is served without re-fingerprinting. */
  checkAfterMs: number;
  /** Past this since its last check, a copy is not served until it is checked again. Default 60 s. */
  maxStaleMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface Store {
  entries: Map<string, Entry<unknown>>;
  pending: Map<string, { fingerprint: string; promise: Promise<unknown> }>;
  /** Background checks in flight, so a burst of reads starts one. */
  checking: Set<string>;
  generation: number;
}

const STORES_KEY = Symbol.for("arcadia.dashboard.fingerprintCaches");
function storeFor(name: string): Store {
  const registry = ((globalThis as Record<symbol, unknown>)[STORES_KEY] ??= new Map<string, Store>()) as Map<string, Store>;
  let store = registry.get(name);
  if (!store) {
    store = { entries: new Map(), pending: new Map(), checking: new Set(), generation: 0 };
    registry.set(name, store);
  }
  return store;
}

export function createFingerprintCache<K, T>(options: FingerprintCacheOptions<K, T>): FingerprintCache<K, T> {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 200;
  const maxStaleMs = options.maxStaleMs ?? 60_000;
  const store = storeFor(options.name);

  const remember = (id: string, entry: Entry<T>) => {
    store.entries.delete(id);
    store.entries.set(id, entry);
    while (store.entries.size > maxEntries) store.entries.delete(store.entries.keys().next().value as string);
  };

  const rebuild = (key: K, id: string, fingerprint: string): Promise<T> => {
    const running = store.pending.get(id);
    if (running && running.fingerprint === fingerprint) return running.promise as Promise<T>;
    const generation = store.generation;
    const promise = Promise.resolve()
      .then(() => options.load(key, fingerprint))
      .then((value) => {
        // A rebuild that began before an invalidation must not restore what was dropped.
        if (generation === store.generation) remember(id, { fingerprint, value, checkedAt: now() });
        return value;
      });
    const pending = { fingerprint, promise };
    store.pending.set(id, pending);
    const clear = () => {
      if (store.pending.get(id) === pending) store.pending.delete(id);
    };
    promise.then(clear, clear);
    return promise;
  };

  const check = async (key: K, id: string): Promise<T> => {
    const fingerprint = await options.fingerprint(key);
    const current = store.entries.get(id) as Entry<T> | undefined;
    if (current && current.fingerprint === fingerprint) {
      remember(id, { ...current, checkedAt: now() });
      return current.value;
    }
    return rebuild(key, id, fingerprint);
  };

  return {
    async get(key) {
      const id = options.keyOf(key);
      const entry = store.entries.get(id) as Entry<T> | undefined;
      const age = entry ? now() - entry.checkedAt : Infinity;
      if (entry && age < options.checkAfterMs) {
        remember(id, entry);
        return entry.value;
      }
      if (entry && age < maxStaleMs) {
        if (!store.checking.has(id)) {
          store.checking.add(id);
          // A macrotask later, so a synchronous stat walk runs after this response is sent, not before it.
          setTimeout(() => {
            check(key, id).catch(() => undefined).finally(() => store.checking.delete(id));
          }, 0);
        }
        return entry.value;
      }
      return check(key, id);
    },
    invalidate(key) {
      store.generation += 1;
      if (key === undefined) store.entries.clear();
      else store.entries.delete(options.keyOf(key));
    }
  };
}
