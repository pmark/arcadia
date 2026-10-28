import { describe, expect, it, vi } from "vitest";
import { createReadCache } from "./client-read-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("createReadCache", () => {
  it("shares one fetch among concurrent loads", async () => {
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);
    const cache = createReadCache({ fetcher });
    const calls = [cache.load("/a"), cache.load("/a")];
    gate.resolve("a");
    expect(await Promise.all(calls)).toEqual(["a", "a"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves fresh entries without fetching and stale ones while revalidating", async () => {
    let t = 0;
    const gate = deferred<string>();
    const fetcher = vi.fn<(u: string) => Promise<string>>().mockResolvedValueOnce("old").mockReturnValueOnce(gate.promise);
    const cache = createReadCache({ fetcher, ttlMs: 5, now: () => t });
    await cache.load("/a");
    t = 4;
    await cache.load("/a");
    expect(fetcher).toHaveBeenCalledTimes(1);
    t = 6;
    const pending = cache.load("/a");
    expect(cache.peek("/a")).toBe("old"); // still shown while the fetch runs
    gate.resolve("new");
    expect(await pending).toBe("new");
    expect(cache.peek("/a")).toBe("new");
  });

  it("does not cache failures or replace a cached value with one", async () => {
    let t = 0;
    const fetcher = vi.fn<(u: string) => Promise<string>>().mockResolvedValueOnce("ok").mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("again");
    const cache = createReadCache({ fetcher, ttlMs: 5, now: () => t });
    await cache.load("/a");
    t = 6;
    await expect(cache.load("/a")).rejects.toThrow("boom");
    expect(cache.peek("/a")).toBe("ok");
    expect(await cache.load("/a")).toBe("again"); // failure left no in-flight entry
    const empty = createReadCache({ fetcher: async () => { throw new Error("x"); } });
    await expect(empty.load("/b")).rejects.toThrow("x");
    expect(empty.peek("/b")).toBeUndefined();
  });

  it("force bypasses a fresh entry", async () => {
    const fetcher = vi.fn<(u: string) => Promise<string>>().mockResolvedValueOnce("one").mockResolvedValueOnce("two");
    const cache = createReadCache({ fetcher, ttlMs: 1000 });
    await cache.load("/a");
    expect(await cache.load("/a", { force: true })).toBe("two");
    expect(cache.peek("/a")).toBe("two");
  });

  it("force asks the server for a fresh read and never joins an earlier fetch", async () => {
    const early = deferred<string>();
    const fetcher = vi.fn<(u: string) => Promise<string>>().mockReturnValueOnce(early.promise).mockResolvedValueOnce("new");
    const cache = createReadCache({ fetcher });
    const first = cache.load("/a?x=1");
    expect(await cache.load("/a?x=1", { force: true })).toBe("new");
    expect(fetcher).toHaveBeenLastCalledWith("/a?x=1&fresh=1");
    early.resolve("old");
    await first;
    expect(cache.peek("/a?x=1")).toBe("new");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry past the bound", async () => {
    const cache = createReadCache({ fetcher: async (u) => u, maxEntries: 2 });
    await cache.load("/a");
    await cache.load("/b");
    await cache.load("/c");
    expect(cache.size()).toBe(2);
    expect(cache.peek("/a")).toBeUndefined();
    expect(cache.peek("/c")).toBe("/c");
  });
});
