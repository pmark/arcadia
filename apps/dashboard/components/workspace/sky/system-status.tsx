"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApprovals } from "../../../hooks/use-approvals";
import { useNextSteps } from "../../../hooks/use-next-steps";
import { useProductionCore } from "../../../hooks/use-production-core";
import { usePullRequestInventory } from "../../../hooks/use-pull-request-inventory";
import { productionFacts, readSky, settleSky, staleSources, type SettledSky, type SkyReading } from "../../../lib/system-sky";
import { buildFeed, type FeedItem } from "../../../lib/workspace-feed";
import { mountWeather } from "./weather";

interface SystemStatus {
  sky: SkyReading;
  items: FeedItem[];
  /** Sources that could not be read, by name. */
  problems: string[];
  loading: boolean;
}

const SystemStatusContext = createContext<SystemStatus | null>(null);

export function useSystemStatus(): SystemStatus {
  const status = useContext(SystemStatusContext);
  if (!status) throw new Error("useSystemStatus must be used inside SystemStatusProvider.");
  return status;
}

/** Mounted once in the workspace layout: one set of reads per window, and navigation never restarts them. */
export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const approvals = useApprovals();
  const nextSteps = useNextSteps();
  const prs = usePullRequestInventory();
  const core = useProductionCore();

  const items = useMemo(() => buildFeed({ approvals: approvals.hasLoaded ? approvals.approvals : null, nextSteps: nextSteps.data, pullRequests: prs.data }), [approvals.hasLoaded, approvals.approvals, nextSteps.data, prs.data]);
  // A failed read is a finished read: the alert says so instead of an endless "Reading…".
  const loading = (!approvals.hasLoaded && !approvals.error) || (!nextSteps.data && !nextSteps.failed) || prs.loading;
  const problems = useMemo(() => [approvals.error && "To-do list", nextSteps.failed && "next steps", prs.error && !prs.data && "pull requests"].filter((p): p is string => Boolean(p)), [approvals.error, nextSteps.failed, prs.error, prs.data]);

  const lastGood = useRef<Record<string, number>>({});
  const resumedAt = useRef(0);
  const [stale, setStale] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (approvals.hasLoaded && !approvals.error) lastGood.current["To-do list"] = Date.now(); }, [approvals.hasLoaded, approvals.error, approvals.approvals]);
  useEffect(() => { if (nextSteps.data && !nextSteps.failed) lastGood.current["next steps"] = Date.now(); }, [nextSteps.data, nextSteps.failed]);
  useEffect(() => { if (prs.data && !prs.error) lastGood.current["pull requests"] = Date.now(); }, [prs.data, prs.error]);
  useEffect(() => { if (core.data && !core.failed) lastGood.current.production = Date.now(); }, [core.data, core.failed]);
  useEffect(() => {
    const evaluate = () => {
      const next = staleSources(lastGood.current, resumedAt.current, Date.now());
      setStale(current => (current.join("|") === next.join("|") ? current : next));
      setTick(value => value + 1);
    };
    const onVisible = () => { if (document.visibilityState === "visible") { resumedAt.current = Date.now(); evaluate(); } };
    const interval = setInterval(evaluate, 15_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const production = useMemo(() => (core.failed ? null : core.data ? productionFacts(core.data) : undefined), [core.failed, core.data]);
  const reading = useMemo(() => readSky({ items, problems, stale, loading: loading || production === undefined, production }), [items, problems, stale, loading, production]);

  const [settled, setSettled] = useState<SettledSky>(() => ({ shown: reading, pending: null }));
  useEffect(() => { setSettled(state => settleSky(state, reading, Date.now())); }, [reading, tick]);

  const value = useMemo(() => ({ sky: settled.shown, items, problems, loading }), [settled.shown, items, problems, loading]);
  return <SystemStatusContext.Provider value={value}>{children}</SystemStatusContext.Provider>;
}

/** The weather over the sol sky. The sky controller keeps the time of day; this only paints over it. */
export function WorkspaceWeather() {
  const { sky } = useSystemStatus();
  const canvas = useRef<HTMLCanvasElement>(null);
  const skyId = useRef(sky.id);
  useEffect(() => { skyId.current = sky.id; }, [sky.id]);
  useEffect(() => {
    if (!canvas.current) return;
    return mountWeather(canvas.current, () => skyId.current);
  }, []);
  return <canvas ref={canvas} className="workspace-weather" aria-hidden="true" />;
}

/** The sky's reading in words, so the weather is never the only way to know. */
export function WorkspaceStatusPill() {
  const { sky } = useSystemStatus();
  const details = useRef<HTMLDetailsElement>(null);
  const close = () => { if (details.current) details.current.open = false; };
  return <details ref={details} className="workspace-status" onKeyDown={event => { if (event.key === "Escape" && details.current?.open) { close(); details.current.querySelector("summary")?.focus(); } }}>
    <summary><span className={`workspace-status-dot sky-${sky.id}`} aria-hidden="true" /><span className="workspace-sr">System status: </span><b aria-live="polite">{sky.label}</b>{sky.production && <span className="workspace-status-production">{sky.production}</span>}</summary>
    <div className="workspace-status-panel">
      {sky.reasons.length ? <ul>{sky.reasons.map(r => <li key={r.text}>{r.href ? <Link href={r.href} onClick={close}>{r.text}</Link> : r.text}</li>)}</ul> : <p>Nothing is moving or waiting.</p>}
      <p className="workspace-status-note">{sky.weather}. The weather shows system status from live reads. The sol sky keeps the time of day, and sample missions never change it.</p>
    </div>
  </details>;
}
