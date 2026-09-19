"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardAgentSession, DashboardRun } from "../lib/types";

export interface RunsData {
  generatedAt: string;
  activeAgentSessions: DashboardAgentSession[];
  activeExecutionRuns: DashboardRun[];
  recentRuns: DashboardRun[];
}

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

/**
 * Active Sessions and Runs come from a lean endpoint and poll faster while
 * work is live. Recent history is only fetched once the operator asks for it.
 */
export function useRuns(historyOpen: boolean) {
  const [data, setData] = useState<RunsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyRef = useRef(historyOpen);
  const failuresRef = useRef(0);
  const activeRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const withHistory = historyRef.current;
      const response = await fetch(`/api/runs?recent=${withHistory ? 10 : 0}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Runs request failed.");
      setData(body as RunsData);
      if (withHistory) setHistoryLoaded(true);
      setError(null);
      setLastLoadedAt(new Date());
      failuresRef.current = 0;
      activeRef.current = body.activeAgentSessions.length > 0 || body.activeExecutionRuns.length > 0;
    } catch (refreshError) {
      failuresRef.current += 1;
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Sync the ref before refreshing so the request sees the new history state.
    historyRef.current = historyOpen;
    void refresh();
  }, [refresh, historyOpen]);

  useEffect(() => {
    disposedRef.current = false;
    function schedule() {
      if (disposedRef.current) return;
      const base = activeRef.current ? ACTIVE_POLL_MS : IDLE_POLL_MS;
      const delay = Math.min(base * 2 ** Math.min(failuresRef.current, 4), 120_000);
      timerRef.current = window.setTimeout(() => {
        void refresh().then(() => {
          if (!disposedRef.current) schedule();
        });
      }, delay);
    }
    schedule();
    return () => {
      disposedRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [refresh]);

  return { data, historyLoaded, error, stale: error !== null && data !== null, loading, refreshing, lastLoadedAt, refresh };
}
