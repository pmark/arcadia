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
  // How far the server's clock is ahead of this device's, so a read's age is judged on one clock.
  const [serverOffset, setServerOffset] = useState(0);
  const latest = useRef(0);
  const applied = useRef(0);

  // A newer answer always counts, even if a later request is still out, but an older answer never overwrites a newer one.
  const refresh = useCallback(async () => {
    const requested = ++latest.current;
    try {
      const response = await fetch("/api/workspace/status", { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = response.ok ? (await response.json()) as WorkspaceStatus : null;
      if (requested < applied.current) return;
      applied.current = requested;
      if (body) {
        setData(body);
        setServerOffset(Date.parse(body.generatedAt) - Date.now());
      }
      setFailed(!body);
    } catch {
      if (requested >= applied.current) {
        applied.current = requested;
        setFailed(true);
      }
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

  return { data, failed, serverOffset };
}
