"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardSnapshot } from "../lib/types";

interface SnapshotState {
  snapshot: DashboardSnapshot | null;
  error: string | null;
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Snapshot request failed.");
      }

      setSnapshot(body as DashboardSnapshot);
      setError(null);
      setLastLoadedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 45_000);

    return () => window.clearInterval(interval);
  }, [refresh]);

  return { snapshot, error, loading, refreshing, lastLoadedAt, refresh };
}
