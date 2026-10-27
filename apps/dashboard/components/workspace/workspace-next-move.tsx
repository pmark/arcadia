"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createGoReadGate, goMove, isContinuation, type GoBlocker, type GoMove, type GoRelation } from "../../lib/workspace-go";
import { workspaceHref } from "../../lib/workspace-scope";

export interface GoRead {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** The last good read for this Project, kept through a later failure so it is labelled, never silently lost. */
  last: { move: GoMove; at: Date } | null;
  again: () => void;
}
type Entry = Omit<GoRead, "again">;
const idle: Entry = { status: "idle", error: null, last: null };
const GoContext = createContext<{ entries: Record<string, Entry>; start: (projectId: string, force: boolean) => void } | null>(null);

/**
 * Mounted once in the workspace layout. Go's resolution comes from the existing continuation route, which runs
 * `arcadia next` and journals each read. The gate allows one read per Project at a time, repeats it only when the
 * last attempt is older than five minutes, and Read again skips only that age check. Nothing reads on a timer.
 */
export function WorkspaceGoProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [gate] = useState(() => createGoReadGate());
  const start = useCallback((projectId: string, force: boolean) => {
    if (!gate.begin(projectId, Date.now(), force)) return;
    const patch = (next: Partial<Entry>) => setEntries(all => ({ ...all, [projectId]: { ...(all[projectId] ?? idle), ...next } }));
    const finish = (next: Partial<Entry>) => { gate.end(projectId, Date.now()); patch(next); };
    patch({ status: "loading", error: null });
    fetch(`/api/projects/${encodeURIComponent(projectId)}/continuation`, { cache: "no-store" }).then(async response => {
      let body: unknown = null;
      try { body = await response.json(); } catch { /* A non-JSON reply is reported by its status below. */ }
      const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : null;
      if (!response.ok) throw new Error(message ?? `the continuation route answered ${response.status}.`);
      const continuation = body && typeof body === "object" ? (body as { continuation?: unknown }).continuation : undefined;
      if (!isContinuation(continuation)) throw new Error("the reply was not a Go resolution.");
      finish({ status: "ready", error: null, last: { move: goMove(continuation), at: new Date() } });
    }).catch((error: unknown) => finish({ status: "error", error: error instanceof Error ? error.message : String(error) }));
  }, [gate]);
  return <GoContext.Provider value={{ entries, start }}>{children}</GoContext.Provider>;
}

export function useGoRead(projectId: string | undefined): GoRead {
  const context = useContext(GoContext);
  const start = context?.start;
  // The gate, not this effect, decides; a doubled or repeated mount cannot start a second read.
  useEffect(() => { if (projectId && start) start(projectId, false); }, [projectId, start]);
  const entry = (projectId && context?.entries[projectId]) || idle;
  return { ...entry, again: () => { if (projectId) start?.(projectId, true); } };
}

export const goReadTime = (at: Date) => at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The source line for Go-derived details shown outside Direction, so an old read is never presented as current. */
export function GoSource({ go }: { go: GoRead }) {
  if (!go.last) return null;
  return <p className="workspace-go-source">From Go · read at {goReadTime(go.last.at)}{go.status === "error" ? " · last good read; Go could not be read since" : ""}</p>;
}

function Blockers({ question, blockers }: { question: string | null; blockers: GoBlocker[] }) {
  return <>
    {question && <p>{question}</p>}
    {blockers.length > 0 && <ul className="workspace-go-blockers">{blockers.map((b, i) => <li key={i}>{b.message}{b.remedy && <span className="workspace-muted"> {b.remedy}</span>}</li>)}</ul>}
  </>;
}

function where(move: GoMove, relation: GoRelation | null, project: string) {
  if (relation === "here") return <p className="workspace-go-where">This is Go&apos;s current Action.</p>;
  if (move.kind === "none" || !relation) return null;
  const href = workspaceHref({ project, plan: move.plan, action: move.action.id });
  if (relation === "other-plan") return <p className="workspace-go-where">Go&apos;s current work is in Plan <Link href={href}>{move.plan}</Link>. Selecting this Plan doesn&apos;t change that.</p>;
  if (relation === "same-plan") return <p className="workspace-go-where">Go&apos;s current Action in this Plan is <Link href={href}>{move.action.title}</Link>.</p>;
  return <p className="workspace-go-where"><Link href={href}>Show Go&apos;s current Action</Link></p>;
}

const STATE: Record<GoMove["kind"], string> = { ready: "Ready to continue", gated: "Waiting", "not-agent": "Not an agent's to take", none: "No current Action" };
function announce(go: GoRead, project: boolean) {
  if (!project) return "";
  if (go.status === "error") return `Go could not be read${go.last ? "; showing the last good read" : ""}.`;
  if (!go.last) return "Asking Go.";
  const move = go.last.move;
  return `Go: ${STATE[move.kind]}${move.kind === "none" ? "" : `, ${move.action.title}`}.`;
}

export function WorkspaceNextMove({ go, project, relation }: { go: GoRead; project: { id: string; slug: string } | null; relation: GoRelation | null }) {
  const { last } = go;
  const busy = go.status === "loading" || go.status === "idle";
  return <section className="workspace-go" aria-labelledby="workspace-go-title">
    <div className="workspace-section-heading"><h2 id="workspace-go-title" tabIndex={-1}>Next move</h2>{project && <button type="button" aria-disabled={busy} onClick={() => { if (!busy) go.again(); }}>Read again</button>}</div>
    {/* Mounted before any result so each change is announced once, briefly. */}
    <p className="workspace-sr" aria-live="polite">{announce(go, Boolean(project))}</p>
    {!project ? <p className="workspace-muted">Choose a Project to see Go&apos;s next move. Go resolves one Project at a time.</p> : <>
      {busy && <p>{last ? "Asking Go again…" : "Asking Go…"}</p>}
      {go.status === "error" && <p role="alert">Go could not be read: {go.error} {last ? "What follows is Go's last good read." : "Nothing is shown in its place."}</p>}
      {last && <div className="workspace-go-result">
        <GoSource go={go} />
        <p className={`workspace-go-state ${last.move.kind}`}>{STATE[last.move.kind]}</p>
        {last.move.kind !== "none" && <p><strong>{last.move.action.title}</strong></p>}
        {last.move.kind === "ready" && last.move.action.next && <p>{last.move.action.next}</p>}
        {(last.move.kind === "gated" || last.move.kind === "none") && <Blockers question={last.move.question} blockers={last.move.blockers} />}
        {last.move.kind === "none" && !last.move.question && !last.move.blockers.length && <p>Go found no current Action for this Project.</p>}
        {last.move.kind === "not-agent" && <p>{last.move.authorization}</p>}
        {where(last.move, relation, project.slug)}
        <p className="workspace-muted">Starting or continuing work stays on <Link href={`/projects/${encodeURIComponent(project.id)}`}>this Project&apos;s page</Link>, with its existing checks. Nothing here starts work.</p>
      </div>}
    </>}
  </section>;
}
