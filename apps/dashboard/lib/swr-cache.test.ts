import { describe, expect, it } from "vitest";
import { cachedStale } from "./swr-cache";

describe("cachedStale", () => {
  it("shares one in-flight load between concurrent first callers", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return "value";
    };
    const [a, b] = await Promise.all([cachedStale("k1", 1000, load), cachedStale("k1", 1000, load)]);
    expect([a, b, calls]).toEqual(["value", "value", 1]);
  });

  it("returns the stale value immediately and refreshes behind it", async () => {
    let n = 0;
    const load = async () => ++n;
    expect(await cachedStale("k2", 0, load)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await cachedStale("k2", 0, load)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await cachedStale("k2", 0, load)).toBe(2);
  });

  it("does not cache a failed first load", async () => {
    let attempt = 0;
    const load = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cachedStale("k3", 1000, load)).rejects.toThrow("boom");
    expect(await cachedStale("k3", 1000, load)).toBe("ok");
  });

  it("waits for a fresh load once the cached value is older than maxStaleMs", async () => {
    let n = 0;
    const load = async () => ++n;
    expect(await cachedStale("k4", 0, load, { maxStaleMs: 1 })).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await cachedStale("k4", 0, load, { maxStaleMs: 1 })).toBe(2);
  });

  it("fresh starts a new load after one already in flight", async () => {
    let n = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = async () => {
      const value = ++n;
      if (value === 1) await gate;
      return value;
    };
    const first = cachedStale("k5", 1000, load);
    const fresh = cachedStale("k5", 1000, load, { fresh: true });
    release();
    expect(await first).toBe(1);
    expect(await fresh).toBe(2);
    expect(await cachedStale("k5", 1000, load)).toBe(2);
  });
});
