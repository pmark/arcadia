"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { goMove, type ContinuationBody, type GoMove, type GoRelation } from "../../lib/workspace-go";
import { workspaceHref } from "../../lib/workspace-scope";

export interface GoRead {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** The last good read for this Project, kept through a later failure so it is labelled, never silently lost. */
  last: { move: GoMove; at: Date } | null;
  again: () => void;
}
type Entry = { status: GoRead["status"]; error: string | null; last: GoRead["last"]; sequence: number };
const idle: Entry = { status: "idle", error: null, last: null, sequence: 0 };
/** An older read is shown with its time; re-entering a Project after this long asks Go again. */
const REREAD_AFTER_MS = 5 * 60_000;
const GoContext = createContext<{ entries: Record<string, Entry>; read: (projectId: string) => void } | null>(null);

/**
 * Mounted once in the workspace layout. Go's resolution comes from the existing continuation route, which runs
 * `arcadia next` and journals each read, so it is read on first selection, after REREAD_AFTER_MS, or on request:
 * never on every navigation and never on a timer.
 */
export function WorkspaceGoProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const sequences = useRef<Record<string, number>>({});
  const read = useCallback((projectId: string) => {
    const sequence = (sequences.current[projectId] ?? 0) + 1;
    sequences.current[projectId] = sequence;
    const set = (patch: Partial<Entry>) => setEntries(all => {
      const entry = all[projectId] ?? idle;
      // A slower earlier read never overwrites a later one.
      return entry.sequence > sequence ? all : { ...all, [projectId]: { ...entry, ...patch, sequence } };
    });
    set({ status: "loading", error: null });
    fetch(`/api/projects/${encodeURIComponent(projectId)}/continuation`, { cache: "no-store" }).then(async response => {
      const body = await response.json() as ContinuationBody & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Arcadia could not read Go's resolution.");
      if (!Array.isArray(body?.continuation?.blockers)) throw new Error("the reply was not a Go resolution.");
      set({ status: "ready", error: null, last: { move: goMove(body.continuation), at: new Date() } });
    }).catch((error: unknown) => set({ status: "error", error: error instanceof Error ? error.message : String(error) }));
  }, []);
  return <GoContext.Provider value={{ entries, read }}>{children}</GoContext.Provider>;
}

export function useGoRead(projectId: string | undefined): GoRead {
  const context = useContext(GoContext);
  const entry = (projectId && context?.entries[projectId]) || idle;
  const stale = !entry.last || Date.now() - entry.last.at.getTime() > REREAD_AFTER_MS;
  const read = context?.read;
  const due = Boolean(projectId && read && entry.status !== "loading" && entry.status !== "error" && stale);
  useEffect(() => { if (due && projectId && read) read(projectId); }, [due, projectId, read]);
  return { status: entry.status, error: entry.error, last: entry.last, again: () => { if (projectId) read?.(projectId); } };
}

function where(move: GoMove, relation: GoRelation | null, project: string) {
  if (relation === "here") return <p className="workspace-go-where">This is Go&apos;s current Action.</p>;
  if (move.kind === "none" || !relation) return null;
  const href = workspaceHref({ project, plan: move.plan, action: move.action.id });
  if (relation === "other-plan") return <p className="workspace-go-where">Go&apos;s current work is in Plan <Link href={href}>{move.plan}</Link>. Selecting this Plan doesn&apos;t change that.</p>;
  if (relation === "same-plan") return <p className="workspace-go-where">Go&apos;s current Action in this Plan is <Link href={href}>{move.action.title}</Link>.</p>;
  return <p className="workspace-go-where"><Link href={href}>Show Go&apos;s current Action</Link></p>;
}

export function WorkspaceNextMove({ go, project, relation }: { go: GoRead; project: { id: string; slug: string } | null; relation: GoRelation | null }) {
  const { last } = go;
  return <section className="workspace-go" aria-labelledby="workspace-go-title">
    <div className="workspace-section-heading"><h2 id="workspace-go-title" tabIndex={-1}>Next move</h2>{project && <button type="button" disabled={go.status === "loading"} onClick={go.again}>Read again</button>}</div>
    {!project ? <p className="workspace-muted">Choose a Project to see Go&apos;s next move. Go resolves one Project at a time.</p> : <>
      {go.status === "loading" && <p role="status">{last ? "Asking Go again…" : "Asking Go…"}</p>}
      {go.status === "error" && <p role="alert">Go could not be read: {go.error} {last ? "What follows is Go's last good read." : "Nothing is shown in its place."}</p>}
      {last && <div aria-live="polite">
        <p className="workspace-go-source">From Go · read at {last.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        {last.move.kind === "ready" && <><p className="workspace-go-state ready">Ready to continue</p><p><strong>{last.move.action.title}</strong></p>{last.move.action.next && <p>{last.move.action.next}</p>}</>}
        {last.move.kind === "gated" && <><p className="workspace-go-state gated">Waiting</p><p><strong>{last.move.action.title}</strong></p><p>{last.move.reason}</p>{last.move.remedy && <p className="workspace-muted">{last.move.remedy}</p>}</>}
        {last.move.kind === "none" && <><p className="workspace-go-state none">No current Action</p><p>{last.move.reason}</p>{last.move.remedy && <p className="workspace-muted">{last.move.remedy}</p>}</>}
        {where(last.move, relation, project.slug)}
        <p className="workspace-muted">Starting or continuing work stays on <Link href={`/projects/${encodeURIComponent(project.id)}`}>this Project&apos;s page</Link>, with its existing checks. Nothing here starts work.</p>
      </div>}
    </>}
  </section>;
}
