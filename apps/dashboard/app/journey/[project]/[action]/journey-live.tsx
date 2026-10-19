"use client";

import { useEffect, useRef, useState } from "react";
import { JourneyLegend, JourneyLog, JourneyMap } from "../../../../components/journey-map";
import type { Journey } from "../../../../lib/journey-types";

/**
 * The server-rendered journey, kept current: refetches every
 * `refreshSeconds` and re-renders the same map. Scrolls the rover into the
 * middle of the view once, on load; later updates never move the reader.
 */
export function JourneyLive({ initial, refreshSeconds }: { initial: Journey; refreshSeconds: number }) {
  const [journey, setJourney] = useState(initial);
  const [stale, setStale] = useState<string | null>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    if (scrolled.current) return;
    scrolled.current = true;
    document.getElementById("now")?.scrollIntoView({ block: "center", inline: "center" });
  }, []);

  useEffect(() => {
    const url = `/api/journey/${encodeURIComponent(initial.action.project)}/${encodeURIComponent(initial.action.id)}`;
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const body = (await response.json()) as Journey & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        setJourney(body);
        setStale(null);
      } catch (error) {
        if (!cancelled) setStale(error instanceof Error ? error.message : String(error));
      }
    };
    const timer = window.setInterval(() => void tick(), refreshSeconds * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [initial.action.project, initial.action.id, refreshSeconds]);

  const updated = journey.generatedAt.slice(11, 19);
  return (
    <>
      <h1 className="text-[15px] font-semibold tracking-[.01em]">{journey.action.id}</h1>
      <p className="mb-4 mt-0.5 text-[13px] text-muted">
        Destination: {journey.destination.label}
        {journey.destination.reached ? " — reached" : ""}
        <span className="ml-2" aria-live="polite">· updated {updated} UTC{stale ? ` · refresh failed: ${stale}` : ""}</span>
      </p>
      <JourneyMap journey={journey} />
      <JourneyLegend />
      <JourneyLog journey={journey} />
    </>
  );
}
