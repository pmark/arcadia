import { describe, expect, it } from "vitest";
import { singleFlight } from "./singleFlight";

describe("singleFlight", () => {
  it("skips a tick while the previous call is in flight and runs again after it settles", async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const poll = singleFlight(async () => {
      calls += 1;
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const first = poll();
    await poll();
    await poll();
    expect(calls).toBe(1);
    release();
    await first;
    const second = poll();
    expect(calls).toBe(2);
    release();
    await second;
  });

  it("recovers after a failed call", async () => {
    let calls = 0;
    const poll = singleFlight(async () => { calls += 1; if (calls === 1) throw new Error("boom"); });
    await expect(poll()).rejects.toThrow("boom");
    await poll();
    expect(calls).toBe(2);
  });
});
