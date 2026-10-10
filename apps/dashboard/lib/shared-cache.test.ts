import { describe, expect, it, vi } from "vitest";
import { createSharedCache } from "./shared-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createSharedCache", () => {
  it("shares one rebuild among concurrent callers", async () => {
    const gate = deferred<string>();
    const load = vi.fn(() => gate.promise);
    const cache = createSharedCache({ ttlMs: 10, load });
    const calls = [cache.get(), cache.get(), cache.get()];
    gate.resolve("a");
    expect(await Promise.all(calls)).toEqual(["a", "a", "a"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves a fresh copy without loading", async () => {
    let t = 0;
    const load = vi.fn(async () => "a");
    const cache = createSharedCache({ ttlMs: 10, load, now: () => t });
    await cache.get();
    t = 9;
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("returns the stale copy at once and refreshes in the background past the TTL", async () => {
    let t = 0;
    const gate = deferred<string>();
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("old").mockReturnValueOnce(gate.promise);
    const cache = createSharedCache({ ttlMs: 10, load, now: () => t });
    expect(await cache.get()).toBe("old");
    t = 11;
    expect(await cache.get()).toBe("old"); // not blocked on the pending rebuild
    expect(await cache.get()).toBe("old");
    expect(load).toHaveBeenCalledTimes(2); // one shared background rebuild
    gate.resolve("new");
    await tick();
    expect(await cache.get()).toBe("new");
  });

  it("keeps the stale copy when a background rebuild fails, and retries next time", async () => {
    let t = 0;
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("old").mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("new");
    const cache = createSharedCache({ ttlMs: 10, load, now: () => t });
    await cache.get();
    t = 11;
    expect(await cache.get()).toBe("old");
    await tick();
    expect(await cache.get()).toBe("old");
    await tick();
    expect(await cache.get()).toBe("new");
  });

  it("does not cache a failure when there is no copy", async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const cache = createSharedCache({ ttlMs: 10, load });
    await expect(cache.get()).rejects.toThrow("boom");
    await expect(cache.get()).resolves.toBe("ok");
  });

  it("invalidate drops the copy, waits for a post-write rebuild, and ignores an older in-flight one", async () => {
    const first = deferred<string>();
    const load = vi.fn<() => Promise<string>>().mockReturnValueOnce(first.promise).mockResolvedValueOnce("after-write");
    const cache = createSharedCache({ ttlMs: 1000, load });
    const stale = cache.get();
    cache.invalidate();
    expect(await cache.get()).toBe("after-write");
    first.resolve("before-write");
    await stale;
    expect(await cache.get()).toBe("after-write");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("waits for a rebuild instead of serving a copy past maxStaleMs, and falls back to it on failure", async () => {
    let t = 0;
    const load = vi.fn<() => Promise<string>>()
      .mockResolvedValueOnce("old")
      .mockResolvedValueOnce("new")
      .mockRejectedValueOnce(new Error("boom"));
    const cache = createSharedCache({ ttlMs: 10, maxStaleMs: 60, load, now: () => t });
    await cache.get();
    t = 61;
    expect(await cache.get()).toBe("new");
    t = 200;
    expect(await cache.get()).toBe("new"); // rebuild failed: the old copy is better than an error
  });

  it("does not cache a result that cacheable rejects", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("degraded").mockResolvedValueOnce("good");
    const cache = createSharedCache({ ttlMs: 10, load, cacheable: (v) => v !== "degraded", now: () => 0 });
    expect(await cache.get()).toBe("degraded");
    expect(await cache.get()).toBe("good");
    expect(await cache.get()).toBe("good");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
