import { describe, expect, it } from "vitest";

import { PREDECESSOR_TOLERANCE_WINDOW_MS, predecessorToleranceWindow } from "../src/coordinator/generations.js";

const MIN = 60_000;
const now = new Date("2026-11-25T12:00:00.000Z");
const before = (ms: number) => new Date(now.getTime() - ms).toISOString();
const unmeasurable = (detail: string) => ({ state: "unmeasurable", minutes: null, detail });

describe("predecessorToleranceWindow", () => {
  it("pins the window at 30 minutes", () => {
    expect(PREDECESSOR_TOLERANCE_WINDOW_MS).toBe(30 * MIN);
  });

  it.each([0, 10, 30])("is within at %i minutes after accept", (minutes) => {
    expect(predecessorToleranceWindow(before(minutes * MIN), now)).toEqual({ state: "within", minutes });
  });

  it("expires one millisecond past the window", () => {
    expect(predecessorToleranceWindow(before(30 * MIN + 1), now)).toEqual({ state: "expired", minutes: 30, detail: "30 min after accept (limit 30)" });
  });

  it("is unmeasurable without an accept time", () => {
    expect(predecessorToleranceWindow(null, now)).toEqual(unmeasurable("the successor's accept time is not recorded, so the 30 min tolerance window cannot be measured"));
  });

  it.each(["2026-11-25T11:50:00+00:00", "2026-11-25 11:50:00Z", "soon", ""])("is unmeasurable for %j", (acceptedAt) => {
    expect(predecessorToleranceWindow(acceptedAt, now)).toMatchObject({ state: "unmeasurable", minutes: null });
  });

  it("is unmeasurable for an accept time after now", () => {
    const later = new Date(now.getTime() + 1).toISOString();
    expect(predecessorToleranceWindow(later, now)).toEqual(unmeasurable(`the successor's accept time ${later} is later than now, so the 30 min tolerance window cannot be measured`));
  });
});
