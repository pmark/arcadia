import { describe, expect, it } from "vitest";
import { MOMENTARY_STATES, PRESENCE_STORAGE_KEY, defaultPresence, loadPresence, remaining, savePresence, setCondition, setMomentary, setStyle, snapshot } from "./operator-presence";

const thinking = MOMENTARY_STATES[0];
function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
}

describe("operator presence signal", () => {
  it("expires a momentary state back to the condition", () => {
    const set = setMomentary(setCondition(defaultPresence(0), "stressed"), thinking, 1_000);
    expect(set.expiresAt).toBe(1_000 + set.decayMs);
    expect(remaining(set, 1_000)).toBe(1);
    const store = memory();
    savePresence(store, set);
    const later = loadPresence(store, 1_000 + set.decayMs);
    expect(later.now).toBeNull();
    expect(later.condition).toBe("stressed");
  });

  it("holds a state until changed when decay is off", () => {
    const held = setMomentary({ ...defaultPresence(0), decayMs: 0 }, thinking, 0);
    expect(held.expiresAt).toBeNull();
    expect(remaining(held, 10_000_000)).toBeNull();
  });

  it("restores the saved state and style on reload", () => {
    const store = memory();
    savePresence(store, setStyle(setMomentary(defaultPresence(0), thinking, 0), "expressive"));
    expect(loadPresence(store, 1)).toMatchObject({ now: { id: "thinking" }, style: "expressive" });
  });

  it("defaults to the quiet style", () => {
    expect(defaultPresence(0).style).toBe("quiet");
    expect(loadPresence(memory({ [PRESENCE_STORAGE_KEY]: JSON.stringify({ condition: "calm", style: "loud" }) }), 0).style).toBe("quiet");
  });

  it("falls back to defaults for blocked or corrupt storage", () => {
    const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(loadPresence(blocked, 5)).toEqual(defaultPresence(5));
    expect(savePresence(blocked, defaultPresence(5))).toBe(false);
    expect(loadPresence(memory({ [PRESENCE_STORAGE_KEY]: "{not json" }), 5)).toEqual(defaultPresence(5));
    const huge = loadPresence(memory({ [PRESENCE_STORAGE_KEY]: JSON.stringify({ condition: "calm", now: thinking, setAt: 1e20, expiresAt: 1e20, decayMs: 1e20 }) }), 5);
    expect(huge).toMatchObject({ setAt: 5, expiresAt: null, decayMs: defaultPresence(5).decayMs });
    expect(() => snapshot(huge)).not.toThrow();
    const longFade = loadPresence(memory({ [PRESENCE_STORAGE_KEY]: JSON.stringify({ condition: "calm", decayMs: 8.64e15 }) }), 5);
    expect(longFade.decayMs).toBe(defaultPresence(5).decayMs);
    expect(() => snapshot(setMomentary(longFade, thinking, Date.now()))).not.toThrow();
    expect(snapshot({ ...defaultPresence(0), now: thinking, expiresAt: 9e15 }).expires).toBeNull();
    expect(loadPresence(memory({ [PRESENCE_STORAGE_KEY]: JSON.stringify({ condition: "hurricane" }) }), 5)).toEqual(defaultPresence(5));
    expect(loadPresence(memory({ [PRESENCE_STORAGE_KEY]: JSON.stringify({ condition: "calm", now: { ...thinking, image: "javascript:alert(1)" } }) }), 5).now).toBeNull();
  });

  it("publishes a display-only snapshot", () => {
    const s = snapshot(setMomentary(defaultPresence(0), { ...thinking, id: "c1", image: "data:image/png;base64,AA" }, 0));
    expect(s).toMatchObject({ signal: "operator.presence", now: "custom:sticker", authority: "none" });
  });
});
