import { describe, expect, it } from "vitest";

import { validScoutClock, type ScoutClockSample } from "../src/scout/admissionClock.js";

const fixture: ScoutClockSample = {
  kind: "scripted-fixture", bootId: "boot-a", wallMs: 1000, monoStartMs: 5, monoEndMs: 5, uptimeMs: 5, uncertaintyMs: 0,
};
const host: ScoutClockSample = {
  kind: "host", bootId: "darwin:1:2", wallMs: 1000, monoStartMs: 100, monoEndMs: 350, uptimeMs: 9000, uncertaintyMs: 1000,
};

describe("validScoutClock", () => {
  it("accepts a scripted-fixture sample", () => {
    expect(validScoutClock(fixture)).toBe(true);
  });

  it("accepts a scripted-fixture sample whose times are all zero", () => {
    expect(validScoutClock({ ...fixture, wallMs: 0, monoStartMs: 0, monoEndMs: 0, uptimeMs: 0 })).toBe(true);
  });

  it("accepts a host sample with a 250 ms monotonic span", () => {
    expect(validScoutClock(host)).toBe(true);
  });

  it("refuses a host sample with a span over 250 ms or the wrong uncertainty", () => {
    expect(validScoutClock({ ...host, monoEndMs: 351 })).toBe(false);
    expect(validScoutClock({ ...host, uncertaintyMs: 0 })).toBe(false);
  });

  it("refuses a malformed scripted-fixture sample", () => {
    expect(validScoutClock({ ...fixture, monoEndMs: 4 })).toBe(false);
    expect(validScoutClock({ ...fixture, uncertaintyMs: 1000 })).toBe(false);
    expect(validScoutClock({ ...fixture, bootId: "   " })).toBe(false);
    expect(validScoutClock({ ...fixture, kind: "other" } as unknown as ScoutClockSample)).toBe(false);
    expect(validScoutClock({ ...fixture, wallMs: -1 })).toBe(false);
    expect(validScoutClock({ ...fixture, uptimeMs: Number.NaN })).toBe(false);
    expect(validScoutClock({ ...fixture, wallMs: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("refuses null", () => {
    expect(validScoutClock(null as unknown as ScoutClockSample)).toBe(false);
  });
});
