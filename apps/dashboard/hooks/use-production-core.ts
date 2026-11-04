"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConsoleCoreData } from "../lib/production-console";

const POLL_MS = 60_000;

/** Reads production's state, worker and Sessions (GET only). A hidden tab doesn't poll. A failed read says so. */
export function useProductionCore() {
  const [data, setData] = useState<ConsoleCoreData | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/production-console?part=core", { cache: "no-store" });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setData((await response.json()) as ConsoleCoreData);
      setFailed(false);
    } catch {
      setFailed(true);
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
