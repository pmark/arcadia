"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { CONDITIONS, MOMENTARY_STATES, conditionOf, defaultPresence, loadPresence, remaining, savePresence, setCondition, setMomentary, setStyle, settle, snapshot, type ConditionId, type MomentaryState, type PresenceState } from "../../../lib/operator-presence";
import "./presence.css";

const CUSTOM_KEY = "arcadia.workspace.presence.custom.v1";
const MAX_CUSTOM = 3;
const MAX_IMAGE_BYTES = 1024 * 1024;
const IDLE: Record<ConditionId, [string, string]> = {
  calm: ["presence-drift", "6s"], content: ["presence-float", "7s"], focused: ["presence-hover", "4s"], stoked: ["presence-bounce", "1.4s"],
  tired: ["presence-sag", "8s"], stressed: ["presence-tremble", ".5s"], low: ["presence-sag", "7s"], playful: ["presence-bounce", "2.4s"]
};

function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }

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

function Glyph({ state }: { state: Pick<MomentaryState, "glyph" | "image" | "label"> }) {
  // eslint-disable-next-line @next/next/no-img-element -- a browser-local data URL, never a remote image.
  return state.image ? <img src={state.image} alt={state.label} /> : <>{state.glyph}</>;
}

/** The expressive avatar: the moonlet, small, in the profile button. */
function Moonlet({ presence }: { presence: PresenceState }) {
  const idle = IDLE[presence.condition];
  return <span className="presence-moonlet" data-fx={presence.now?.fx ?? ""} data-face={presence.now ? presence.now.face : conditionOf(presence.condition).face}
    style={{ "--idle-anim": idle[0], "--idle-dur": idle[1] } as CSSProperties}>
    <span className="body" />
    <span className="face"><i className="brow l" /><i className="brow r" /><i className="eye l" /><i className="eye r" /><i className="blush l" /><i className="blush r" /><i className="mouth" /></span>
  </span>;
}

/**
 * The operator's presence, in the workspace profile button and menu
 * (docs/design/operator-presence.md). Quiet by default: a status dot and words.
 */
export function PresenceMenu() {
  const [presence, setPresence] = useState<PresenceState>(() => defaultPresence(0));
  const [clock, setClock] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState<MomentaryState[]>([]);
  const [emoji, setEmoji] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const ref = useRef(presence);
  const wrap = useRef<HTMLDivElement>(null);
  const buttonId = useId();

  const commit = useCallback((next: PresenceState) => {
    ref.current = next; setPresence(next);
    setSaveFailed(!savePresence(storage(), next));
  }, []);

  useEffect(() => { const loaded = loadPresence(storage(), Date.now()); ref.current = loaded; setPresence(loaded); setClock(Date.now()); setCustom(readCustom()); }, []);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden || !ref.current.now) return;
      const at = Date.now(); setClock(at);
      const settled = settle(ref.current, at);
      if (settled !== ref.current) commit(settled);
    }, 1000);
    return () => clearInterval(id);
  }, [commit]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); document.getElementById(buttonId)?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open, buttonId]);
  useEffect(() => { if (open) wrap.current?.querySelector<HTMLButtonElement>(".presence-menu button")?.focus({ preventScroll: true }); }, [open]);

  const condition = conditionOf(presence.condition);
  const now = presence.now;
  const left = remaining(presence, clock);
  const minutes = left === null ? null : Math.max(1, Math.ceil((left * presence.decayMs) / 60_000));
  const summary = `${now ? `${now.label}${minutes ? ` for ${minutes} more min` : ""} · ` : ""}${condition.label} overall`;

  function pick(state: MomentaryState | null) { commit(setMomentary(ref.current, now?.id === state?.id ? null : state, Date.now())); }
  /** Keeps a custom state for next time; false (with the reason shown) when the browser refused. */
  function keepCustom(state: MomentaryState): boolean {
    const next = [state, ...custom.filter(c => c.glyph !== state.glyph || state.image)].slice(0, MAX_CUSTOM);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); setHint(null); }
    catch { setHint("This browser would not keep it (storage is full or blocked), so it shows now but is not saved for next time."); return false; }
    setCustom(next);
    return true;
  }
  /** Applies a custom state; the panel stays open when it could not be kept, so the reason is readable. */
  function takeCustom(state: MomentaryState) {
    if (keepCustom(state)) setCustomOpen(false);
    pick(state);
  }
  function applyEmoji() {
    const glyph = firstGrapheme(emoji.trim()); if (!glyph) return;
    setEmoji("");
    takeCustom({ id: `custom-${Date.now()}`, label: "Custom", glyph, fx: "tap", face: "" });
  }
  function applyFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setHint("That file is not an image. Pick a sticker or GIF."); return; }
    if (file.size > MAX_IMAGE_BYTES) { setHint("That file is over 1 MB. Pick a smaller sticker or GIF."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      takeCustom({ id: `sticker-${Date.now()}`, label: file.name.replace(/\.[^.]+$/, "").slice(0, 18) || "Sticker", glyph: null, image: String(reader.result), fx: "tap", face: "" });
    };
    reader.readAsDataURL(file);
  }

  // Tabbing out of the menu closes it, so focus never lands on controls hidden beneath it.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => { if (open && e.relatedTarget && !wrap.current?.contains(e.relatedTarget)) setOpen(false); };

  return <div className={`presence style-${presence.style}`} ref={wrap} onBlur={onBlur} style={{ "--hue": condition.hue } as CSSProperties}>
    <button id={buttonId} type="button" className="presence-button" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Your presence: ${summary}. Change it.`} onClick={() => setOpen(v => !v)}>
      {presence.style === "expressive" ? <Moonlet presence={presence} />
        : <svg className="presence-person" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4" /><path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" /></svg>}
      <span className="presence-dot" aria-hidden="true" />
      {presence.style === "expressive" && now && <span className="presence-badge" aria-hidden="true"><Glyph state={now} /></span>}
    </button>
    {open && <div className="presence-menu" role="dialog" aria-label="Your presence">
      <div className="presence-head"><b>Presence</b><span>{summary}</span></div>

      <h3 className="presence-k">Right now</h3>
      <div className="presence-states" role="group" aria-label="Right now">
        {[...MOMENTARY_STATES, ...custom].map(s => <button key={s.id} type="button" aria-pressed={now?.id === s.id} onClick={() => pick(s)}>
          <span className="glyph" aria-hidden="true"><Glyph state={s} /></span>{s.label}
        </button>)}
        <button type="button" aria-expanded={customOpen} onClick={() => setCustomOpen(v => !v)}><span className="glyph" aria-hidden="true">+</span>Your own</button>
      </div>
      {customOpen && <div className="presence-custom">
        <div className="row"><input type="text" maxLength={32} value={emoji} placeholder="Any emoji" aria-label="Any emoji" onChange={e => setEmoji(e.target.value)} onKeyDown={e => { if (e.key === "Enter") applyEmoji(); }} autoFocus /><button type="button" className="solid" onClick={applyEmoji}>Use</button></div>
        <label className="file">Upload a sticker or GIF<input type="file" accept="image/*" className="presence-sr" onChange={e => { applyFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <p>{hint ?? `Up to ${MAX_CUSTOM} of your own are kept, in this browser only. Images up to 1 MB.`}</p>
      </div>}
      {now && <button type="button" className="presence-clear" onClick={() => pick(null)}>Clear {now.label}</button>}

      <h3 className="presence-k">Overall</h3>
      <div className="presence-conditions" role="group" aria-label="Overall">
        {CONDITIONS.map(c => <button key={c.id} type="button" aria-pressed={presence.condition === c.id} onClick={() => commit(setCondition(ref.current, c.id))}>
          <span className="swatch" style={{ background: c.hue }} aria-hidden="true" />{c.label}
        </button>)}
      </div>

      <h3 className="presence-k">Style</h3>
      <div className="presence-style" role="group" aria-label="Style">
        <button type="button" aria-pressed={presence.style === "quiet"} onClick={() => commit(setStyle(ref.current, "quiet"))}>Quiet<span>A status dot</span></button>
        <button type="button" aria-pressed={presence.style === "expressive"} onClick={() => commit(setStyle(ref.current, "expressive"))}>Expressive<span>The moonlet avatar</span></button>
      </div>

      <details className="presence-signal"><summary>Signal</summary><pre>{JSON.stringify(snapshot(presence), null, 2)}</pre><p>Display only. Nothing outside this browser reads it.</p></details>
      {saveFailed && <p className="presence-note" role="status">Not saved in this browser.</p>}
    </div>}
  </div>;
}
