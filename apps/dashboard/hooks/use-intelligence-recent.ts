"use client";

import { useCallback, useEffect, useState } from "react";
import type { IntelligenceJob } from "@pmark/arcadia/intelligence/contracts";

export function useIntelligenceRecent() {
  const [jobs, setJobs] = useState<IntelligenceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin-intelligence/recent", { cache: "no-store" });
      const body = (await response.json()) as { jobs?: IntelligenceJob[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to load recent jobs.");
      }
      setJobs(body.jobs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { jobs, loading, error, refresh };
}
