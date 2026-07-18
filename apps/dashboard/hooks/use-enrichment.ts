"use client";

import { useEffect, useRef, useState } from "react";
import type { EnrichmentKind } from "../lib/enrichment/registry";
import type { EnrichmentResponse, EnrichmentStatus } from "../lib/enrichment/types";

/**
 * Client hook for the generalized async-enrichment layer. Given an enrichment
 * `kind` and the source `text`, it requests an enrichment from /api/enrich and
 * polls while the job is pending. It never throws into the render tree: any
 * failure resolves to "unavailable" so the deterministic UI it decorates keeps
 * working untouched.
 *
 * Results are memoized in a module-level cache keyed by kind + content, so the
 * same content rendered across multiple cards (or re-renders) issues at most
 * one request.
 */
export interface UseEnrichmentResult {
  status: "idle" | EnrichmentStatus;
  value: string | null;
}

// Local generation (Codex CLI) can take 20–40s. The job completes server-side
// regardless and is cached by idempotency key, so a later view returns it
// instantly — this budget only governs how long a single mount polls live.
const MAX_POLL_ATTEMPTS = 16;
const POLL_INTERVAL_MS = 3_000;

type TerminalStatus = Exclude<EnrichmentStatus, "pending">;

const cache = new Map<string, { status: TerminalStatus; value: string | null }>();

function cacheKey(kind: EnrichmentKind, text: string): string {
  // Small non-cryptographic hash — this key only dedupes client requests; the
  // server dedupes authoritatively by content hash.
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return `${kind}:${(hash >>> 0).toString(36)}:${text.length}`;
}

export function useEnrichment(
  kind: EnrichmentKind,
  text: string,
  options: { enabled?: boolean } = {},
): UseEnrichmentResult {
  const enabled = options.enabled ?? true;
  const [result, setResult] = useState<UseEnrichmentResult>({ status: "idle", value: null });
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || text.trim().length === 0) {
      setResult({ status: "idle", value: null });
      return;
    }

    const key = cacheKey(kind, text);
    activeKeyRef.current = key;

    const cached = cache.get(key);
    if (cached) {
      setResult({ status: cached.status, value: cached.value });
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (status: TerminalStatus, value: string | null) => {
      cache.set(key, { status, value });
      if (!cancelled && activeKeyRef.current === key) {
        setResult({ status, value });
      }
    };

    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, text }),
        });
        const body = (await response.json()) as EnrichmentResponse;

        if (cancelled) return;

        if (body.status === "pending") {
          if (attempts >= MAX_POLL_ATTEMPTS) {
            // Give up quietly; content stays deterministic. Not cached, so a
            // later view can retry.
            if (activeKeyRef.current === key) setResult({ status: "unavailable", value: null });
            return;
          }
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
          return;
        }

        if (body.status === "ready") {
          finish("ready", body.value ?? null);
          return;
        }

        finish(body.status, null);
      } catch {
        if (!cancelled && activeKeyRef.current === key) {
          setResult({ status: "unavailable", value: null });
        }
      }
    };

    setResult({ status: "pending", value: null });
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [kind, text, enabled]);

  return result;
}
