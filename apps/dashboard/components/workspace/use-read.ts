"use client";

import { useEffect, useRef, useState } from "react";
import { clientReadCache } from "../../lib/client-read-cache";

export type ReadState<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: T };
export function useRead<T>(url: string | null, revision: number): ReadState<T> {
  const [result, setResult] = useState<{ url: string; revision: number; state: ReadState<T> } | null>(null);
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (!url) return;
    let active = true;
    // A revision bump is the Refresh button: bypass the cache. Mount and URL changes may use it.
    const force = seenRevision.current !== revision;
    seenRevision.current = revision;
    clientReadCache.load<T>(url, { force }).then(data => {
      if (active) setResult({ url, revision, state: { kind: "ready", data } });
    }).catch((error: unknown) => {
      // A failed background revalidation keeps the cached view; a first load or an explicit Refresh shows the error.
      if (active && (force || clientReadCache.peek(url) === undefined)) setResult({ url, revision, state: { kind: "error", message: error instanceof Error ? error.message : String(error) } });
    });
    return () => { active = false; };
  }, [url, revision]);
  if (result?.url === url && result.revision === revision) return result.state;
  const cached = url ? clientReadCache.peek<T>(url) : undefined;
  return cached !== undefined ? { kind: "ready", data: cached } : { kind: "loading" };
}
