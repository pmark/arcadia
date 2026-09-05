"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ErrorState, LoadingState } from "../../components/dashboard-ui";
import { buildFlightDeck, FLIGHT_DECK_COLUMNS, type FlightDeckCard, type FlightDeckColumn } from "../../lib/flight-deck";
import type { DashboardSnapshot } from "../../lib/types";
import type { WorkQueue } from "../../lib/work-queue-types";

const COLUMN_LABEL: Record<FlightDeckColumn, string> = {
  "needs-you": "Needs You", ready: "Ready to dispatch", running: "Running", proving: "Proving", landed: "Landed"
};

export default function FlightDeckPage() {
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [queueResponse, snapshotResponse] = await Promise.all([fetch("/api/work-queue", { cache: "no-store" }), fetch("/api/snapshot", { cache: "no-store" })]);
      const [queueBody, snapshotBody] = await Promise.all([queueResponse.json(), snapshotResponse.json()]);
      if (!queueResponse.ok || !snapshotResponse.ok) throw new Error(queueBody.error ?? snapshotBody.error ?? "Could not load Flight Deck.");
      setQueue(queueBody as WorkQueue); setSnapshot(snapshotBody as DashboardSnapshot);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const lanes = useMemo(() => queue && snapshot ? buildFlightDeck(queue, snapshot) : [], [queue, snapshot]);
  const total = lanes.reduce((sum, lane) => sum + lane.cards.length, 0);

  return <main className="min-h-dvh bg-canvas px-4 py-6 text-ink sm:px-6">
    <div className="mx-auto max-w-[1600px]">
      <nav className="mb-4 flex gap-4 text-sm"><Link href="/now">Now</Link><Link href="/work-queue">Work Queue</Link><Link href="/review">Decisions</Link></nav>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-moss">Arcadia</p><h1 className="text-3xl font-semibold">Flight Deck</h1><p className="mt-1 text-sm text-muted">Read-only queue and recent evidence: {total} objects visible.</p><p className="mt-1 text-xs text-muted">Needs You includes waiting and repair work; each card names who can act. Landed describes the Artifact, not Action acceptance or merge.</p></div><button disabled={loading} onClick={() => void load()} className="rounded-md border border-line bg-panel px-3 py-2 text-sm font-medium disabled:opacity-50">Refresh</button></header>
      {loading ? <LoadingState /> : error ? <div className="grid gap-3"><ErrorState message={error} /><button onClick={() => void load()} className="justify-self-start rounded-md border border-line bg-panel px-3 py-2 text-sm font-medium">Try again</button></div> : <div className="overflow-x-auto pb-4"><div className="min-w-[1050px]">
        <div className="grid grid-cols-[220px_repeat(5,minmax(160px,1fr))] gap-3 border-b border-line pb-3"> <div />{FLIGHT_DECK_COLUMNS.map((column) => <h2 key={column} className="text-xs font-semibold uppercase tracking-wide text-muted">{COLUMN_LABEL[column]}</h2>)}</div>
        <div className="mt-3 grid gap-4">{lanes.map((lane) => <section key={`${lane.projectId}:${lane.planSlug ?? "unattached"}`} className="grid grid-cols-[220px_repeat(5,minmax(160px,1fr))] gap-3 rounded-lg border border-line bg-panel/40 p-3"><div><p className="font-semibold">{lane.projectName}</p><p className="text-sm text-muted">{lane.planSlug ?? "Unattached"}</p><p className="mt-1 text-xs text-muted">{lane.planSlug ? lane.milestone ?? "Milestone unavailable" : "No derivable Plan"}</p></div>{FLIGHT_DECK_COLUMNS.map((column) => <div key={column} className="grid content-start gap-2">{lane.cards.filter((card) => card.column === column).map((card) => <Card key={card.id} card={card} />)}</div>)}</section>)}</div>
      </div></div>}
    </div>
  </main>;
}

function Card({ card }: { card: FlightDeckCard }) {
  return <article className="border-l-4 border-moss rounded-md border border-line bg-panel p-3 shadow-soft">
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{card.kind}</p>
    <h3 className="mt-1 text-sm font-semibold">{card.title}</h3>
    <p className="mt-1 text-xs font-medium">{card.stateLabel}</p>
    <p className="mt-1 line-clamp-3 text-xs text-muted">{card.detail}</p>
    {card.relation !== "direct" ? <p className="mt-2 text-[10px] uppercase tracking-wide text-muted">
      {card.relation === "unattached" ? "Unattached to a Plan" : card.relation === "named-in-prose" ? "Plan named in prose" : "Linked structurally"}
    </p> : null}
  </article>;
}
