import { describe, expect, it } from "vitest";
import { singleFlight } from "./singleFlight";

function gated() {
  const releases: Array<() => void> = [];
  let calls = 0;
  const poll = singleFlight(async () => {
    calls += 1;
    await new Promise<void>((resolve) => { releases.push(resolve); });
  });
  return { poll, releases, calls: () => calls };
}

describe("singleFlight", () => {
  it("never overlaps calls: ticks during a flight collapse into one trailing run", async () => {
    const { poll, releases, calls } = gated();
    const first = poll();
    const second = poll();
    const third = poll();
    expect(calls()).toBe(1);
    releases[0]();
    await first;
    await Promise.resolve();
    expect(calls()).toBe(2); // exactly one trailing run, not two
    releases[1]();
    await Promise.all([second, third]);
    expect(calls()).toBe(2);
  });

  it("does not drop a request for fresh data made while a slow read is in flight", async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const poll = singleFlight(async (label: string) => {
      seen.push(label);
      if (label === "slow") await new Promise<void>((resolve) => { release = resolve; });
    });
    const slow = poll("slow");
    const afterPress = poll("after-press");
    release();
    await Promise.all([slow, afterPress]);
    expect(seen).toEqual(["slow", "after-press"]);
  });

  it("interval ticks during a slow flight are skipped and never queue a trailing run", async () => {
    const { poll, releases, calls } = gated();
    const first = poll.tick();
    void poll.tick();
    void poll.tick();
    expect(calls()).toBe(1);
    releases[0]();
    await first;
    await Promise.resolve();
    expect(calls()).toBe(1); // no back-to-back run: the next tick starts a fresh call after the idle gap
    const next = poll.tick();
    expect(calls()).toBe(2);
    releases[1]();
    await next;
  });

  it("an explicit refresh during a tick-started flight still gets its trailing run", async () => {
    const { poll, releases, calls } = gated();
    const tick = poll.tick();
    void poll.tick();
    const explicit = poll();
    releases[0]();
    await tick;
    await Promise.resolve();
    expect(calls()).toBe(2);
    releases[1]();
    await explicit;
  });

  it("recovers after a failed call", async () => {
    let calls = 0;
    const poll = singleFlight(async () => { calls += 1; if (calls === 1) throw new Error("boom"); });
    await expect(poll()).rejects.toThrow("boom");
    await poll();
    expect(calls).toBe(2);
  });
});
