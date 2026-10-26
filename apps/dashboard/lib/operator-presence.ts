/**
 * The operator presence signal behind the workspace profile menu (docs/design/operator-presence.md).
 *
 * Two layers: a slow overall condition, and an optional momentary state that
 * expires back to it. The sky does not read this: it shows system status
 * (./system-sky.ts). The signal lives only in this browser and is display
 * only: its snapshot always says `authority: "none"`, and nothing outside the
 * workspace surface reads it until an operator Decision says otherwise.
 */

export type ConditionId = "calm" | "content" | "focused" | "stoked" | "tired" | "stressed" | "low" | "playful";
/** Quiet is a status dot and words; Expressive adds the animated moonlet avatar. */
export type PresenceStyle = "quiet" | "expressive";

export interface Condition {
  id: ConditionId;
  label: string;
  /** The status dot, and the expressive avatar's glow. */
  hue: string;
  /** The expressive avatar's resting face when no momentary state is set. */
  face: string;
}

export const CONDITIONS: readonly Condition[] = [
  { id: "calm", label: "Calm", hue: "#9fb7d9", face: "" },
  { id: "content", label: "Content", hue: "#d79a74", face: "happy" },
  { id: "focused", label: "Focused", hue: "#8ea2ff", face: "" },
  { id: "stoked", label: "Stoked", hue: "#f2b13f", face: "happy" },
  { id: "tired", label: "Tired", hue: "#9d8fc6", face: "sleepy" },
  { id: "stressed", label: "Stressed", hue: "#ef7a45", face: "worried" },
  { id: "low", label: "Low", hue: "#8f9bb0", face: "flat" },
  { id: "playful", label: "Playful", hue: "#7fe0c0", face: "happy" }
];

export interface MomentaryState {
  id: string;
  label: string;
  /** An emoji, or null when `image` carries the visual. */
  glyph: string | null;
  /** A data URL for a custom sticker or GIF. */
  image?: string | null;
  /** Expressive avatar motion and face, matched by CSS. */
  fx: string;
  face: string;
}

export const MOMENTARY_STATES: readonly MomentaryState[] = [
  { id: "thinking", label: "Thinking", glyph: "🤔", fx: "tilt", face: "side" },
  { id: "typing", label: "Typing", glyph: "⌨️", fx: "tap", face: "flat" },
  { id: "confused", label: "Confused", glyph: "😵‍💫", fx: "spin", face: "dizzy" },
  { id: "worried", label: "Worried", glyph: "😟", fx: "wobble", face: "worried" },
  { id: "rushing", label: "Rushing", glyph: "🏃", fx: "dash", face: "flat" },
  { id: "impatient", label: "Impatient", glyph: "⏳", fx: "tap", face: "angry" },
  { id: "angry", label: "Angry", glyph: "😠", fx: "shake", face: "angry" },
  { id: "freaking", label: "Freaking out", glyph: "😱", fx: "panic", face: "shock" },
  { id: "excited", label: "Excited", glyph: "🤩", fx: "hop", face: "happy" },
  { id: "stoked", label: "Stoked", glyph: "🤙", fx: "hop", face: "happy" },
  { id: "content", label: "Content", glyph: "😌", fx: "none", face: "happy" },
  { id: "away", label: "Stepped away", glyph: "☕", fx: "doze", face: "sleepy" }
];

export const PRESENCE_STORAGE_KEY = "arcadia.workspace.presence.v1";
export const DEFAULT_DECAY_MS = 5 * 60_000;
/** The longest fade a saved setting may ask for; anything longer is treated as corrupt. */
export const MAX_DECAY_MS = 24 * 60 * 60_000;

export interface PresenceState {
  condition: ConditionId;
  now: MomentaryState | null;
  /** Epoch ms when `now` reverts to the condition; null holds it until changed. */
  expiresAt: number | null;
  setAt: number;
  decayMs: number;
  style: PresenceStyle;
}

export interface PresenceSnapshot {
  signal: "operator.presence";
  condition: ConditionId;
  now: string | null;
  since: string;
  expires: string | null;
  authority: "none";
}

export const defaultPresence = (at: number): PresenceState => ({ condition: "calm", now: null, expiresAt: null, setAt: at, decayMs: DEFAULT_DECAY_MS, style: "quiet" });

export function conditionOf(id: ConditionId): Condition {
  return CONDITIONS.find(c => c.id === id) ?? CONDITIONS[0];
}

/** A timestamp `new Date()` can represent; anything else in storage is treated as corrupt. */
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15;

const isCondition = (value: unknown): value is ConditionId => typeof value === "string" && CONDITIONS.some(c => c.id === value);

function isState(value: unknown): value is MomentaryState {
  if (!value || typeof value !== "object") return false;
  const s = value as MomentaryState;
  return typeof s.id === "string" && typeof s.label === "string" && (s.glyph === null || typeof s.glyph === "string")
    && (s.image === undefined || s.image === null || (typeof s.image === "string" && s.image.startsWith("data:image/")))
    && typeof s.fx === "string" && typeof s.face === "string";
}

/** Reads the saved presence; anything unreadable, corrupt or blocked falls back to the default. */
export function loadPresence(storage: Pick<Storage, "getItem"> | null, at: number): PresenceState {
  try {
    const raw = storage?.getItem(PRESENCE_STORAGE_KEY);
    if (!raw) return defaultPresence(at);
    const v = JSON.parse(raw) as Partial<PresenceState>;
    if (!isCondition(v.condition)) return defaultPresence(at);
    const decayMs = isTime(v.decayMs) && v.decayMs >= 0 && v.decayMs <= MAX_DECAY_MS ? v.decayMs : DEFAULT_DECAY_MS;
    const now = isState(v.now) ? v.now : null;
    const expiresAt = now && isTime(v.expiresAt) ? v.expiresAt : null;
    const style: PresenceStyle = v.style === "expressive" ? "expressive" : "quiet";
    return settle({ condition: v.condition, now, expiresAt, setAt: isTime(v.setAt) ? v.setAt : at, decayMs, style }, at);
  } catch {
    return defaultPresence(at);
  }
}

/** Saves the presence; returns false when the browser refused (quota, privacy mode) so the caller can say so. */
export function savePresence(storage: Pick<Storage, "setItem"> | null, presence: PresenceState): boolean {
  try {
    storage?.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(presence));
    return Boolean(storage);
  } catch {
    return false;
  }
}

/** Expires a momentary state whose time has passed. */
export function settle(presence: PresenceState, at: number): PresenceState {
  return presence.now && presence.expiresAt !== null && presence.expiresAt <= at ? { ...presence, now: null, expiresAt: null, setAt: presence.expiresAt } : presence;
}

export function setMomentary(presence: PresenceState, state: MomentaryState | null, at: number): PresenceState {
  return { ...presence, now: state, setAt: at, expiresAt: state && presence.decayMs > 0 ? at + presence.decayMs : null };
}

export function setCondition(presence: PresenceState, condition: ConditionId): PresenceState {
  return { ...presence, condition };
}

export function setStyle(presence: PresenceState, style: PresenceStyle): PresenceState {
  return { ...presence, style };
}

/** 0..1 of the momentary state's time left, or null when nothing is counting down. */
export function remaining(presence: PresenceState, at: number): number | null {
  if (!presence.now || presence.expiresAt === null || presence.decayMs <= 0) return null;
  return Math.max(0, Math.min(1, (presence.expiresAt - at) / presence.decayMs));
}

/** An ISO time, or null for anything a Date cannot represent, so a bad value never breaks rendering. */
const iso = (at: number | null) => (at !== null && isTime(at) ? new Date(at).toISOString() : null);

export function snapshot(presence: PresenceState): PresenceSnapshot {
  return {
    signal: "operator.presence",
    condition: presence.condition,
    now: presence.now ? (presence.now.image ? "custom:sticker" : presence.now.id) : null,
    since: iso(presence.setAt) ?? new Date(0).toISOString(),
    expires: iso(presence.expiresAt),
    authority: "none"
  };
}
