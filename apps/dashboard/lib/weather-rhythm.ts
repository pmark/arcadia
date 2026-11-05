import { SKIES, type SkyId, type Weather } from "./system-sky";

/**
 * When the weather is vivid and when it rests (docs/design/relay/workspace-layers.md, "Weather has rhythm").
 * A change lands vividly and fades in about five seconds. The state then settles to something calm and
 * alive: a slow breath in its colour, and a swell now and then. These are pure functions of time, so the
 * drawing in components/workspace/sky/weather.ts only has to ask what the weather is right now.
 */
export const ARRIVAL_MS = 5_000;
const ARRIVAL_RISE_MS = 400;
/** A sky flipping back and forth would be as tiresome as a constant one, so the same sky landing again this soon only crossfades. */
export const ARRIVAL_COOLDOWN_MS = 5 * 60_000;
export const BREATH_MS = 17_000;
const BREATH_DEPTH = 0.12;
const SWELL_SLOT_MS = 70_000;
export const SWELL_MS = 8_000;
/** Swells keep this far apart, and the first waits this long after the page opens. */
export const SWELL_REST_MS = 20_000;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** How vivid a change still is, from 0 to 1, this long after it landed. */
export function arrivalLift(sinceMs: number): number {
  if (sinceMs < 0 || sinceMs >= ARRIVAL_MS) return 0;
  if (sinceMs < ARRIVAL_RISE_MS) return smooth(sinceMs / ARRIVAL_RISE_MS);
  return (1 - (sinceMs - ARRIVAL_RISE_MS) / (ARRIVAL_MS - ARRIVAL_RISE_MS)) ** 2;
}

/** One swell falls somewhere in each slot, so they stay irregular, and any moment's answer needs no history. */
export function swellLift(nowMs: number): number {
  const slot = Math.floor(nowMs / SWELL_SLOT_MS);
  const roll = Math.abs(Math.sin((slot + 1) * 12.9898) * 43758.5453) % 1;
  const start = slot * SWELL_SLOT_MS + SWELL_REST_MS + roll * (SWELL_SLOT_MS - SWELL_REST_MS - SWELL_MS);
  const t = (nowMs - start) / SWELL_MS;
  return t > 0 && t < 1 ? Math.sin(Math.PI * t) ** 2 : 0;
}

/** How vivid `current` is from its own landing. A sky that arrives during another's landing doesn't inherit it. */
export function landingLift(current: SkyId, landing: { id: SkyId; at: number } | null, now: number): number {
  return landing?.id === current ? arrivalLift(now - landing.at) : 0;
}

/** The slow rise and fall in a settled sky's colour, as a multiplier around 1. */
export function breathAt(nowMs: number): number {
  return 1 + BREATH_DEPTH * Math.sin((nowMs / BREATH_MS) * 2 * Math.PI);
}

/** Only a real change lands. Reopening on the sky you last saw stays calm, and so does the first moment with no reading. */
export function shouldArrive(next: SkyId, seen: SkyId | null, lastLandedAt: number | undefined, now: number): boolean {
  if (next === "reading" || next === seen) return false;
  return lastLandedAt === undefined || now - lastLandedAt >= ARRIVAL_COOLDOWN_MS;
}

/** What one sky draws right now: its settled state, breathing, plus `lift` of its arrival. */
export function weatherAt(id: SkyId, lift: number, breath: number): Weather {
  const { draw, arrive } = SKIES[id];
  const colored = (color: Weather["haze"], added = 0): Weather["haze"] => color && [color[0], color[1] * breath + added * lift];
  const numeric = (value = 0, added = 0) => value + added * lift;
  return {
    tint: colored(draw.tint, arrive.tint),
    haze: colored(draw.haze, arrive.haze),
    veil: colored(draw.veil, arrive.veil),
    dust: numeric(draw.dust, arrive.dust),
    wind: numeric(draw.wind, arrive.wind),
    rise: numeric(draw.rise, arrive.rise),
    clouds: numeric(draw.clouds, arrive.clouds)
  };
}
