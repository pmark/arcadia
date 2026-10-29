import { describe, expect, it, vi } from "vitest";
import { createFingerprintCache } from "./fingerprint-cache";

let names = 0;
function setup(initial = "a") {
  let clock = 0;
  let fingerprint = initial;
  const fingerprints = vi.fn(() => fingerprint);
  const load = vi.fn(async (key: string, fp: string) => `${key}@${fp}`);
  const cache = createFingerprintCache<string, string>({
    name: `test-${names++}`, keyOf: (k) => k, fingerprint: fingerprints, load, checkAfterMs: 1000, maxStaleMs: 10_000, maxEntries: 2, now: () => clock
  });
  return { cache, load, fingerprints, tick: (ms: number) => { clock += ms; }, change: (fp: string) => { fingerprint = fp; } };
}

describe("fingerprint cache", () => {
  it("serves a checked copy without fingerprinting until checkAfterMs passes", async () => {
    const t = setup();
    expect(await t.cache.get("k")).toBe("k@a");
    t.tick(500);
    expect(await t.cache.get("k")).toBe("k@a");
    expect(t.fingerprints).toHaveBeenCalledTimes(1);
    expect(t.load).toHaveBeenCalledTimes(1);
  });

  it("past checkAfterMs serves the copy at once and checks behind it, so a change shows one read later", async () => {
    const t = setup();
    await t.cache.get("k");
    t.tick(1500);
    t.change("b");
    expect(await t.cache.get("k")).toBe("k@a");
    expect(await t.cache.get("k")).toBe("k@a");
    await vi.waitFor(() => expect(t.load).toHaveBeenCalledTimes(2));
    expect(t.fingerprints).toHaveBeenCalledTimes(2);
    expect(await t.cache.get("k")).toBe("k@b");
  });

  it("an unchanged fingerprint keeps the copy without reloading", async () => {
    const t = setup();
    await t.cache.get("k");
    t.tick(1500);
    await t.cache.get("k");
    await vi.waitFor(() => expect(t.fingerprints).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.load).toHaveBeenCalledTimes(1);
  });

  it("a fresh read checks before answering, even within checkAfterMs", async () => {
    const t = setup();
    await t.cache.get("k");
    t.change("b");
    expect(await t.cache.get("k", { fresh: true })).toBe("k@b");
  });

  it("a read after invalidate never joins a rebuild begun before it", async () => {
    const t = setup();
    let release!: () => void;
    t.load.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve("old"); }));
    const early = t.cache.get("k");
    await vi.waitFor(() => expect(t.load).toHaveBeenCalledTimes(1));
    t.cache.invalidate("k");
    const late = t.cache.get("k");
    release();
    expect(await early).toBe("old");
    expect(await late).toBe("k@a");
  });

  it("waits for the check once a copy is older than maxStaleMs", async () => {
    const t = setup();
    await t.cache.get("k");
    t.tick(20_000);
    t.change("b");
    expect(await t.cache.get("k")).toBe("k@b");
  });

  it("shares one load between concurrent callers and never caches a failure", async () => {
    const t = setup();
    const [a, b] = await Promise.all([t.cache.get("k"), t.cache.get("k")]);
    expect([a, b]).toEqual(["k@a", "k@a"]);
    expect(t.load).toHaveBeenCalledTimes(1);
    t.load.mockRejectedValueOnce(new Error("unreadable"));
    await expect(t.cache.get("other")).rejects.toThrow("unreadable");
    expect(await t.cache.get("other")).toBe("other@a");
  });

  it("invalidate forces a reload, and a load begun before it is not kept", async () => {
    const t = setup();
    await t.cache.get("k");
    t.cache.invalidate("k");
    expect(await t.cache.get("k")).toBe("k@a");
    expect(t.load).toHaveBeenCalledTimes(2);
    let release!: () => void;
    t.load.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve("old"); }));
    t.cache.invalidate();
    const racing = t.cache.get("k");
    await Promise.resolve();
    await Promise.resolve();
    t.cache.invalidate();
    release();
    expect(await racing).toBe("old");
    expect(await t.cache.get("k")).toBe("k@a");
  });

  it("evicts the least recently used entry beyond maxEntries", async () => {
    const t = setup();
    await t.cache.get("a");
    await t.cache.get("b");
    await t.cache.get("a");
    await t.cache.get("c");
    t.load.mockClear();
    await t.cache.get("a");
    expect(t.load).not.toHaveBeenCalled();
    await t.cache.get("b");
    expect(t.load).toHaveBeenCalledTimes(1);
  });
});
