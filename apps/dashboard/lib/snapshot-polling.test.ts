import { describe, expect, it } from "vitest";
import { computeNextPollDelayMs } from "./snapshot-polling";

describe("computeNextPollDelayMs", () => {
  it("polls faster while Sessions or Runs are active", () => {
    expect(computeNextPollDelayMs({ hasActiveWork: true, consecutiveFailures: 0 })).toBe(5_000);
    expect(computeNextPollDelayMs({ hasActiveWork: false, consecutiveFailures: 0 })).toBe(45_000);
  });

  it("backs off on consecutive failures without waiting on the first one", () => {
    const healthy = computeNextPollDelayMs({ hasActiveWork: false, consecutiveFailures: 0 });
    const first = computeNextPollDelayMs({ hasActiveWork: false, consecutiveFailures: 1 });
    const second = computeNextPollDelayMs({ hasActiveWork: false, consecutiveFailures: 2 });
    expect(first).toBeGreaterThan(healthy);
    expect(second).toBeGreaterThan(first);
  });

  it("bounds backoff so a down source is never abandoned", () => {
    const delay = computeNextPollDelayMs({ hasActiveWork: false, consecutiveFailures: 50 });
    expect(delay).toBeLessThanOrEqual(120_000);
  });

  it("recovers to the plain cadence once failures reset", () => {
    expect(computeNextPollDelayMs({ hasActiveWork: true, consecutiveFailures: 0 })).toBe(5_000);
  });
});
