"use client";

import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { ErrorState } from "../../../components/dashboard-ui";

interface RunDetail {
  run: {
    id: string;
    status: string;
    summary: string;
    executor_name: string | null;
    review_item_id: string | null;
    work_item_title: string;
    project_name: string | null;
    created_at: string;
    updated_at: string;
    pid: number | null;
  };
  needsMark: string[];
  executorOutputPath: string | null;
  artifactRoot: string | null;
  workspace: string;
}

const ACTIVE_STATUSES = new Set(["pending_execution", "running"]);
const POLL_INTERVAL_ACTIVE = 3_000;
const POLL_INTERVAL_IDLE = 30_000;
const OUTPUT_POLL_INTERVAL = 4_000;
const OUTPUT_MAX_BYTES = 100_000;

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const outputRef = useRef<HTMLPreElement>(null);
  const startTimeRef = useRef<Date | null>(null);

  const fetchRun = useCallback(async () => {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Failed to load run.");
      }
      setDetail(body as RunDetail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  const fetchOutput = useCallback(async (outputPath: string) => {
    try {
      const encoded = outputPath.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`/api/file/${encoded}`, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 404) return;
        throw new Error("Output file unavailable.");
      }
      const text = await response.text();
      const excerpt = text.length > OUTPUT_MAX_BYTES ? text.slice(-OUTPUT_MAX_BYTES) : text;
      setOutputLines(excerpt.split("\n"));
      setOutputError(null);
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    } catch (err) {
      setOutputError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void fetchRun();
  }, [fetchRun]);

  useEffect(() => {
    if (!detail) return;
    const active = ACTIVE_STATUSES.has(detail.run.status);
    const interval = setInterval(() => void fetchRun(), active ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE);
    return () => clearInterval(interval);
  }, [detail, fetchRun]);

  useEffect(() => {
    if (!detail?.executorOutputPath) return;
    const path = detail.executorOutputPath;
    void fetchOutput(path);
    const interval = setInterval(() => void fetchOutput(path), OUTPUT_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [detail?.executorOutputPath, fetchOutput]);

  useEffect(() => {
    if (!detail) return;
    if (!ACTIVE_STATUSES.has(detail.run.status)) {
      setElapsedSeconds(0);
      startTimeRef.current = null;
      return;
    }
    if (!startTimeRef.current) {
      startTimeRef.current = new Date(detail.run.created_at);
    }
    const tick = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [detail]);

  useEffect(() => {
    if (outputRef.current && ACTIVE_STATUSES.has(detail?.run.status ?? "")) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines, detail?.run.status]);

  if (!detail && !error) {
    return <RunPageShell id={id}><LoadingPanel /></RunPageShell>;
  }

  if (error && !detail) {
    return <RunPageShell id={id}><ErrorState message={error} /></RunPageShell>;
  }

  const run = detail!.run;
  const active = ACTIVE_STATUSES.has(run.status);
  const statusColor = statusColorClass(run.status);

  return (
    <RunPageShell id={id}>
      <div className="grid gap-5">
        {error ? <ErrorState message={error} /> : null}

        <section className="min-w-0 rounded-md border border-line bg-panel p-4 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold leading-6">{run.work_item_title}</h2>
              <p className="mt-1 font-mono text-xs text-muted">{run.id}</p>
            </div>
            <div className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${statusColor}`}>
              {active ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : statusIcon(run.status)}
              {statusLabel(run.status)}
              {active && elapsedSeconds > 0 ? <span className="text-xs font-normal opacity-80">({formatElapsed(elapsedSeconds)})</span> : null}
            </div>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <RunField label="Executor" value={run.executor_name ?? "—"} />
            <RunField label="Project" value={run.project_name ?? "Unassigned"} />
            <RunField label="Started" value={formatDateTime(run.created_at)} />
            <RunField label="Updated" value={formatDateTime(run.updated_at)} />
            {run.summary ? <div className="sm:col-span-2"><RunField label="Summary" value={run.summary} /></div> : null}
          </dl>
          {detail?.executorOutputPath ? (
            <div className="mt-4">
              <a
                href={`/api/file/${detail.executorOutputPath.split("/").map(encodeURIComponent).join("/")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel transition hover:border-steel"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open full output
              </a>
            </div>
          ) : null}
        </section>

        {outputLines.length > 0 ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Executor Output</h2>
            <pre
              ref={outputRef}
              className="h-80 overflow-auto rounded-md border border-line bg-canvas p-4 font-mono text-xs leading-5 text-ink"
            >
              {outputLines.join("\n")}
            </pre>
            {outputError ? <p className="mt-2 text-xs text-clay">{outputError}</p> : null}
          </section>
        ) : active ? (
          <section className="rounded-md border border-line bg-panel px-4 py-8 text-center text-sm text-muted">
            {run.status === "pending_execution"
              ? "Waiting for worker to pick up this run…"
              : "Executor is running — output will appear when complete."}
          </section>
        ) : null}

        {detail?.needsMark.length ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Requires Mark</h2>
            <ul className="grid gap-2">
              {detail.needsMark.map((item, i) => (
                <li key={i} className="rounded-md border border-clay/30 bg-clay/10 p-3 text-sm text-clay">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </RunPageShell>
  );
}

function RunPageShell({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh w-full bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-moss">Arcadia</p>
            <h1 className="truncate text-xl font-semibold leading-7">Execution Run</h1>
            <p className="truncate font-mono text-xs text-muted">{id}</p>
          </div>
          <Link
            href="/runs"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-medium text-muted transition hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            All Runs
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-5 pb-20 sm:py-7">{children}</main>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="grid gap-3">
      <div className="h-40 animate-pulse rounded-md border border-line bg-panel" />
      <div className="h-64 animate-pulse rounded-md border border-line bg-panel" />
    </div>
  );
}

function RunField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 break-words leading-5">{value}</dd>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending_execution": return "Queued";
    case "running": return "Running";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "requires_review": return "Requires Review";
    case "needs_mark": return "Needs Mark";
    default: return status;
  }
}

function statusColorClass(status: string): string {
  if (status === "completed") return "border-moss/30 bg-moss/10 text-moss";
  if (status === "failed" || status === "requires_review") return "border-clay/30 bg-clay/10 text-clay";
  if (status === "running" || status === "pending_execution") return "border-gold/30 bg-gold/10 text-gold";
  return "border-line bg-canvas text-muted";
}

function statusIcon(status: string) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  if (status === "failed" || status === "requires_review") return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
  return <Clock3 className="h-4 w-4" aria-hidden="true" />;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
