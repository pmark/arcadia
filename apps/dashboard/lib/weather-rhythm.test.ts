import { describe, expect, it } from "vitest";
import { SKIES, type SkyId } from "./system-sky";
import { ARRIVAL_COOLDOWN_MS, ARRIVAL_MS, BREATH_MS, SWELL_MS, SWELL_REST_MS, arrivalLift, breathAt, shouldArrive, swellLift, weatherAt } from "./weather-rhythm";

const SKY_IDS = Object.keys(SKIES) as SkyId[];

describe("a change landing", () => {
  it("peaks almost at once, then fades away within about five seconds", () => {
    expect(arrivalLift(0)).toBe(0);
    expect(arrivalLift(400)).toBe(1);
    expect(arrivalLift(2_000)).toBeLessThan(arrivalLift(1_000));
    expect(arrivalLift(ARRIVAL_MS - 1)).toBeLessThan(0.001);
    expect(arrivalLift(ARRIVAL_MS)).toBe(0);
    expect(arrivalLift(600_000)).toBe(0);
  });

  it("happens only for a real change", () => {
    expect(shouldArrive("storm", "clear", undefined, 0)).toBe(true);
    expect(shouldArrive("storm", null, undefined, 0)).toBe(true);
    expect(shouldArrive("storm", "storm", undefined, 0)).toBe(false);
    expect(shouldArrive("reading", "storm", undefined, 0)).toBe(false);
  });

  it("doesn't repeat for a sky that keeps coming back, but still lands a different one", () => {
    expect(shouldArrive("storm", "clear", 10_000, 10_000 + ARRIVAL_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldArrive("storm", "clear", 10_000, 10_000 + ARRIVAL_COOLDOWN_MS)).toBe(true);
    expect(shouldArrive("storm", "clear", undefined, 10_001)).toBe(true);
  });
});

describe("a settled sky", () => {
  const swells = (() => {
    const found: Array<{ start: number; end: number; peak: number }> = [];
    let open: { start: number; end: number; peak: number } | null = null;
    for (let t = 0; t < 7_200_000; t += 100) {
      const lift = swellLift(t);
      if (lift > 0) { open ??= { start: t, end: t, peak: 0 }; open.end = t; open.peak = Math.max(open.peak, lift); }
      else if (open) { found.push(open); open = null; }
    }
    return found;
  })();

  it("stays still for the first moments after opening", () => {
    expect(swells[0].start).toBeGreaterThanOrEqual(SWELL_REST_MS);
  });

  it("swells now and then, irregularly, and always comes back down", () => {
    const gaps = swells.slice(1).map((swell, i) => swell.start - swells[i].end);
    expect(swells.length).toBeGreaterThan(60);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(SWELL_REST_MS - 100);
    expect(Math.max(...gaps)).toBeLessThan(120_000);
    expect(new Set(gaps.map(gap => Math.round(gap / 5_000))).size).toBeGreaterThan(5);
    for (const swell of swells) {
      expect(swell.end - swell.start).toBeLessThanOrEqual(SWELL_MS);
      expect(swell.peak).toBeGreaterThan(0.99);
    }
  });

  it("breathes gently around its colour", () => {
    expect(breathAt(0)).toBe(1);
    expect(breathAt(BREATH_MS / 4)).toBeCloseTo(1.12);
    expect(breathAt((BREATH_MS * 3) / 4)).toBeCloseTo(0.88);
  });

  it("rests calm in every state, and a storm keeps only a fraction of its arrival", () => {
    for (const id of SKY_IDS) expect(SKIES[id].draw.dust ?? 0).toBeLessThanOrEqual(22);
    const settled = weatherAt("storm", 0, 1), landing = weatherAt("storm", 1, 1), swelling = weatherAt("storm", SKIES.storm.swell, 1);
    expect(landing.dust).toBeGreaterThan((settled.dust ?? 0) * 10);
    expect(landing.wind).toBeGreaterThan((settled.wind ?? 0) * 5);
    expect(swelling.dust).toBeLessThan((landing.dust ?? 0) / 3);
    expect(swelling.dust).toBeGreaterThan(settled.dust ?? 0);
  });

  it("makes no claim until a reading lands, however the rhythm moves", () => {
    expect(weatherAt("reading", 1, 1.12)).toEqual({ tint: undefined, haze: undefined, veil: undefined, dust: 0, wind: 0, rise: 0, clouds: 0 });
    expect(SKIES.reading.swell).toBe(0);
  });

  it("keeps each sky's colour and moves only its strength", () => {
    expect(weatherAt("storm", 0, 1.12).haze).toEqual(["#c8743f", 0.32 * 1.12]);
    expect(weatherAt("storm", 1, 1).haze?.[1]).toBeCloseTo(0.54);
    expect(weatherAt("attention", 1, 1).haze?.[0]).toBe("#ffbf5a");
  });
});
