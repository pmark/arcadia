"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AskTrailResponse } from "../../lib/arcadia-cli";
import type { AskResponse } from "../../lib/types";
import { WorkspaceArtifactViewer } from "./workspace-artifact-viewer";
import { newRequestId } from "../../lib/launch-flow";

type Target = { projectId?: string; label: string; context: string };
type Exchange = { id: string; text: string; target: Target; phase: "sending" | "acknowledged" | "uncertain"; summary?: string; status?: string; lookupOnly?: boolean };
type Saved = { draft: string; target: Target | null; exchange: Exchange | null; history: Exchange[] };
const empty: Saved = { draft: "", target: null, exchange: null, history: [] };
const storageKey = "arcadia.workspace.ask.v1";
type AskState = {
  saved: Saved; update: (next: Saved) => void; busy: boolean; warning: string | null;
  trail: AskTrailResponse | null; readError: string | null; missing: boolean;
  inspect: (id: string) => Promise<boolean>; send: (exchange: Exchange, fresh?: boolean) => Promise<void>;
};
const AskContext = createContext<AskState | null>(null);

function isTarget(value: unknown): value is Target {
  if (!value || typeof value !== "object") return false;
  const t = value as Target;
  return typeof t.label === "string" && typeof t.context === "string" && (t.projectId === undefined || (typeof t.projectId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(t.projectId)));
}
function isExchange(value: unknown): value is Exchange {
  if (!value || typeof value !== "object") return false;
  const e = value as Exchange;
  return typeof e.id === "string" && typeof e.text === "string" && isTarget(e.target) && (e.summary === undefined || typeof e.summary === "string") && (e.status === undefined || typeof e.status === "string") && (e.lookupOnly === undefined || typeof e.lookupOnly === "boolean") && ["sending", "acknowledged", "uncertain"].includes(e.phase);
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
    update({ ...selectExchange(before, { ...exchange, phase: "sending" }), ...(fresh ? { draft: "", target: null } : {}) });
    const url = new URL(window.location.href); url.searchParams.set("receipt", exchange.id); window.history.replaceState(null, "", url);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: exchange.text, requestId: exchange.id, projectId: exchange.target.projectId }) });
      const body = await response.json() as { message?: string; result?: AskResponse; error?: string };
      if (!response.ok || !body.result || typeof body.message !== "string") throw new Error(body.error ?? "The submission response was not confirmed.");
      update({ ...current.current, exchange: { ...exchange, phase: "acknowledged", summary: body.message, status: body.result.result.status } });
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
  return <AskContext.Provider value={{ saved, update, busy, warning, trail, readError, missing, inspect, send }}>{children}</AskContext.Provider>;
}

export function WorkspaceAsk({ target, available }: { target: Target; available: boolean }) {
  const state = useContext(AskContext);
  if (!state) return null;
  const { saved, update, busy, warning, trail, readError, missing, inspect, send } = state;
  const draftTarget = saved.target ?? target;
  const changedScope = draftTarget.context !== target.context || draftTarget.projectId !== target.projectId;
  const e = saved.exchange;
  const retryable = e?.phase === "uncertain" && missing && !e.lookupOnly;
  const receiptHref = e ? `/workspace?receipt=${encodeURIComponent(e.id)}` : null;
  function submit() {
    if (!available || busy || !saved.draft.trim() || e?.phase === "uncertain") return;
    const exchange: Exchange = { id: newRequestId("workspace"), text: saved.draft.trim(), target: draftTarget, phase: "sending" };
    void send(exchange, true);
  }
  return <div className="workspace-ask">
    <p>{draftTarget.projectId ? `Ask routes to Project ${draftTarget.label}.` : "Ask uses portfolio routing."}</p>
    <p className="workspace-muted">Selected: {draftTarget.context}. Selecting a Plan or Action does not automatically change it.</p>
    {changedScope && <p role="status">Your unsent draft keeps its original target. <button type="button" disabled={!available || busy} onClick={() => update({ ...saved, target })}>Use selected context for draft</button></p>}
    {!available && <p role="status">Ask is unavailable until the selected context can be verified.</p>}
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <label htmlFor="workspace-ask-text">What would you like to do?</label>
      <textarea id="workspace-ask-text" rows={4} value={saved.draft} disabled={!available} onChange={event => update({ ...saved, draft: event.target.value, target: saved.target ?? target })} />
      <button type="submit" disabled={!available || busy || !saved.draft.trim() || e?.phase === "uncertain"}>{busy ? "Sending…" : "Send new Ask"}</button>
    </form>
    {warning && <p role="alert">{warning}</p>}
    {e && <section aria-label="Latest Ask" className="workspace-ask-receipt" aria-live="polite">
      <h2>Your Ask</h2><p>{trail?.capture?.originalText ?? e.text}</p>
      <p>Sent context: {e.target.context} · {e.target.label}</p>
      <p>{e.phase === "sending" ? "Sending — durable capture is not confirmed yet." : e.phase === "uncertain" ? "Submission outcome unknown. Inspect the receipt before retrying." : `Submission acknowledged${e.status ? ` · ${e.status}` : " via receipt"}.`}</p>
      {e.summary && <><h3>{e.phase === "acknowledged" ? "Arcadia" : "Transport response"}</h3><p>{e.summary}</p></>}
      <details><summary>Receipt details</summary><p>Request: <code>{e.id}</code></p><a href={receiptHref!}>Receipt link (read only)</a></details><button type="button" disabled={busy} onClick={() => void inspect(e.id)}>Refresh receipt</button>
      {readError && <p role="alert">Receipt read failed: {readError} Any evidence below is from the last successful read. {e.phase === "acknowledged" ? "Your submission acknowledgment is retained." : "No automatic resubmission was made."}</p>}
      {retryable && <button type="button" disabled={busy || !available} onClick={() => void send(e)}>Retry original unchanged Ask</button>}
      {e.phase === "uncertain" && !busy && <button type="button" onClick={() => {
        update({ ...saved, exchange: null, history: [e, ...saved.history].slice(0, 5) });
        const url = new URL(window.location.href); url.searchParams.delete("receipt"); window.history.replaceState(null, "", url);
      }}>Keep in history and start a new Ask</button>}
      {trail && <TrailCards trail={trail} receipt={e.id} />}
    </section>}
    <details className="workspace-history"><summary>History & recovery</summary><p>One exchange is shown at a time. This browser keeps up to five earlier receipt identities; reopening only reads records.</p>{saved.history.map((old, index) => <p key={`${old.id}-${index}`}><button type="button" disabled={busy} onClick={() => { update(selectExchange(saved, recoverExchange(old))); const url = new URL(window.location.href); url.searchParams.set("receipt", old.id); window.history.replaceState(null, "", url); void inspect(old.id); }}>{old.target.label} · {old.id}</button></p>)}</details>
  </div>;
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
