"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardPullRequestDetails } from "../lib/types";
import { MarkdownBody } from "./markdown-body";
import { fetchJsonBounded } from "./pull-request-audio";

export function PullRequestDetailsPanel({ repository, number }: { repository: string; number: number }) {
  const [details, setDetails] = useState<DashboardPullRequestDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    if (loading) return;
    setOpen(true); setLoading(true); setError(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const body = await fetchJsonBounded(`/api/pull-requests/details?repository=${encodeURIComponent(repository)}&number=${number}`, { cache: "no-store", signal: abort.signal }, 65_000);
      if (!abort.signal.aborted) { setDetails(body as unknown as DashboardPullRequestDetails); setCheckedAt(new Date()); }
    } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  }
  return <div className="mt-3 min-w-0">
    <button type="button" aria-expanded={open} disabled={loading} onClick={() => {
      if (!details) void load(); else setOpen(value => !value);
    }} className="min-h-11 rounded-md border border-line px-3 py-2 text-sm font-semibold">{loading ? "Loading PR details" : open && details ? "Hide PR details" : "Load PR details"}</button>
    {error ? <p role="alert" className="mt-2 text-sm text-clay">{error}</p> : null}
    {open && details ? <section aria-label="PR details" className="mt-3 rounded-md border border-line p-3">
      <p className="text-xs text-muted">Details checked {checkedAt?.toLocaleTimeString() ?? "earlier"}{loading ? " · Refreshing" : ""}</p>
      <p className="text-sm">{details.headBranch} → {details.baseBranch} · Review: {details.reviewDecision ?? "Not requested"} · Merge state: {details.mergeStateStatus ?? "Unknown"}</p>
      <a className="mt-2 inline-block text-sm font-semibold text-steel" href={`${details.url}/checks`} target="_blank" rel="noreferrer">Open CI and QA evidence on GitHub</a>
      <MarkdownBody text={details.body} />
      <details className="mt-3 text-xs"><summary>Changed paths ({details.files.length})</summary><ul className="mt-2 grid gap-1 break-all">{details.files.map(file => <li key={file}>{file}</li>)}</ul></details>
      <p className="mt-3 text-xs text-muted">Open GitHub for the full PR discussion and review evidence.</p>
      <button type="button" onClick={() => void load()} className="mt-2 min-h-11 text-sm font-semibold text-steel">Refresh PR details</button>
    </section> : null}
  </div>;
}
