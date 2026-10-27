"use client";

import { useEffect, useState } from "react";

export type ReadState<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: T };
export function useRead<T>(url: string | null, revision: number): ReadState<T> {
  const [result, setResult] = useState<{ url: string; revision: number; state: ReadState<T> } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json() as T & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error ?? "Arcadia could not read this context.");
      setResult({ url, revision, state: { kind: "ready", data: body } });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ url, revision, state: { kind: "error", message: error instanceof Error ? error.message : String(error) } });
    });
    return () => controller.abort();
  }, [url, revision]);
  return result?.url === url && result.revision === revision ? result.state : { kind: "loading" };
}
