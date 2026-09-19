"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CapacityStatusResponse,
  DispatchJournalEvent,
  ProductionStatusResponse,
  ScheduleProjectSummary
} from "../lib/arcadia-cli";

export interface ProductionCoreData {
  production: ProductionStatusResponse;
  worker: { running: boolean; heartbeat: { timestamp: string | null; fresh: boolean; available: boolean } };
}

export interface ProductionQueueData {
  schedule: { projects: ScheduleProjectSummary[]; selection: string | null } | null;
}

export interface ProductionAlertsData {
  capacity: CapacityStatusResponse | null;
  alerts: {
    capacityRefusals: Array<{ providerId: string; label: string; reason: string }>;
    blockedDispatches: DispatchJournalEvent[];
  };
}

type Part = "core" | "queue" | "alerts";

const POLL_MS = 20_000;

/**
 * Three independent requests: the fast core (switch, worker, provider) paints
 * without waiting on the queue or alert calls, and a failure in one part never
 * blanks the others.
 */
export function useProductionControl() {
  const [core, setCore] = useState<ProductionCoreData | null>(null);
  const [queue, setQueue] = useState<ProductionQueueData | null>(null);
  const [alerts, setAlerts] = useState<ProductionAlertsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partErrors, setPartErrors] = useState<{ queue: string | null; alerts: string | null }>({ queue: null, alerts: null });
  const [toggling, setToggling] = useState(false);
  const sequences = useRef<Record<Part, number>>({ core: 0, queue: 0, alerts: 0 });
  const inFlight = useRef<Record<Part, Promise<void> | null>>({ core: null, queue: null, alerts: null });
  const timerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  // `force` skips joining an in-flight GET: after a toggle, that GET may carry
  // the pre-toggle state. The sequence check makes any superseded response a no-op.
  const load = useCallback(async (part: Part, force = false): Promise<void> => {
    const existing = inFlight.current[part];
    if (!force && existing) return existing;
    const sequence = ++sequences.current[part];
    const run = (async () => {
      try {
        const response = await fetch(`/api/production-control?part=${part}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? `Failed to load production ${part}.`);
        if (sequence !== sequences.current[part]) return;
        // A body that is not this part's shape (a stale route during a dev
        // reload, say) is dropped rather than handed to the panel.
        if (part === "core") {
          if (!body?.production?.read || !body?.worker) throw new Error("Malformed production status.");
          setCore(body as ProductionCoreData);
        } else if (part === "queue") {
          if (!body || !("schedule" in body)) throw new Error("Malformed production queue.");
          setQueue(body as ProductionQueueData);
        } else {
          if (!body?.alerts?.capacityRefusals || !body.alerts.blockedDispatches) throw new Error("Malformed production alerts.");
          setAlerts(body as ProductionAlertsData);
        }
        if (part === "core") setError(null);
        else setPartErrors((current) => ({ ...current, [part]: null }));
      } catch (loadError) {
        if (sequence !== sequences.current[part]) return;
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        if (part === "core") setError(message);
        else setPartErrors((current) => ({ ...current, [part]: message }));
      }
    })();
    inFlight.current[part] = run;
    try {
      await run;
    } finally {
      if (inFlight.current[part] === run) inFlight.current[part] = null;
    }
  }, []);

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      await Promise.all([load("core", force), load("queue", force), load("alerts", force)]);
    },
    [load]
  );

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
        await refresh(true);
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
    disposedRef.current = false;
    function schedule() {
      if (disposedRef.current) return;
      timerRef.current = window.setTimeout(() => {
        void refresh().then(() => {
          if (!disposedRef.current) schedule();
        });
      }, POLL_MS);
    }
    schedule();
    return () => {
      disposedRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [refresh]);

  return { core, queue, alerts, error, queueError: partErrors.queue, alertsError: partErrors.alerts, toggling, toggle, refresh };
}
