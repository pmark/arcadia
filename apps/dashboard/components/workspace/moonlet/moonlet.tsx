"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ATMOSPHERES, MOMENTARY_STATES, atmosphereOf, type AtmosphereId, type MomentaryState, type MoodState } from "../../../lib/operator-mood";

const CUSTOM_KEY = "arcadia.workspace.mood.custom.v1";
const MAX_CUSTOM = 3;
const MAX_IMAGE_BYTES = 1024 * 1024;
const TRAIL = 257.6;
const IDLE: Record<AtmosphereId, [string, string]> = {
  calm: ["moonlet-drift", "6s"], content: ["moonlet-float", "7s"], focused: ["moonlet-hover", "4s"], stoked: ["moonlet-bounce", "1.4s"],
  tired: ["moonlet-sag", "8s"], stressed: ["moonlet-tremble", ".5s"], low: ["moonlet-sag", "7s"], playful: ["moonlet-bounce", "2.4s"]
};

function readCustom(): MomentaryState[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as MomentaryState[];
    return Array.isArray(v) ? v.filter(s => s && typeof s.id === "string" && typeof s.label === "string" && (!s.image || (typeof s.image === "string" && s.image.startsWith("data:image/")))).slice(0, MAX_CUSTOM) : [];
  } catch { return []; }
}

/** One emoji, however many code units it takes (a family emoji is eleven). */
function firstGrapheme(text: string): string {
  if (!text) return "";
  const segments = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text) : null;
  return segments ? (segments[Symbol.iterator]().next().value?.segment ?? "") : Array.from(text)[0] ?? "";
}

function focusMoonlet(id: string) {
  document.getElementById(id)?.focus({ preventScroll: true });
}

function Glyph({ state }: { state: Pick<MomentaryState, "glyph" | "image" | "label"> }) {
  // eslint-disable-next-line @next/next/no-img-element -- a browser-local data URL, never a remote image.
  return state.image ? <img src={state.image} alt={state.label} /> : <>{state.glyph}</>;
}

/** Positions on a half orbit above the moonlet, left to right. */
function arc<T>(items: T[], radius: number, scale: number, delay: number) {
  return items.map((item, i) => {
    const a = Math.PI + ((i + 0.5) / items.length) * Math.PI;
    return { item, style: { "--x": `${Math.cos(a) * radius * scale}px`, "--y": `${Math.sin(a) * radius * scale}px`, animationDelay: `${delay + i * 22}ms` } as CSSProperties };
  });
}

export function Moonlet({ mood, left, onMomentary, onAtmosphere }: {
  mood: MoodState;
  /** 0..1 of the momentary state's time left, or null. */
  left: number | null;
  onMomentary: (state: MomentaryState | null) => void;
  onAtmosphere: (id: AtmosphereId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "sky">("now");
  const [caption, setCaption] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState<MomentaryState[]>([]);
  const [emoji, setEmoji] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const wrap = useRef<HTMLDivElement>(null);
  const buttonId = useId();
  const atmosphere = atmosphereOf(mood.atmosphere);
  const now = mood.now;

  useEffect(() => { setCustom(readCustom()); }, []);
  useEffect(() => {
    const fit = () => setScale(Math.max(0.72, Math.min(1, (innerWidth - 24) / 420)));
    fit(); addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    if (!open && !customOpen) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) { setOpen(false); setCustomOpen(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setCustomOpen(false); focusMoonlet(buttonId); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open, customOpen, buttonId]);
  useEffect(() => { if (open) wrap.current?.querySelector<HTMLButtonElement>(".moonlet-chip")?.focus({ preventScroll: true }); }, [open, mode]);

  function close() { setOpen(false); focusMoonlet(buttonId); }
  function keepCustom(state: MomentaryState) {
    const next = [state, ...custom.filter(c => c.glyph !== state.glyph || state.image)].slice(0, MAX_CUSTOM);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); setHint(null); }
    catch { setHint("This browser is out of room for stickers, so this one is not kept. Your earlier ones are."); return; }
    setCustom(next);
  }
  function applyEmoji() {
    const glyph = firstGrapheme(emoji.trim()); if (!glyph) return;
    const state: MomentaryState = { id: `custom-${Date.now()}`, label: "Custom", glyph, fx: "tap", face: "" };
    keepCustom(state); setEmoji(""); setCustomOpen(false); onMomentary(state);
  }
  function applyFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setHint("That file is not an image. Pick a sticker or GIF."); return; }
    if (file.size > MAX_IMAGE_BYTES) { setHint("That file is over 1 MB. Pick a smaller sticker or GIF."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const state: MomentaryState = { id: `sticker-${Date.now()}`, label: file.name.replace(/\.[^.]+$/, "").slice(0, 18) || "Sticker", glyph: null, image: String(reader.result), fx: "tap", face: "" };
      keepCustom(state); setCustomOpen(false); onMomentary(state);
    };
    reader.readAsDataURL(file);
  }

  const idle = IDLE[mood.atmosphere];
  const head = mode === "now" ? "How are you, right now?" : "Set your atmosphere";
  let chips: ReactNode = null;
  if (open && mode === "now") {
    const outer: Array<MomentaryState | "add"> = [...MOMENTARY_STATES.slice(5), ...custom, "add"];
    chips = [...arc(MOMENTARY_STATES.slice(0, 5) as Array<MomentaryState | "add">, 92, scale, 0), ...arc(outer, 160, scale, 90)].map(({ item, style }) => item === "add"
      ? <button key="add" type="button" className="moonlet-chip moonlet-add" style={style} aria-label="Your own emoji, sticker or GIF" onPointerEnter={() => setCaption("Your own emoji, sticker or GIF")} onFocus={() => setCaption("Your own emoji, sticker or GIF")} onClick={() => { setOpen(false); setCustomOpen(true); }}>+</button>
      : <button key={item.id} type="button" className="moonlet-chip" style={style} aria-label={item.label} aria-pressed={now?.id === item.id} onPointerEnter={() => setCaption(item.label)} onFocus={() => setCaption(item.label)} onClick={() => { onMomentary(now?.id === item.id ? null : item); close(); }}><Glyph state={item} /></button>);
  } else if (open) {
    chips = [...arc(ATMOSPHERES.slice(0, 3), 92, scale, 0), ...arc(ATMOSPHERES.slice(3), 160, scale, 80)].map(({ item, style }) =>
      <button key={item.id} type="button" className="moonlet-chip" style={style} aria-label={`${item.label} · ${item.note}`} aria-pressed={mood.atmosphere === item.id} onPointerEnter={() => setCaption(`${item.label} · ${item.note}`)} onFocus={() => setCaption(`${item.label} · ${item.note}`)} onClick={() => { onAtmosphere(item.id); close(); }}>
        <span className="moonlet-swatch" style={{ background: `linear-gradient(180deg, ${item.swatch[0]}, ${item.swatch[1]} 55%, ${item.swatch[2]})` }} />
      </button>);
  }

  return <>
    {(open || customOpen) && <div className="moonlet-scrim" aria-hidden="true" />}
    <div className={`moonlet-wrap${open ? " picking" : ""}`} ref={wrap} style={{ "--hue": atmosphere.hue } as CSSProperties}>
      <svg className="moonlet-trail" viewBox="0 0 86 86" aria-hidden="true">
        <circle className="track" cx="43" cy="43" r="41" />
        <circle className="left" cx="43" cy="43" r="41" strokeDasharray={TRAIL} strokeDashoffset={TRAIL * (1 - (left ?? 0))} style={{ opacity: left === null ? 0 : 0.8 }} />
      </svg>
      <button id={buttonId} type="button" className="moonlet" aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Your moonlet: ${now ? `${now.label}, ` : ""}${atmosphere.label.toLowerCase()} atmosphere. Tap to change.`}
        data-fx={now?.fx ?? ""} data-face={now ? now.face : atmosphere.face}
        style={{ "--idle-anim": idle[0], "--idle-dur": idle[1] } as CSSProperties}
        onClick={() => { setCustomOpen(false); setMode("now"); setCaption(null); setOpen(v => !v); }}>
        <span className="moonlet-body" />
        <span className="moonlet-face"><i className="brow l" /><i className="brow r" /><i className="eye l" /><i className="eye r" /><i className="blush l" /><i className="blush r" /><i className="mouth" /></span>
      </button>
      {now && <span className="moonlet-now" aria-hidden="true"><Glyph state={now} /></span>}
      {open && <div className="moonlet-orbits" role="dialog" aria-label="How do you feel?">
        <span className="moonlet-ring" style={{ width: 184 * scale, height: 184 * scale }} />
        <span className="moonlet-ring" style={{ width: 320 * scale, height: 320 * scale }} />
        <div className="moonlet-head" style={{ top: -(160 * scale) - 96 }}>
          <div className="moonlet-seg" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "now"} onClick={() => { setMode("now"); setCaption(null); }}>Right now</button>
            <button type="button" role="tab" aria-selected={mode === "sky"} onClick={() => { setMode("sky"); setCaption(null); }}>Atmosphere</button>
          </div>
          <div className="moonlet-caption">{caption ?? head}</div>
        </div>
        {chips}
      </div>}
      {customOpen && <div className="moonlet-custom" role="dialog" aria-label="Your own state">
        <div className="row"><input type="text" maxLength={32} value={emoji} placeholder="Any emoji" aria-label="Any emoji" onChange={e => setEmoji(e.target.value)} onKeyDown={e => { if (e.key === "Enter") applyEmoji(); }} autoFocus /><button type="button" className="solid" onClick={applyEmoji}>Use</button></div>
        <div className="row"><label className="file">Upload a sticker or GIF<input type="file" accept="image/*" className="moonlet-sr" onChange={e => { applyFile(e.target.files?.[0]); e.target.value = ""; }} /></label><button type="button" onClick={() => { setCustomOpen(false); focusMoonlet(buttonId); }}>Cancel</button></div>
        <p>{hint ?? `Up to ${MAX_CUSTOM} of your own stay in your orbit, in this browser only. Images up to 1 MB.`}</p>
      </div>}
    </div>
  </>;
}
