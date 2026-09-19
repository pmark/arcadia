"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CapacityStatusResponse,
  DispatchJournalEvent,
  ProductionStatusResponse,
  ScheduleProjectSummary
} from "../lib/arcadia-cli";

export interface ProductionControlData {
  production: ProductionStatusResponse;
  worker: { running: boolean; heartbeat: { timestamp: string | null; fresh: boolean; available: boolean } };
  capacity: CapacityStatusResponse | null;
  schedule: { projects: ScheduleProjectSummary[]; selection: string | null } | null;
  alerts: {
    capacityRefusals: Array<{ providerId: string; label: string; reason: string }>;
    blockedDispatches: DispatchJournalEvent[];
  };
}

const POLL_MS = 20_000;

export function useProductionControl() {
  const [data, setData] = useState<ProductionControlData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = (async () => {
      try {
        const response = await fetch("/api/production-control", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "Failed to load production control status.");
        setData(body as ProductionControlData);
        setError(null);
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      } finally {
        setLoading(false);
      }
    })();
    inFlightRef.current = run;
    try {
      await run;
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  const toggle = useCallback(
    async (action: "activate" | "deactivate") => {
      setToggling(true);
      try {
        const response = await fetch("/api/production-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? `Failed to ${action} production.`);
        await refresh();
        return { ok: true as const };
      } catch (toggleError) {
        const message = toggleError instanceof Error ? toggleError.message : String(toggleError);
        setError(message);
        return { ok: false as const, error: message };
      } finally {
        setToggling(false);
      }
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function schedule() {
      timerRef.current = window.setTimeout(() => {
        void refresh().then(schedule);
      }, POLL_MS);
    }
    schedule();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [refresh]);

  return { data, error, loading, toggling, toggle, refresh };
}
