/**
 * The operator mood signal behind the /workspace moonlet (docs/design/operator-moonlet.md).
 *
 * Two layers: a slow ambient atmosphere, and an optional momentary state that
 * expires back to it. The signal lives only in this browser and is display
 * only: its snapshot always says `authority: "none"`, and nothing outside the
 * workspace surface reads it until an operator Decision says otherwise.
 */

export type AtmosphereId = "calm" | "content" | "focused" | "stoked" | "tired" | "stressed" | "low" | "playful";

/** What the weather layer draws for one atmosphere. Colors are hex; alphas 0..1. */
export interface Weather {
  tint?: [string, number];
  haze?: [string, number];
  veil?: [string, number];
  dust?: number;
  wind?: number;
  rise?: number;
  aurora?: number;
  clouds?: number;
  vignette?: number;
}

export interface Atmosphere {
  id: AtmosphereId;
  label: string;
  note: string;
  /** The moonlet's glow. */
  hue: string;
  /** The moonlet's resting face when no momentary state is set. */
  face: string;
  swatch: [string, string, string];
  weather: Weather;
}

export const ATMOSPHERES: readonly Atmosphere[] = [
  { id: "calm", label: "Calm", note: "clear skies", hue: "#e58f6f", face: "", swatch: ["#1b2140", "#4b4468", "#c98b7c"], weather: { tint: ["#8a6fd0", 0.06], dust: 10, wind: 0.15 } },
  { id: "content", label: "Content", note: "warm haze", hue: "#d79a74", face: "happy", swatch: ["#c9a58a", "#e6c7aa", "#f3dcc4"], weather: { haze: ["#ffd7a8", 0.2], dust: 24, wind: 0.15 } },
  { id: "focused", label: "Focused", note: "still, clear air", hue: "#8ea2ff", face: "", swatch: ["#04060e", "#0c1430", "#1f2848"], weather: { vignette: 0.5 } },
  { id: "stoked", label: "Stoked", note: "golden glow", hue: "#f2b13f", face: "happy", swatch: ["#2a2f6a", "#c6627a", "#f6b25c"], weather: { haze: ["#ffbf5a", 0.34], tint: ["#ffb347", 0.08], rise: 46 } },
  { id: "tired", label: "Tired", note: "dim and heavy", hue: "#9d8fc6", face: "sleepy", swatch: ["#0a0a15", "#1b1830", "#2f2942"], weather: { veil: ["#07061a", 0.4], dust: 4, wind: 0.05 } },
  { id: "stressed", label: "Stressed", note: "dust storm", hue: "#ef7a45", face: "worried", swatch: ["#57291a", "#984a29", "#c97a48"], weather: { haze: ["#c8743f", 0.6], tint: ["#a5502a", 0.22], dust: 320, wind: 2.6 } },
  { id: "low", label: "Low", note: "overcast", hue: "#8f9bb0", face: "flat", swatch: ["#394050", "#575e6c", "#7b7e87"], weather: { clouds: 0.7, veil: ["#2f3440", 0.22], dust: 6, wind: 0.2 } },
  { id: "playful", label: "Playful", note: "aurora", hue: "#7fe0c0", face: "happy", swatch: ["#081024", "#172b4a", "#3b3e6a"], weather: { aurora: 1, dust: 6, wind: 0.1 } }
];

export interface MomentaryState {
  id: string;
  label: string;
  /** An emoji, or null when `image` carries the visual. */
  glyph: string | null;
  /** A data URL for a custom sticker or GIF. */
  image?: string | null;
  /** Body motion and face, matched by CSS. */
  fx: string;
  face: string;
  /** Lights Phobos (fear) or Deimos (dread) in the sky. */
  moon?: "phobos" | "deimos" | null;
}

export const MOMENTARY_STATES: readonly MomentaryState[] = [
  { id: "thinking", label: "Thinking", glyph: "🤔", fx: "tilt", face: "side" },
  { id: "typing", label: "Typing", glyph: "⌨️", fx: "tap", face: "flat" },
  { id: "confused", label: "Confused", glyph: "😵‍💫", fx: "spin", face: "dizzy", moon: "phobos" },
  { id: "worried", label: "Worried", glyph: "😟", fx: "wobble", face: "worried", moon: "deimos" },
  { id: "rushing", label: "Rushing", glyph: "🏃", fx: "dash", face: "flat" },
  { id: "impatient", label: "Impatient", glyph: "⏳", fx: "tap", face: "angry", moon: "deimos" },
  { id: "angry", label: "Angry", glyph: "😠", fx: "shake", face: "angry" },
  { id: "freaking", label: "Freaking out", glyph: "😱", fx: "panic", face: "shock", moon: "phobos" },
  { id: "excited", label: "Excited", glyph: "🤩", fx: "hop", face: "happy" },
  { id: "stoked", label: "Stoked", glyph: "🤙", fx: "hop", face: "happy" },
  { id: "content", label: "Content", glyph: "😌", fx: "none", face: "happy" },
  { id: "away", label: "Stepped away", glyph: "☕", fx: "doze", face: "sleepy" }
];

export const MOOD_STORAGE_KEY = "arcadia.workspace.mood.v1";
export const DEFAULT_DECAY_MS = 5 * 60_000;

export interface MoodState {
  atmosphere: AtmosphereId;
  now: MomentaryState | null;
  /** Epoch ms when `now` reverts to the atmosphere; null holds it until changed. */
  expiresAt: number | null;
  setAt: number;
  decayMs: number;
}

export interface MoodSnapshot {
  signal: "operator.mood";
  atmosphere: AtmosphereId;
  now: string | null;
  since: string;
  expires: string | null;
  authority: "none";
}

export const defaultMood = (at: number): MoodState => ({ atmosphere: "calm", now: null, expiresAt: null, setAt: at, decayMs: DEFAULT_DECAY_MS });

export function atmosphereOf(id: AtmosphereId): Atmosphere {
  return ATMOSPHERES.find(a => a.id === id) ?? ATMOSPHERES[0];
}

/** A timestamp `new Date()` can represent; anything else in storage is treated as corrupt. */
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15;

const isAtmosphere = (value: unknown): value is AtmosphereId => typeof value === "string" && ATMOSPHERES.some(a => a.id === value);

function isState(value: unknown): value is MomentaryState {
  if (!value || typeof value !== "object") return false;
  const s = value as MomentaryState;
  return typeof s.id === "string" && typeof s.label === "string" && (s.glyph === null || typeof s.glyph === "string")
    && (s.image === undefined || s.image === null || (typeof s.image === "string" && s.image.startsWith("data:image/")))
    && typeof s.fx === "string" && typeof s.face === "string";
}

/** Reads the saved mood; anything unreadable, corrupt or blocked falls back to the default. */
export function loadMood(storage: Pick<Storage, "getItem"> | null, at: number): MoodState {
  try {
    const raw = storage?.getItem(MOOD_STORAGE_KEY);
    if (!raw) return defaultMood(at);
    const v = JSON.parse(raw) as Partial<MoodState>;
    if (!isAtmosphere(v.atmosphere)) return defaultMood(at);
    const decayMs = isTime(v.decayMs) && v.decayMs >= 0 ? v.decayMs : DEFAULT_DECAY_MS;
    const now = isState(v.now) ? v.now : null;
    const expiresAt = now && isTime(v.expiresAt) ? v.expiresAt : null;
    return settle({ atmosphere: v.atmosphere, now, expiresAt, setAt: isTime(v.setAt) ? v.setAt : at, decayMs }, at);
  } catch {
    return defaultMood(at);
  }
}

/** Saves the mood; returns false when the browser refused (quota, privacy mode) so the caller can say so. */
export function saveMood(storage: Pick<Storage, "setItem"> | null, mood: MoodState): boolean {
  try {
    storage?.setItem(MOOD_STORAGE_KEY, JSON.stringify(mood));
    return Boolean(storage);
  } catch {
    return false;
  }
}

/** Expires a momentary state whose time has passed. */
export function settle(mood: MoodState, at: number): MoodState {
  return mood.now && mood.expiresAt !== null && mood.expiresAt <= at ? { ...mood, now: null, expiresAt: null, setAt: mood.expiresAt } : mood;
}

export function setMomentary(mood: MoodState, state: MomentaryState | null, at: number): MoodState {
  return { ...mood, now: state, setAt: at, expiresAt: state && mood.decayMs > 0 ? at + mood.decayMs : null };
}

export function setAtmosphere(mood: MoodState, atmosphere: AtmosphereId): MoodState {
  return { ...mood, atmosphere };
}

/** 0..1 of the momentary state's time left, or null when nothing is counting down. */
export function remaining(mood: MoodState, at: number): number | null {
  if (!mood.now || mood.expiresAt === null || mood.decayMs <= 0) return null;
  return Math.max(0, Math.min(1, (mood.expiresAt - at) / mood.decayMs));
}

export function snapshot(mood: MoodState): MoodSnapshot {
  return {
    signal: "operator.mood",
    atmosphere: mood.atmosphere,
    now: mood.now ? (mood.now.image ? "custom:sticker" : mood.now.id) : null,
    since: new Date(mood.setAt).toISOString(),
    expires: mood.expiresAt === null ? null : new Date(mood.expiresAt).toISOString(),
    authority: "none"
  };
}
