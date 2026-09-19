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
});
