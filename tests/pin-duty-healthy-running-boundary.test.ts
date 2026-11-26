import { describe, expect, it } from "vitest";
import { HEALTHY_MAX_SILENCE_MINUTES, isHealthyRunning } from "../src/production/dutyAlarms.js";

const N = Date.UTC(2026, 10, 26, 3, 0, 0);
const C = 120 * 60_000;

describe("isHealthyRunning boundary", () => {
  it("caps the healthy window at 120 minutes", () => {
    expect(HEALTHY_MAX_SILENCE_MINUTES).toBe(120);
  });

  it.each([1, 2])("is healthy with count %i when activity is inside the window", (count) => {
    for (const lastActivityAt of [N, N - C + 1, N + 60_000]) {
      expect(isHealthyRunning({ count, lastActivityAt }, N)).toBe(true);
    }
  });

  it("is not healthy at or beyond the cap", () => {
    expect(isHealthyRunning({ count: 1, lastActivityAt: N - C }, N)).toBe(false);
    expect(isHealthyRunning({ count: 1, lastActivityAt: N - C - 1 }, N)).toBe(false);
  });

  it("is not healthy with no running count or no activity", () => {
    expect(isHealthyRunning({ count: 0, lastActivityAt: N }, N)).toBe(false);
    expect(isHealthyRunning({ count: 1, lastActivityAt: null }, N)).toBe(false);
  });
});
