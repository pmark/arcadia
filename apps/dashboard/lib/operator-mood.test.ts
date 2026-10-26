import { describe, expect, it } from "vitest";
import { ATMOSPHERES, MOMENTARY_STATES, MOOD_STORAGE_KEY, defaultMood, loadMood, remaining, saveMood, setAtmosphere, setMomentary, snapshot } from "./operator-mood";

const thinking = MOMENTARY_STATES[0];
function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
}

describe("operator mood signal", () => {
  it("expires a momentary state back to the atmosphere", () => {
    const set = setMomentary(setAtmosphere(defaultMood(0), "stressed"), thinking, 1_000);
    expect(set.expiresAt).toBe(1_000 + set.decayMs);
    expect(remaining(set, 1_000)).toBe(1);
    const store = memory();
    saveMood(store, set);
    const later = loadMood(store, 1_000 + set.decayMs);
    expect(later.now).toBeNull();
    expect(later.atmosphere).toBe("stressed");
  });

  it("holds a state until changed when decay is off", () => {
    const held = setMomentary({ ...defaultMood(0), decayMs: 0 }, thinking, 0);
    expect(held.expiresAt).toBeNull();
    expect(remaining(held, 10_000_000)).toBeNull();
  });

  it("restores the saved state on reload", () => {
    const store = memory();
    saveMood(store, setMomentary(defaultMood(0), thinking, 0));
    expect(loadMood(store, 1).now?.id).toBe("thinking");
  });

  it("falls back to defaults for blocked or corrupt storage", () => {
    const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(loadMood(blocked, 5)).toEqual(defaultMood(5));
    expect(saveMood(blocked, defaultMood(5))).toBe(false);
    expect(loadMood(memory({ [MOOD_STORAGE_KEY]: "{not json" }), 5)).toEqual(defaultMood(5));
    const huge = loadMood(memory({ [MOOD_STORAGE_KEY]: JSON.stringify({ atmosphere: "calm", now: thinking, setAt: 1e20, expiresAt: 1e20, decayMs: 1e20 }) }), 5);
    expect(huge).toMatchObject({ setAt: 5, expiresAt: null, decayMs: defaultMood(5).decayMs });
    expect(() => snapshot(huge)).not.toThrow();
    expect(loadMood(memory({ [MOOD_STORAGE_KEY]: JSON.stringify({ atmosphere: "hurricane" }) }), 5)).toEqual(defaultMood(5));
    expect(loadMood(memory({ [MOOD_STORAGE_KEY]: JSON.stringify({ atmosphere: "calm", now: { ...thinking, image: "javascript:alert(1)" } }) }), 5).now).toBeNull();
  });

  it("gives every atmosphere its own weather", () => {
    const weather = ATMOSPHERES.map(a => JSON.stringify(a.weather));
    expect(new Set(weather).size).toBe(ATMOSPHERES.length);
  });

  it("publishes a display-only snapshot", () => {
    const s = snapshot(setMomentary(defaultMood(0), { ...thinking, id: "c1", image: "data:image/png;base64,AA" }, 0));
    expect(s).toMatchObject({ signal: "operator.mood", now: "custom:sticker", authority: "none" });
  });
});
