"use client";

import { useCallback, useEffect, useState } from "react";
import type { DispatchJournalResponse } from "../lib/arcadia-cli";

export function useDispatchJournal() {
  const [data, setData] = useState<DispatchJournalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/dispatch-journal?limit=25", { cache: "no-store" });
      const body = (await response.json()) as DispatchJournalResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Dispatch journal request failed.");
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The journal only changes when the operator resolves work, so it is polled
  // far less eagerly than System Status. This is a record to consult, not a
  // live monitor.
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { data, loading, refreshing, error, lastLoadedAt, refresh };
}
