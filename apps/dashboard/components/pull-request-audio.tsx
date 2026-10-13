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
type SummaryStage = "idle" | "loading_source" | "ready" | "queued" | "generating" | "observation_timeout" | "failed";
const SUMMARY_OBSERVATION_TIMEOUT_MS = 15 * 60_000;
const SUMMARY_FETCH_TIMEOUT_MS = 65_000;

export class SummaryObservationTimeoutError extends Error {
  public constructor(public readonly job: IntelligenceJob | null) {
    super(job ? `Stopped observing job ${job.id}; it remains ${job.status}. Reconnect to check the same durable job.` : "Stopped waiting for the PR source. Try loading it again.");
    this.name = "SummaryObservationTimeoutError";
  }
}

export function PullRequestAudio({ repository, number, showDescription = false }: { repository: string; number: number; showDescription?: boolean }) {
  const [result, setResult] = useState<SummaryResponse | null>(null);
  const [stage, setStage] = useState<SummaryStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);


  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (stage === "idle" || stage === "ready" || stage === "observation_timeout" || stage === "failed") return;
    const tick = () => setElapsed(startedAt.current === null ? 0 : Math.floor((Date.now() - startedAt.current) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const poll = useCallback(async (initial: SummaryResponse, abort: AbortController) => {
    const job = initial.job ? await observeSummaryJob(initial.job, {
      fetchJob: async (jobId, timeoutMs) => {
        const body = await fetchJsonBounded(`/api/admin-intelligence/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal: abort.signal }, timeoutMs);
        return body.job as IntelligenceJob;
      },
      onJob: current => setStage(current.status === "queued" ? "queued" : "generating"),
      signal: abort.signal,
    }) : null;
    abort.signal.throwIfAborted();
    if (!job) { setStage("ready"); return; }
    if (job.status !== "completed") {
      setResult({ ...initial, job });
      throw new Error(job.error?.message ?? "TLDR generation did not complete.");
    }
    const refreshedBody = await fetchJsonBounded(`/api/pull-requests/summary?repository=${encodeURIComponent(repository)}&number=${number}`, { cache: "no-store", signal: abort.signal }, SUMMARY_FETCH_TIMEOUT_MS);
    const refreshed = refreshedBody as SummaryResponse;
    setResult(refreshed);
    acceptRefreshedSummary(initial, refreshed);
    setStage("ready");
  }, [number, repository]);

  const request = useCallback(async (method: "GET" | "POST") => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    startedAt.current = Date.now(); setElapsed(0); setError(null); setStage("loading_source");
    try {
      const endpoint = `/api/pull-requests/summary${method === "GET" ? `?repository=${encodeURIComponent(repository)}&number=${number}` : ""}`;
      const fetchOptions: RequestInit = method === "GET"
        ? { cache: "no-store", signal: abort.signal }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository, number }), signal: abort.signal };
      const body = await fetchJsonBounded(endpoint, fetchOptions, SUMMARY_FETCH_TIMEOUT_MS);
      const next = body as SummaryResponse;
      setResult(next);
      if (next.summary) setStage("ready");
      else await poll(next, abort);
    } catch (failure) {
      if (!abort.signal.aborted) {
        if (failure instanceof SummaryObservationTimeoutError) {
          if (failure.job) setResult(current => current ? { ...current, job: failure.job } : current);
          setStage("observation_timeout"); setError(failure.message);
        } else { setStage("failed"); setError(failure instanceof Error ? failure.message : String(failure)); }
      }
    }
  }, [number, poll, repository]);

  useEffect(() => { if (showDescription) void request("GET"); }, [request, showDescription]);

  const statusText = {
    idle: null,
    loading_source: "Loading PR source",
    ready: result?.summary ? "TLDR ready" : "TLDR not generated",
    queued: "TLDR queued",
    generating: "Generating TLDR",
    observation_timeout: result?.job ? "TLDR observation paused" : "Source observation paused",
    failed: "TLDR failed",
  }[stage];
  const busy = stage === "loading_source" || stage === "queued" || stage === "generating";
  const retryExhausted = Boolean(result?.job
    && (result.job.status === "failed" || result.job.status === "blocked")
    && result.job.retryCount >= result.job.request.executionPolicy.maxRetries);

  return (
    <div className="mt-3 min-w-0">
      {stage === "idle" ? <button type="button" onClick={() => void request("GET")} className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel">Load TLDR / Listen</button> : null}
      {!result?.summary && busy ? <button type="button" disabled className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel disabled:opacity-60">Generate TLDR · Fast Text Cloud</button> : null}

      {stage === "ready" && result?.summary ? <button type="button" onClick={() => void request("GET")} className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel">Refresh TLDR</button> : null}
      {stage === "failed" && !result ? <button type="button" onClick={() => void request("GET")} className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel">Retry source</button> : null}
      {stage === "observation_timeout" && !result ? <button type="button" onClick={() => void request("GET")} className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel">Retry source</button> : null}
      {result && !result.summary && !busy ? <button type="button" onClick={() => void request(summaryActionForStage(stage))} disabled={retryExhausted} className="min-h-11 rounded-md border border-steel/30 px-3 py-2 text-sm font-semibold text-steel disabled:opacity-60">{retryExhausted ? "TLDR retry limit reached" : stage === "observation_timeout" ? "Reconnect TLDR" : stage === "failed" || result.job ? "Retry TLDR · Fast Text Cloud" : "Generate TLDR · Fast Text Cloud"}</button> : null}
      {result && !result.summary ? <p className="mt-2 text-xs text-muted">Generate TLDR uses Fast Text Cloud and may incur charges. Loading an existing TLDR does not generate a new one.</p> : null}
      {statusText ? <p role="status" className="mt-2 text-xs text-muted">{statusText} · {formatElapsed(elapsed)}{result?.job ? ` · Job ${result.job.id}` : ""}</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-clay">{error}</p> : null}
      {result?.summary ? <>
        <section aria-label="TLDR" className="mt-3 rounded-md border border-steel/20 bg-steel/5 p-3">
          <h4 className="font-semibold">TLDR</h4>
          <p className="mt-2 text-sm leading-6">{result.summary.text}</p>
          <p className="mt-2 text-xs text-muted">Generated from this PR title and description · {formatFreshness(result.summary.generatedAt)} · Source {result.summary.sourceRevision.slice(0, 8)}</p>
        </section>
        <ReadAloud endpoint="/api/pull-requests/audio" request={{ repository, number, sourceRevision: result.summary.sourceRevision, summaryJobId: result.summary.jobId }} label="Play TLDR" filename={`${repository.replace("/", "-")}-pr-${number}-tldr.mp3`} />
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

export function acceptRefreshedSummary(initial: SummaryResponse, refreshed: SummaryResponse): SummaryResponse {
  if (refreshed.sourceRevision !== initial.sourceRevision) {
    throw new Error("The PR source changed while its TLDR was generating. Load the current source before generating again.");
  }
  if (!refreshed.summary) throw new Error("TLDR generation completed without a valid summary.");
  return refreshed;
}

export function summaryActionForStage(stage: SummaryStage): "GET" | "POST" {
  return stage === "observation_timeout" ? "GET" : "POST";
}

export async function observeSummaryJob(job: IntelligenceJob, options: {
  fetchJob: (jobId: string, timeoutMs: number) => Promise<IntelligenceJob>;
  onJob?: (job: IntelligenceJob) => void;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}): Promise<IntelligenceJob> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (milliseconds => abortableSleep(milliseconds, options.signal));
  const deadline = now() + (options.timeoutMs ?? SUMMARY_OBSERVATION_TIMEOUT_MS);
  let current = job;
  while (current.status === "queued" || current.status === "running") {
    options.signal?.throwIfAborted();
    options.onJob?.(current);
    const remaining = deadline - now();
    if (remaining <= 0) throw new SummaryObservationTimeoutError(current);
    await sleep(Math.min(options.pollIntervalMs ?? 1000, remaining));
    options.signal?.throwIfAborted();
    const afterSleep = deadline - now();
    if (afterSleep <= 0) throw new SummaryObservationTimeoutError(current);
    try {
      current = await promiseWithObservationDeadline(options.fetchJob(current.id, Math.min(SUMMARY_FETCH_TIMEOUT_MS, afterSleep)), afterSleep, current);
      options.signal?.throwIfAborted();
    } catch (error) {
      if (error instanceof SummaryObservationTimeoutError) throw new SummaryObservationTimeoutError(current);
      throw error;
    }
  }
  return current;
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() { signal?.removeEventListener("abort", abort); resolve(); }
    function abort() {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function promiseWithObservationDeadline<T>(promise: Promise<T>, timeoutMs: number, job: IntelligenceJob): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new SummaryObservationTimeoutError(job)), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function fetchJsonBounded(url: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const parentSignal = init.signal;
  parentSignal?.throwIfAborted();
  const controller = new AbortController();
  const relay = () => controller.abort();
  parentSignal?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The TLDR request failed.");
    return body;
  } catch (error) {
    if (!parentSignal?.aborted && controller.signal.aborted) throw new SummaryObservationTimeoutError(null);
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", relay);
  }
}
