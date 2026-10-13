"use client";

import { useCallback, useEffect, useState } from "react";
import type { NextStepsResponse } from "../lib/next-steps-server";

const POLL_MS = 30_000;

/** Reads the ordered operator next steps (GET only). A failed read keeps the last good list and says so. */
export function useNextSteps() {
  const [data, setData] = useState<NextStepsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/next-steps", { cache: "no-store" });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setData((await response.json()) as NextStepsResponse);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { data, failed };
}
