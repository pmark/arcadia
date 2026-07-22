"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntelligenceUsageSummary } from "../lib/intelligence-types";

const USAGE_STALE_AFTER_MS = 60_000;
const USAGE_STALE_CHECK_INTERVAL_MS = 15_000;

export function useIntelligenceUsage() {
  const [summary, setSummary] = useState<IntelligenceUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshingRef = useRef(false);
  const generatedAtRef = useRef<string | null>(null);

  const refresh = useCallback(async (options: { force?: boolean } = {}) => {
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const usageUrl = options.force ? "/api/admin-intelligence/usage?refresh=1" : "/api/admin-intelligence/usage";
      const response = await fetch(usageUrl, { cache: "no-store" });
      const body = (await response.json()) as { summary?: IntelligenceUsageSummary; error?: string };
      if (!response.ok || !body.summary) {
        throw new Error(body.error ?? "Failed to load Intelligence usage.");
      }
      setSummary(body.summary);
      generatedAtRef.current = body.summary.generatedAt;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const generatedAt = generatedAtRef.current ? Date.parse(generatedAtRef.current) : Number.NaN;
      const stale = !Number.isFinite(generatedAt) || Date.now() - generatedAt >= USAGE_STALE_AFTER_MS;
      if (stale) void refresh();
    }, USAGE_STALE_CHECK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [refresh]);

  return { summary, loading, refreshing, error, refresh };
}
