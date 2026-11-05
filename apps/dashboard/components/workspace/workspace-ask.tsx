"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AskTrailResponse } from "../../lib/arcadia-cli";
import type { AskResponse } from "../../lib/types";
import { WorkspaceArtifactViewer } from "./workspace-artifact-viewer";
import { newRequestId } from "../../lib/launch-flow";
import { isDirectionView } from "../../lib/workspace-directions";
import type { DirectionView } from "../../../../src/ask/directionTypes.js";

type Target = { projectId?: string; plan?: string; action?: string; label: string; context: string };
type Exchange = { id: string; text: string; target: Target; mode?: "direction"; phase: "sending" | "acknowledged" | "uncertain"; summary?: string; status?: string; lookupOnly?: boolean };
/** `typedOn` is the route of a draft typed before its View was verified. Only that route's View may become its target. */
type Saved = { draft: string; target: Target | null; typedOn?: string; exchange: Exchange | null; history: Exchange[] };
const empty: Saved = { draft: "", target: null, exchange: null, history: [] };
const storageKey = "arcadia.workspace.ask.v1";
/** What the View on screen says Ask may use. A route that publishes nothing, like the Feed, has no subject to verify, so Ask uses portfolio routing there. */
type ViewTarget = { target: Target; available: boolean; reading: boolean; path?: string };
const PORTFOLIO: Target = { label: "Portfolio", context: "Portfolio" };
const noView: ViewTarget = { target: PORTFOLIO, available: true, reading: false };
type AskState = {
  saved: Saved; update: (next: Saved) => void; busy: boolean; warning: string | null;
  trail: AskTrailResponse | null; readError: string | null; missing: boolean;
  inspect: (id: string) => Promise<boolean>; send: (exchange: Exchange, fresh?: boolean) => Promise<void>;
  view: ViewTarget; publishView: (view: ViewTarget | null) => void;
};
const AskContext = createContext<AskState | null>(null);

function isTarget(value: unknown): value is Target {
  if (!value || typeof value !== "object") return false;
  const t = value as Target;
  return typeof t.label === "string" && typeof t.context === "string" && (t.projectId === undefined || (typeof t.projectId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(t.projectId))) &&
    [t.plan, t.action].every(v => v === undefined || (typeof v === "string" && /^[a-z0-9][a-z0-9-]*$/.test(v))) && (t.action === undefined || t.plan !== undefined);
}
function isExchange(value: unknown): value is Exchange {
  if (!value || typeof value !== "object") return false;
  const e = value as Exchange;
  return typeof e.id === "string" && typeof e.text === "string" && isTarget(e.target) && (e.mode === undefined || e.mode === "direction") && (e.summary === undefined || typeof e.summary === "string") && (e.status === undefined || typeof e.status === "string") && (e.lookupOnly === undefined || typeof e.lookupOnly === "boolean") && ["sending", "acknowledged", "uncertain"].includes(e.phase);
}

function selectExchange(saved: Saved, exchange: Exchange): Saved {
  const history = [saved.exchange, ...saved.history]
    .filter((item): item is Exchange => item !== null && item.id !== exchange.id)
    .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
    .slice(0, 5);
  return { ...saved, exchange, history };
}

function recoverExchange(exchange: Exchange): Exchange {
  return exchange.phase === "sending" ? { ...exchange, phase: "uncertain" } : exchange;
}

function matchesDirection(view: DirectionView, exchange: Exchange): boolean {
  const target = view.target as { projectId?: string; plan?: string; action?: string } | null;
  return view.requestId === exchange.id && view.content === exchange.text && target?.projectId === exchange.target.projectId &&
    target?.plan === exchange.target.plan && target?.action === exchange.target.action;
}

/** Mounted once in the workspace layout: navigation cannot replace an operation's identity. */
export function WorkspaceAskProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Saved>(empty);
  const current = useRef(saved);
  const lock = useRef(false);
  const preserveRaw = useRef(false);
  const reading = useRef(0);
  const trailId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [trail, setTrail] = useState<AskTrailResponse | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, publishView] = useState<ViewTarget | null>(null);

  function update(next: Saved) {
    preserveRaw.current = false;
    current.current = next;
    setSaved(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setWarning(null);
    } catch {
      setWarning("Browser storage is unavailable. This draft and receipt may be lost on reload; copy the receipt link before leaving.");
    }
  }
  async function inspect(id: string): Promise<boolean> {
    const sequence = ++reading.current;
    if (trailId.current !== id) { setTrail(null); trailId.current = id; }
    setReadError(null); setMissing(false);
    try {
      const response = await fetch(`/api/ask/show?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json() as AskTrailResponse & { error?: string };
      if (!response.ok) {
        if (sequence === reading.current) {
          setReadError(body.error ?? "Receipt read failed.");
          setMissing(response.status === 400 && Boolean(body.error?.includes("No Ask capture, request, or ask matches")));
        }
        return false;
      }
      if (body.direction && !isDirectionView(body.direction)) throw new Error("The direction receipt shape was invalid.");
      const original = current.current.exchange;
      if (original?.id === id && original.mode === "direction" && !original.lookupOnly) {
        if (!body.direction || !matchesDirection(body.direction, original)) throw new Error("The direction receipt did not match the original request and target.");
      }
      if (sequence === reading.current) {
        setTrail(body);
        const e = current.current.exchange;
        if (e?.id === id && e.phase !== "acknowledged") {
          const next: Saved = { ...current.current, exchange: { ...e, phase: "acknowledged", summary: undefined } };
          if (preserveRaw.current) { current.current = next; setSaved(next); }
          else update(next);
        }
      }
      return true;
    } catch (error) {
      if (sequence === reading.current) setReadError(error instanceof Error ? error.message : "Receipt read failed.");
      return false;
    }
  }
  async function send(exchange: Exchange, fresh = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setTrail(null); setReadError(null); setMissing(false); ++reading.current;
    // Synchronous storage attempt precedes fetch; the exact payload stays pinned even if navigation changes.
    const before = current.current;
    update({ ...selectExchange(before, { ...exchange, phase: "sending" }), ...(fresh ? { draft: "", target: null, typedOn: undefined } : {}) });
    const url = new URL(window.location.href); url.searchParams.set("receipt", exchange.id); window.history.replaceState(null, "", url);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: exchange.text, requestId: exchange.id,
        ...(exchange.mode === "direction" ? { directionTarget: { projectId: exchange.target.projectId, ...(exchange.target.plan ? { plan: exchange.target.plan } : {}), ...(exchange.target.action ? { action: exchange.target.action } : {}) } } : { projectId: exchange.target.projectId }) }) });
      const body = await response.json() as { message?: string; result?: AskResponse; direction?: DirectionView; error?: string };
      if (!response.ok || typeof body.message !== "string" || (exchange.mode === "direction" ? !isDirectionView(body.direction) : !body.result)) throw new Error(body.error ?? "The submission response was not confirmed.");
      if (exchange.mode === "direction" && !matchesDirection(body.direction!, exchange)) throw new Error("The direction response did not match the original request and target.");
      update({ ...current.current, exchange: { ...exchange, phase: "acknowledged", summary: body.message, status: exchange.mode === "direction" ? body.direction!.state : body.result!.result.status } });
      await inspect(exchange.id);
    } catch (error) {
      update({ ...current.current, exchange: { ...exchange, phase: "uncertain", summary: error instanceof Error ? error.message : "The submission response was not confirmed." } });
      await inspect(exchange.id);
    } finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    let restored = empty;
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Saved | null;
      if (value && typeof value.draft === "string" && (value.target === null || isTarget(value.target)) && (value.exchange === null || isExchange(value.exchange)) && Array.isArray(value.history) && value.history.every(isExchange)) {
        restored = { ...value, history: value.history.slice(0, 5) };
      } else if (value !== null) {
        preserveRaw.current = true;
        setWarning("Saved Ask recovery data is invalid. No draft or history was restored. The stored data remains unchanged until you edit or send.");
      }
    } catch { preserveRaw.current = true; setWarning("Browser storage could not be read. Reload recovery is unavailable; use a receipt link."); }
    if (restored.exchange) restored = selectExchange(restored, recoverExchange(restored.exchange));
    const id = new URL(window.location.href).searchParams.get("receipt");
    if (id && id !== restored.exchange?.id) {
      const known = restored.history.find(exchange => exchange.id === id);
      restored = selectExchange(restored, known ? recoverExchange(known) : { id, text: "Original request is being read from its receipt.", target: { label: "Receipt lookup", context: "Original context unavailable" }, phase: "uncertain", lookupOnly: true });
      // Persist the selection with the prior exchange retained, including when a known receipt is already acknowledged.
      if (!preserveRaw.current) update(restored);
    }
    current.current = restored; setSaved(restored);
    if (restored.exchange) void inspect(restored.exchange.id);
    // Initialization only reads the server; a reload never calls send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A draft typed while its View was reading belongs to that View once it's verified, so navigation can't retarget it.
  useEffect(() => {
    const draft = current.current;
    if (view?.available && draft.draft && draft.target === null && (draft.typedOn === undefined || draft.typedOn === view.path)) update({ ...draft, target: view.target, typedOn: undefined });
  }, [view, saved.draft, saved.target]);
  return <AskContext.Provider value={{ saved, update, busy, warning, trail, readError, missing, inspect, send, view: view ?? noView, publishView }}>{children}</AskContext.Provider>;
}

/** The View on screen says what Ask may use, and draws nothing: the composer lives in Relay, which the layout mounts once. */
export function WorkspaceAskTarget({ target, available, reading }: { target: Target; available: boolean; reading: boolean }) {
  const publish = useContext(AskContext)?.publishView;
  const path = usePathname();
  const key = JSON.stringify([target, available, reading, path]);
  useEffect(() => {
    if (!publish) return;
    publish({ target, available, reading, path });
    return () => publish(null);
    // The key holds every field, so a new object with the same values changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, publish]);
  return null;
}

/** What the capsule needs to show without opening: a send still in flight, or one whose outcome is unknown. */
export function useAskPhase(): Exchange["phase"] | null {
  return useContext(AskContext)?.saved.exchange?.phase ?? null;
}

type ComposerProps = {
  open: boolean; thread: boolean; head: ReactNode; fieldControl: ReactNode;
  field: RefObject<HTMLTextAreaElement | null>; onFieldFocus: (from: Element | null) => void;
};

/** Everything below the field waits behind `open`, inert, so the same field is the capsule at rest and the composer when open. */
export function WorkspaceAsk({ open, thread, head, fieldControl, field, onFieldFocus }: ComposerProps) {
  const [directionFor, setDirectionFor] = useState<string | null>(null);
  const state = useContext(AskContext);
  const path = usePathname();
  if (!state) return null;
  const { saved, update, busy, warning, trail, readError, missing, inspect, send, view: { target, available, reading } } = state;
  const draftTarget = saved.target ?? target;
  // A direction is an explicit choice of one target, so the choice ends if the target changes.
  const draftKey = JSON.stringify(draftTarget);
  if (directionFor !== null && directionFor !== draftKey) setDirectionFor(null);
  const directionMode = directionFor === draftKey;
  const changedScope = draftTarget.context !== target.context || draftTarget.projectId !== target.projectId;
  // Nothing is sent about a View that can't be verified. A draft explicitly on the whole portfolio doesn't depend on that View.
  const pinnedToPortfolio = saved.target !== null && !saved.target.projectId;
  // A draft typed on a View that never verified has no target yet, and the View now on screen is not one it chose.
  const orphaned = saved.target === null && Boolean(saved.draft.trim()) && saved.typedOn !== undefined && saved.typedOn !== path;
  const sendable = (available && !orphaned) || pinnedToPortfolio;
  const e = saved.exchange;
  const retryable = e?.phase === "uncertain" && missing && !e.lookupOnly;
  const receiptHref = e ? `/workspace?receipt=${encodeURIComponent(e.id)}` : null;
  const blocked = !sendable || busy || !saved.draft.trim() || e?.phase === "uncertain" || (directionMode && !draftTarget.projectId);
  function submit() {
    if (blocked) return;
    const exchange: Exchange = { id: newRequestId("workspace"), text: saved.draft.trim(), target: draftTarget, phase: "sending", ...(directionMode ? { mode: "direction" as const } : {}) };
    void send(exchange, true);
  }
  return <div className="workspace-ask relay-body">
    <div className="relay-head" inert={!open}>
      <span className="relay-grip" aria-hidden="true" />
      <p className="relay-chip">{orphaned ? "Choose where this draft goes" : reading && saved.target === null ? "Reading this view…" : draftTarget.projectId ? <>To Project <b>{draftTarget.label}</b></> : <>To your <b>whole portfolio</b></>}</p>
      {head}
    </div>
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <label htmlFor="workspace-ask-text" className="workspace-sr">What would you like to do?</label>
      <div className="relay-field">
        <textarea id="workspace-ask-text" ref={field} rows={1} placeholder="What would you like to do?" value={saved.draft}
          onFocus={event => onFieldFocus(event.relatedTarget instanceof Element ? event.relatedTarget : null)}
          onChange={event => {
            const pin = saved.target ?? (available && !orphaned ? target : null);
            update({ ...saved, draft: event.target.value, target: pin, typedOn: pin ? undefined : saved.draft.trim() ? saved.typedOn ?? path : path });
          }} />
        {fieldControl}
      </div>
      <div className="relay-send" inert={!open}>
        {orphaned && <p className="relay-why" role="status">You started this draft on a view that wasn&apos;t confirmed, so it has no target yet. <button type="button" disabled={!available || busy} onClick={() => update({ ...saved, target, typedOn: undefined })}>Use this view</button></p>}
        {reading && !sendable && !orphaned && <p className="relay-why" role="status">Reading this view. Keep typing; sending waits for it.</p>}
        {!reading && !sendable && !available && <p className="relay-why" role="status">Arcadia couldn&apos;t confirm this view, so Ask can&apos;t use it. Your draft stays. <button type="button" disabled={busy} onClick={() => update({ ...saved, target: PORTFOLIO, typedOn: undefined })}>Ask the whole portfolio instead</button></p>}
        <div className="relay-send-row">
          <label><input type="checkbox" checked={directionMode} disabled={!draftTarget.projectId || !sendable || busy} onChange={event => setDirectionFor(event.target.checked ? draftKey : null)} />Send as a direction to this context</label>
          <button type="submit" disabled={blocked}>{busy ? "Sending…" : directionMode ? "Send direction" : "Send new Ask"}</button>
        </div>
        {directionMode && <p className="relay-why">Records a direction for <b>{draftTarget.context}</b>. Delivery appears after the recipient records its checkpoint.</p>}
      </div>
    </form>
    <div className="relay-scroll" inert={!open}>
      {changedScope && <p role="status">Your unsent draft keeps its original target. <button type="button" disabled={!available || busy} onClick={() => update({ ...saved, target, typedOn: undefined })}>Use this view</button></p>}
      {thread && draftTarget.context !== draftTarget.label && <p className="workspace-muted">Selected: {draftTarget.context}. Selecting a Plan or Action doesn&apos;t change where an ordinary Ask goes.</p>}
      {warning && <p role="alert">{warning}</p>}
      {e && <section aria-label="Latest Ask" className="workspace-ask-receipt" aria-live="polite">
        <h2>Your Ask</h2><p>{trail?.capture?.originalText ?? e.text}</p>
        {e.summary && <><h3>{e.phase === "acknowledged" ? "Arcadia" : "Transport response"}</h3><p>{e.summary}</p></>}
        <p>Sent context: {e.target.context} · {e.target.label}</p>
        <p>{e.phase === "sending" ? "Sending — durable capture is not confirmed yet." : e.phase === "uncertain" ? "Submission outcome unknown. Inspect the receipt before retrying." : `Submission recorded${e.status ? ` · ${e.status}` : " via receipt"}.`}</p>
        {trail?.direction ? <DirectionCard view={trail.direction} /> : e.mode === "direction" && e.phase === "uncertain" ? <section aria-label="Direction receipt"><h3>Direction · unknown</h3><p>The submission outcome is unknown. Refresh reads the original receipt; nothing is resent automatically.</p><p>Evidence: {e.id} · workspace.submission · browser transport observation</p></section> : null}
        <details><summary>Receipt details</summary><p>Request: <code>{e.id}</code></p><a href={receiptHref!}>Receipt link (read only)</a></details><button type="button" disabled={busy} onClick={() => void inspect(e.id)}>Refresh receipt</button>
        {readError && <p role="alert">Receipt read failed: {readError} Any evidence below is from the last successful read. {e.phase === "acknowledged" ? "Your submission receipt is retained." : "No automatic resubmission was made."}</p>}
        {retryable && <button type="button" disabled={busy || !available} onClick={() => void send(e)}>Retry original unchanged Ask</button>}
        {e.phase === "uncertain" && !busy && <button type="button" onClick={() => {
          update({ ...saved, exchange: null, history: [e, ...saved.history].slice(0, 5) });
          const url = new URL(window.location.href); url.searchParams.delete("receipt"); window.history.replaceState(null, "", url);
        }}>Keep in history and start a new Ask</button>}
        {trail && <TrailCards trail={trail} receipt={e.id} />}
      </section>}
      <details className="workspace-history" open={thread}><summary>History & recovery</summary><p>One exchange is shown at a time. This browser keeps up to five earlier receipt identities; reopening only reads records.</p>{saved.history.map((old, index) => <p key={`${old.id}-${index}`}><button type="button" disabled={busy} onClick={() => { update(selectExchange(saved, recoverExchange(old))); const url = new URL(window.location.href); url.searchParams.set("receipt", old.id); window.history.replaceState(null, "", url); void inspect(old.id); }}>{old.target.label} · {old.id}</button></p>)}</details>
    </div>
  </div>;
}

function DirectionCard({ view }: { view: DirectionView }) {
  return <section aria-label="Direction receipt"><h3>Direction · {view.state}</h3>
    {view.reason && <p>{view.reason}</p>}<p>Last supported state: {view.lastSupportedState ?? "none"}.</p>
    <details><summary>Direction evidence</summary><p>Request: {view.requestId}</p><ul>{view.evidence.map((evidence, index) => <li key={`${evidence.artifact}-${index}`}>
      {evidence.state} · {evidence.provenance} · <time dateTime={evidence.observedAt}>{evidence.observedAt}</time>
      <p>{evidence.source} · {evidence.artifact}{evidence.revision ? ` · revision ${evidence.revision}` : ""}{evidence.result ? ` · ${evidence.result}` : ""}{evidence.current === false ? " · historical observation" : ""}</p>
    </li>)}</ul></details></section>;
}

function TrailCards({ trail, receipt }: { trail: AskTrailResponse; receipt: string }) {
  const [opened, setOpened] = useState<string | null>(null);
  const outcomes = [...(trail.capture?.outcomes ?? []), ...trail.asks.flatMap(ask => ask.outcomes)].filter((o, i, all) => all.findIndex(other => other.kind === o.kind && other.id === o.id) === i);
  const runs = trail.asks.flatMap(ask => ask.runs).filter((r, i, all) => all.findIndex(other => other.id === r.id) === i);
  return <section aria-label="Current Ask evidence"><h3>Current work & evidence</h3>
    {trail.capture ? <p>Capture · {trail.capture.status}</p> : <p>No linked capture record.</p>}
    {trail.capture?.status === "partial" && <p role="alert">Partial capture: inspect the durable effects below and the original reply before continuing. Do not automatically retry or submit another approval.</p>}
    {!trail.asks.length && <p>No linked Ask was processed, or older records could not be matched.</p>}
    {outcomes.map(o => <article key={`${o.kind}:${o.id}`}><h4>{o.summary ?? (o.kind === "decision" ? "Decision" : o.kind === "plan" ? "Execution Plan" : o.kind === "action" ? "Action" : o.kind === "back_burner_item" ? "Back Burner item" : o.kind)}</h4><p>{o.status ?? "No status recorded"}{o.projectName ? ` · ${o.projectName}` : ""}</p><details><summary>Record details</summary><p>{o.kind} · <code>{o.id}</code></p>{o.supersededBy && <p>Superseded by {o.supersededBy.askId}</p>}</details></article>)}
    {!outcomes.length && <p>No produced records yet.</p>}
    {!runs.length && <p>No Runs are linked. Capture or queueing alone does not prove work is complete.</p>}
    {runs.map(run => <article key={run.id}><h4>{run.summary ?? "Run"} · {run.status}</h4>{run.waitingReason && <p>{run.waitingReason}</p>}{run.artifacts.length ? run.artifacts.map(artifact => <div key={artifact.id}><p>Artifact · {artifact.status} · {artifact.kind}</p><button type="button" onClick={() => setOpened(artifact.id)}>Open Artifact</button><details><summary>Artifact evidence</summary><p>ID: <code>{artifact.id}</code></p><p>Evidence reference: <code>{artifact.evidenceReference}</code></p></details></div>) : <p>No linked Artifacts.</p>}<details><summary>Run details</summary><p>ID: <code>{run.id}</code></p></details></article>)}
    {opened && <WorkspaceArtifactViewer key={`${receipt}:${opened}`} id={opened} receipt={receipt} onClose={() => setOpened(null)} />}
    <details><summary>Routing & provenance</summary>{trail.capture && <p>Capture: <code>{trail.capture.id}</code></p>}{trail.asks.map(ask => <div key={ask.id}><p>Ask <code>{ask.id}</code> · {ask.status}</p><p>{ask.projectName ?? "No Project recorded"} · {ask.executionPath ?? ask.outputKind}</p>{ask.reason && <p>Why: {ask.reason}</p>}{ask.supersededBy.map(link => <p key={link.askId}>Superseded by {link.askId} · {link.record.id ?? "no new record"}</p>)}</div>)}</details>
  </section>;
}
