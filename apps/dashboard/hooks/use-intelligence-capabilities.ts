"use client";

import { useCallback, useEffect, useState } from "react";
import type { IntelligenceCapabilitiesResponse } from "../lib/intelligence-types";

export function useIntelligenceCapabilities() {
  const [data, setData] = useState<IntelligenceCapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin-intelligence/capabilities", { cache: "no-store" });
      const body = (await response.json()) as IntelligenceCapabilitiesResponse;
      setData(body);
      setError(body.reachable ? null : body.error ?? "Arcadia Intelligence is unreachable.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
