"use client";

import { useEffect, useState } from "react";
import { PlanJourneyList } from "../../../../../components/journey-plan";
import type { PlanJourney } from "../../../../../lib/journey-types";
import type { PathBrief } from "../../../../../lib/path-types";

/** The server-rendered Plan journey, refetched every `refreshSeconds`; times read in the viewer's zone once hydrated. */
export function PlanJourneyLive({ initial, path, follow, refreshSeconds }: { initial: PlanJourney; path: PathBrief | null; follow: string; refreshSeconds: number }) {
  const [journey, setJourney] = useState(initial);
  const [stale, setStale] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);

  useEffect(() => {
    const url = `/api/journey/${encodeURIComponent(initial.project)}/plan/${encodeURIComponent(follow)}`;
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();
    const tick = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body = (await response.json()) as PlanJourney & { error?: string };
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
  }, [initial.project, follow, refreshSeconds]);

  const formatTime = (iso: string) =>
    local ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : `${iso.slice(0, 16).replace("T", " ")} UTC`;
  return (
    <>
      <h1 className="text-[15px] font-semibold tracking-[.01em]">
        {follow === "current" ? <span className="mr-1.5 text-muted">current:</span> : null}
        {journey.plan.slug}
      </h1>
      <p className="mb-4 mt-0.5 text-[13px] text-muted">
        {journey.project}{journey.plan.active ? " · active Plan" : ""}
        <span className="ml-2">· updated {local ? new Date(journey.generatedAt).toLocaleTimeString() : `${journey.generatedAt.slice(11, 19)} UTC`}{stale ? ` · refresh failed: ${stale}` : ""}</span>
      </p>
      <PlanJourneyList journey={journey} path={path} formatTime={formatTime} />
    </>
  );
}
