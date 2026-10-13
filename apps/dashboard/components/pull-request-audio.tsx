"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntelligenceJob } from "@pmark/arcadia/intelligence/contracts";
import type { PullRequestSource, PullRequestSummary } from "../lib/pull-request-summary";
import { ReadAloud } from "./read-aloud";
import { MarkdownBody } from "./markdown-body";

type SummaryResponse = {
  source: PullRequestSource;
  sourceRevision: string;
  job: IntelligenceJob | null;
  summary: PullRequestSummary | null;
};

export function PullRequestAudio({ repository, number, showDescription = false }: { repository: string; number: number; showDescription?: boolean }) {
  const [result, setResult] = useState<SummaryResponse | null>(null);
  const [stage, setStage] = useState<"idle" | "loading_source" | "ready" | "queued" | "generating" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (stage === "idle" || stage === "ready" || stage === "failed") return;
    const tick = () => setElapsed(startedAt.current === null ? 0 : Math.floor((Date.now() - startedAt.current) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const poll = useCallback(async (initial: SummaryResponse, abort: AbortController) => {
    let job = initial.job;
    while (job && (job.status === "queued" || job.status === "running")) {
      setStage(job.status === "queued" ? "queued" : "generating");
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await fetch(`/api/admin-intelligence/jobs/${encodeURIComponent(job.id)}`, { cache: "no-store", signal: abort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not check TLDR generation.");
      job = body.job;
    }
    if (!job) { setStage("ready"); return; }
    if (job.status !== "completed") throw new Error(job.error?.message ?? "TLDR generation did not complete.");
    const text = (job.result as { summary?: unknown } | null)?.summary;
    if (typeof text !== "string" || !text.trim() || text.length > 1200) throw new Error("TLDR generation returned an invalid summary.");
    setResult({ ...initial, job, summary: { text: text.trim(), sourceRevision: initial.sourceRevision, jobId: job.id, generatedAt: job.completedAt ?? job.startedAt ?? job.createdAt } });
    setStage("ready");
  }, []);

  const request = useCallback(async (method: "GET" | "POST") => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    startedAt.current = Date.now(); setElapsed(0); setError(null); setStage("loading_source");
    try {
      const endpoint = `/api/pull-requests/summary${method === "GET" ? `?repository=${encodeURIComponent(repository)}&number=${number}` : ""}`;
      const response = await fetch(endpoint, method === "GET"
        ? { cache: "no-store", signal: abort.signal }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository, number }), signal: abort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the TLDR.");
      const next = body as SummaryResponse;
      setResult(next);
      if (next.summary) setStage("ready");
      else await poll(next, abort);
    } catch (failure) {
      if (!abort.signal.aborted) { setStage("failed"); setError(failure instanceof Error ? failure.message : String(failure)); }
    }
  }, [number, poll, repository]);

  useEffect(() => { if (showDescription) void request("GET"); }, [request, showDescription]);

  const statusText = {
    idle: null,
    loading_source: "Loading PR source",
    ready: result?.summary ? "TLDR ready" : "TLDR not generated",
    queued: "TLDR queued",
    generating: "Generating TLDR",
    failed: "TLDR failed",
  }[stage];
  const busy = stage === "loading_source" || stage === "queued" || stage === "generating";
  const retryExhausted = Boolean(result?.job
    && (result.job.status === "failed" || result.job.status === "blocked")
    && result.job.retryCount >= result.job.request.executionPolicy.maxRetries);

  return (
    <div className="mt-3 min-w-0">
      {stage === "idle" ? <button type="button" onClick={() => void request("GET")} className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel">Load TLDR</button> : null}
      {stage === "failed" && !result ? <button type="button" onClick={() => void request("GET")} className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel">Retry source</button> : null}
      {result && !result.summary && !busy ? <button type="button" onClick={() => void request("POST")} disabled={retryExhausted} className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel disabled:opacity-60">{retryExhausted ? "TLDR retry limit reached" : stage === "failed" || result.job ? "Retry TLDR" : "Generate TLDR"}</button> : null}
      {statusText ? <p role="status" className="mt-2 text-xs text-muted">{statusText} · {formatElapsed(elapsed)}{result?.job ? ` · Job ${result.job.id}` : ""}</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-clay">{error}</p> : null}
      {result?.summary ? <>
        <section aria-label="TLDR" className="mt-3 rounded-md border border-steel/20 bg-steel/5 p-3">
          <h4 className="font-semibold">TLDR</h4>
          <p className="mt-2 text-sm leading-6">{result.summary.text}</p>
          <p className="mt-2 text-xs text-muted">Generated from this PR title and description · {formatFreshness(result.summary.generatedAt)} · Source {result.summary.sourceRevision.slice(0, 8)}</p>
        </section>
        <ReadAloud endpoint="/api/pull-requests/audio" request={{ repository, number }} label="Play TLDR" filename={`${repository.replace("/", "-")}-pr-${number}-tldr.mp3`} />
      </> : null}
      {showDescription && result?.source ? <section aria-label="Pull request body" className="mt-4 min-w-0 rounded-md border border-line p-3"><h4 className="font-semibold">Pull request body</h4><MarkdownBody text={result.source.body} /><details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Source Markdown</summary><pre className="mt-2 whitespace-pre-wrap break-words">{result.source.body}</pre></details></section> : null}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function formatFreshness(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "generation time unknown" : `generated ${date.toLocaleString()}`;
}
