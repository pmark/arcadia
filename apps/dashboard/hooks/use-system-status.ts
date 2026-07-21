"use client";

import { useCallback, useEffect, useState } from "react";
import type { SystemStatusResponse } from "../lib/system-status";

export function useSystemStatus() {
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/status", { cache: "no-store" });
      const body = (await response.json()) as SystemStatusResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "System Status request failed.");
      setData(body);
      setError(null);
      setLastLoadedAt(new Date());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { data, loading, refreshing, error, lastLoadedAt, refresh };
}
