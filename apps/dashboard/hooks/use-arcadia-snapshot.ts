"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeNextPollDelayMs } from "../lib/snapshot-polling";
import type { DashboardSnapshot } from "../lib/types";

interface SnapshotState {
  snapshot: DashboardSnapshot | null;
  error: string | null;
  /** True when `error` is set but `snapshot` still holds the last successful load. */
  stale: boolean;
  loading: boolean;
  refreshing: boolean;
  lastLoadedAt: Date | null;
  refresh: () => Promise<void>;
}

export function useArcadiaSnapshot(): SnapshotState {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  // Coalescing/backoff state lives in refs, not React state: a poll timer, a
  // visibility listener, and a reconnect listener can all decide to refresh
  // around the same moment, and none of them should start a second fetch
  // while one is already in flight or schedule a duplicate timer.
  const inFlightRef = useRef<Promise<void> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const hasActiveWorkRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;

    const run = (async () => {
      setRefreshing(true);
      try {
        const response = await fetch("/api/snapshot", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(errorMessageFromBody(body, "Snapshot request failed."));
        }

        const next = body as DashboardSnapshot;
        setSnapshot(next);
        setError(null);
        setLastLoadedAt(new Date());
        consecutiveFailuresRef.current = 0;
        hasActiveWorkRef.current = (next.counts.activeRuns ?? 0) > 0 || (next.activeAgentSessions?.length ?? 0) > 0;
      } catch (refreshError) {
        // Preserve the last-known-good snapshot; only the error/backoff state
        // reflects the failure, so the UI can label it stale without losing
        // what it already knew.
        consecutiveFailuresRef.current += 1;
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    })();

    inFlightRef.current = run;
    try {
      await run;
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function scheduleNext() {
      const delay = computeNextPollDelayMs({
        hasActiveWork: hasActiveWorkRef.current,
        consecutiveFailures: consecutiveFailuresRef.current
      });
      timerRef.current = window.setTimeout(() => {
        void (async () => {
          await refresh();
          scheduleNext();
        })();
      }, delay);
    }

    scheduleNext();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    function onOnline() {
      void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  return {
    snapshot,
    error,
    stale: error !== null && snapshot !== null,
    loading,
    refreshing,
    lastLoadedAt,
    refresh
  };
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const error = "error" in body && typeof body.error === "string" ? body.error : fallback;
  const details = "details" in body ? body.details : null;
  if (!details) {
    return error;
  }

  return `${error}\n${JSON.stringify(details, null, 2)}`;
}
