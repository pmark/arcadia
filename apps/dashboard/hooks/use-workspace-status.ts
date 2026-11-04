"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceStatus } from "../lib/workspace-status";

const POLL_MS = 30_000;
/** While the sky is waiting for a first answer, ask more often. The read is small and answers at once. */
const SETTLING_POLL_MS = 3_000;
const TIMEOUT_MS = 20_000;

/** Reads the small workspace status (GET only). A hidden tab doesn't poll, and coming back asks straight away. */
export function useWorkspaceStatus(settling: boolean) {
  const [data, setData] = useState<WorkspaceStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  // Only the newest request counts, so a slow older answer can't overwrite a newer one.
  const refresh = useCallback(async () => {
    const requested = ++latest.current;
    try {
      const response = await fetch("/api/workspace/status", { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = response.ok ? (await response.json()) as WorkspaceStatus : null;
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
    document.addEventListener("visibilitychange", poll);
    return () => document.removeEventListener("visibilitychange", poll);
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, settling ? SETTLING_POLL_MS : POLL_MS);
    return () => clearInterval(interval);
  }, [refresh, settling]);

  return { data, failed };
}
