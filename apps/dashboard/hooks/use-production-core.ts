"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleCoreData } from "../lib/production-console";

const POLL_MS = 60_000;
const TIMEOUT_MS = 30_000;

/** Reads production's state, worker and Sessions (GET only). A hidden tab doesn't poll. A failed read says so. */
export function useProductionCore() {
  const [data, setData] = useState<ConsoleCoreData | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  // Only the newest request counts, so a slow older answer can't overwrite a newer one.
  const refresh = useCallback(async () => {
    const requested = ++latest.current;
    try {
      const response = await fetch("/api/production-console?part=core", { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = response.ok ? (await response.json()) as ConsoleCoreData : null;
      if (requested !== latest.current) return;
      if (body) setData(body);
      setFailed(!body);
    } catch {
      if (requested === latest.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const interval = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  return { data, failed };
}
