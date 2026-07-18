"use client";

import { useCallback, useEffect, useState } from "react";
import type { IntelligenceUsageSummary } from "../lib/intelligence-types";

export function useIntelligenceUsage() {
  const [summary, setSummary] = useState<IntelligenceUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin-intelligence/usage", { cache: "no-store" });
      const body = (await response.json()) as { summary?: IntelligenceUsageSummary; error?: string };
      if (!response.ok || !body.summary) {
        throw new Error(body.error ?? "Failed to load Intelligence usage.");
      }
      setSummary(body.summary);
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

  return { summary, loading, error, refresh };
}
