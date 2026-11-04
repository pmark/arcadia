"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWorkspaceStatus } from "../../../hooks/use-workspace-status";
import { readSky, settleSky, type SettledSky, type SkyReading } from "../../../lib/system-sky";
import { skySourcesFrom } from "../../../lib/workspace-status";
import { mountWeather } from "./weather";

const SystemStatusContext = createContext<SkyReading | null>(null);

export function useSystemStatus(): SkyReading {
  const sky = useContext(SystemStatusContext);
  if (!sky) throw new Error("useSystemStatus must be used inside SystemStatusProvider.");
  return sky;
}

/** Mounted once in the workspace layout: one small read per window, and navigation never restarts it. */
export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const [settling, setSettling] = useState(true);
  const status = useWorkspaceStatus(settling);
  const [clock, setClock] = useState({ now: 0, resumedAt: 0 });
  useEffect(() => {
    setClock(current => ({ ...current, now: Date.now(), resumedAt: Date.now() }));
    const onVisible = () => { if (document.visibilityState === "visible") setClock({ now: Date.now(), resumedAt: Date.now() }); };
    const interval = setInterval(() => setClock(current => ({ ...current, now: Date.now() })), 15_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const reading = useMemo(() => readSky(skySourcesFrom(status.data, status.failed, clock.resumedAt, Math.max(clock.now, status.data ? Date.parse(status.data.generatedAt) : 0))), [status.data, status.failed, clock]);
  const [settled, setSettled] = useState<SettledSky>(() => ({ shown: reading, pending: null }));
  useEffect(() => {
    setSettled(state => settleSky(state, reading, Date.now()));
    setSettling(reading.id === "reading");
  }, [reading]);

  return <SystemStatusContext.Provider value={settled.shown}>{children}</SystemStatusContext.Provider>;
}

/** The weather over the sol sky. The sky controller keeps the time of day; this only paints over it. */
export function WorkspaceWeather() {
  const sky = useSystemStatus();
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
  const sky = useSystemStatus();
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
