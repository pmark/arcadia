"use client";

import { useEffect, useRef, useState } from "react";
import { JourneyActivityLine, JourneyLegend, JourneyLog, JourneyMap, utcTime } from "../../../../components/journey-map";
import type { Journey } from "../../../../lib/journey-types";

/**
 * The server-rendered journey, kept current: refetches every
 * `refreshSeconds` and re-renders the same map. Scrolls the rover into the
 * middle of the view once, on load; later updates never move the reader.
 * `follow` is the route's action segment: an Action id, or `current`, which
 * keeps following the Project's current Action as its pointer moves.
 */
export function JourneyLive({ initial, follow, refreshSeconds }: { initial: Journey; follow: string; refreshSeconds: number }) {
  const [journey, setJourney] = useState(initial);
  const [stale, setStale] = useState<string | null>(null);
  const scrolled = useRef(false);
  // The server renders UTC; once in the browser, times read in the viewer's own zone.
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);
  const formatTime = local ? localTime : utcTime;

  useEffect(() => {
    if (scrolled.current) return;
    scrolled.current = true;
    document.getElementById("now")?.scrollIntoView({ block: "center", inline: "center" });
  }, []);

  useEffect(() => {
    const url = `/api/journey/${encodeURIComponent(initial.action.project)}/${encodeURIComponent(follow)}`;
    let cancelled = false;
    // Each poll spawns one CLI process on the shared host; a slow one never stacks another.
    let inFlight = false;
    const controller = new AbortController();
    const tick = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body = (await response.json()) as Journey & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        setJourney(body);
        setStale(null);
      } catch (error) {
        if (!cancelled) setStale(error instanceof Error ? error.message : String(error));
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void tick(), refreshSeconds * 1000);
    // A phone coming back to the tab sees the current journey at once.
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initial.action.project, follow, refreshSeconds]);

  const updated = local ? localTime(journey.generatedAt, true) : `${journey.generatedAt.slice(11, 19)} UTC`;
  return (
    <>
      <h1 className="text-[15px] font-semibold tracking-[.01em]">
        {follow === "current" ? <span className="mr-1.5 text-muted">current:</span> : null}
        {journey.action.id}
      </h1>
      <p className="mb-4 mt-0.5 text-[13px] text-muted">
        Destination: {journey.destination.label}
        {journey.destination.reached ? " — reached" : ""}
        <span className="ml-2">· updated {updated}{stale ? ` · refresh failed: ${stale}` : ""}</span>
      </p>
      <JourneyActivityLine journey={journey} formatTime={formatTime} />
      <JourneyMap journey={journey} />
      <JourneyLegend />
      <JourneyLog journey={journey} formatTime={formatTime} />
    </>
  );
}

/** The viewer's local time: "Oct 19, 9:50 AM", or with seconds and no date for the refresh stamp. */
function localTime(iso: string, clock = false): string {
  const date = new Date(iso);
  return clock
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" })
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
