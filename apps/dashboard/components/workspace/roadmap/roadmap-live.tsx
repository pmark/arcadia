"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RoadmapView } from "../../../../../src/roadmap/derive";
import { REFRESH_SECONDS, singleFlight, startPolling } from "./roadmap-poll";
import { RoadmapStack } from "./roadmap-view";
import "./roadmap.css";

function clock(iso: string): string {
  // Fixed UTC so the server's and the browser's render agree (no hydration mismatch, no locale guess).
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(11, 19)} UTC`;
}

/**
 * The Roadmap page: the server-rendered first paint, then a poll every 30 seconds that pauses while the tab is hidden
 * and catches up the moment it is shown again. A failed poll keeps the last good read and says so.
 */
export function RoadmapLive({ project, initial, initialError }: { project: string; initial: RoadmapView | null; initialError: string | null }) {
  const [view, setView] = useState<RoadmapView | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [reading, setReading] = useState(false);

  const fetchView = useCallback(async (fresh: boolean) => {
    setReading(true);
    try {
      const response = await fetch(`/api/roadmap/${encodeURIComponent(project)}${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      const body = await response.json() as RoadmapView | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : `HTTP ${response.status}`);
      setView(body as RoadmapView);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReading(false);
    }
  }, [project]);
  const read = useMemo(() => singleFlight(fetchView), [fetchView]);

  useEffect(() => startPolling(read, document), [read]);

  return <main className="workspace-main route-main roadmap-main" data-roadmap-project={project}>
    <div className="rm-card">
      <button type="button" className="rm-refresh" onClick={() => { void read(true); }} disabled={reading}>{reading ? "Reading…" : "Refresh"}</button>
      <p className="rm-kind">Roadmap · {project} · a read-only view of checked-in records</p>
      <h1 className="rm-title">The route to the North Star</h1>
      <p className="rm-interim" data-testid="roadmap-interim">Interim page: it shows Plans and counts from the records, and no Milestone is claimed or declared here.</p>
      {view && <p className="rm-fresh" data-testid="roadmap-freshness">Read at {clock(view.generatedAt)}. Updates about every {REFRESH_SECONDS} seconds while this page is open.</p>}
      {error && <p className="rm-problem" role="alert">{view ? "Could not read this again, so this is the last good read: " : "The Roadmap could not be read: "}{error}</p>}
      {view && view.warnings.length > 0 && <ul className="rm-warnings" aria-label="Sources that could not be used">
        {view.warnings.map((w, i) => <li key={i}><code>{w.source}</code> {w.message}</li>)}
      </ul>}
    </div>
    {view ? <RoadmapStack view={view} /> : !error ? <p className="route-empty" role="status">Reading…</p> : null}
  </main>;
}
