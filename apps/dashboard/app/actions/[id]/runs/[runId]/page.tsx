"use client";

import { AlertTriangle, CheckCircle2, Loader2, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardChrome } from "../../../../../components/chrome";

type RunStatus = "running" | "succeeded" | "failed";
interface Run {
  runId: string;
  scriptId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  message?: string;
  runDirectory: string;
  descriptor: { title: string; problem: string; desiredEffect: string; authority: { does: string[]; never_does: string[] }; success: { effect: string; next: string }; failure: { effect: string; next: string } };
}
interface RunResponse { script: { id: string; title: string; problem: string; desiredEffect: string; authority: Run["descriptor"]["authority"]; success: Run["descriptor"]["success"]; failure: Run["descriptor"]["failure"] }; run: Run; output: { stdout: string; stderr: string }; error?: string }

export default function OperatorActionRunPage() {
  const params = useParams<{ id: string; runId: string }>();
  const id = params.id;
  const runId = params.runId;
  const [data, setData] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!id || !runId) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/operator-script/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      const body = await response.json() as RunResponse;
      if (!response.ok) throw new Error(body.error ?? "The operator-script result is unavailable.");
      setData(body);
      setError(null);
      setLoadedAt(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
      refreshInFlight.current = false;
    }
  }, [id, runId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (data?.run.status !== "running") return;
    const interval = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(interval);
  }, [data?.run.status, refresh]);

  return (
    <DashboardChrome title={data?.script.title ?? "Operator action result"} subtitle={data?.run.status === "running" ? "Running — this page stays with the result." : "Run result"} refreshing={refreshing} lastLoadedAt={loadedAt} onRefresh={() => void refresh()}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link href="/actions" className="text-sm font-semibold text-steel hover:underline">← All operator actions</Link>
        {data ? <StatusPill status={data.run.status} /> : null}
      </div>
      {loading ? <ResultSkeleton /> : error ? <div className="rounded-md border border-clay/30 bg-clay/5 p-4 text-sm text-clay" role="alert">{error}</div> : data ? <ResultView data={data} /> : null}
    </DashboardChrome>
  );
}

function ResultView({ data }: { data: RunResponse }) {
  const { run, script, output } = data;
  const outcome = run.status === "succeeded" ? script.success : script.failure;
  return (
    <div className="grid gap-4">
      <section className={`rounded-md border p-5 shadow-soft ${run.status === "succeeded" ? "border-moss/40 bg-moss/5" : run.status === "failed" ? "border-clay/40 bg-clay/5" : "border-steel/40 bg-steel/5"}`} aria-live="polite">
        <div className="flex items-start gap-3">
          <StatusIcon status={run.status} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{run.status === "running" ? "Action is running" : run.status === "succeeded" ? "Action completed" : "Action failed"}</h2>
            <p className="mt-1 text-sm text-muted">{run.message ?? (run.status === "running" ? "The result will update here until the host records a terminal state." : outcome.effect)}</p>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs uppercase tracking-wide text-muted">Started</dt><dd className="mt-1">{formatDate(run.startedAt)}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-muted">Finished</dt><dd className="mt-1">{run.finishedAt ? formatDate(run.finishedAt) : "In progress"}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-muted">Exit code</dt><dd className="mt-1">{run.exitCode ?? (run.status === "running" ? "—" : "Unavailable")}</dd></div>
        </dl>
        <div className="mt-5 rounded-md border border-line/70 bg-panel/60 p-3 text-sm"><span className="font-semibold">Next:</span> {outcome.next}</div>
      </section>

      <section className="rounded-md border border-line bg-panel p-5">
        <div className="flex items-center gap-2"><TerminalSquare className="h-5 w-5 text-steel" aria-hidden="true" /><h2 className="font-semibold">Execution output</h2></div>
        <OutputBlock label="Standard output" value={output.stdout} />
        <OutputBlock label="Error output" value={output.stderr} error />
      </section>

      <section className="rounded-md border border-line bg-panel p-5">
        <h2 className="font-semibold">Bound action</h2>
        <p className="mt-2 text-sm text-muted">{script.desiredEffect}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <AuthorityList title="This run can" items={script.authority.does} tone="text-moss" />
          <AuthorityList title="This run never can" items={script.authority.never_does} tone="text-clay" />
        </div>
        <p className="mt-4 break-all text-xs text-muted">Run {run.runId} · {run.runDirectory}</p>
      </section>
    </div>
  );
}

function OutputBlock({ label, value, error = false }: { label: string; value: string; error?: boolean }) { return <div className="mt-4"><h3 className={`text-xs font-semibold uppercase tracking-wide ${error ? "text-clay" : "text-muted"}`}>{label}</h3><pre className="mt-2 max-h-96 min-h-16 overflow-auto rounded-md bg-ink p-3 text-xs leading-5 text-white">{value || "(no output)"}</pre></div>; }
function AuthorityList({ title, items, tone }: { title: string; items: string[]; tone: string }) { return <div><h3 className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>; }
function StatusPill({ status }: { status: RunStatus }) { const config = { running: ["Running", "bg-steel/10 text-steel", Loader2], succeeded: ["Completed", "bg-moss/10 text-moss", CheckCircle2], failed: ["Failed", "bg-clay/10 text-clay", AlertTriangle] }[status] as [string, string, typeof Loader2]; const Icon = config[2]; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${config[1]}`}><Icon className={`h-3.5 w-3.5 ${status === "running" ? "animate-spin" : ""}`} aria-hidden="true" />{config[0]}</span>; }
function StatusIcon({ status }: { status: RunStatus }) { const Icon = status === "running" ? Loader2 : status === "succeeded" ? CheckCircle2 : AlertTriangle; return <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${status === "running" ? "animate-spin text-steel" : status === "succeeded" ? "text-moss" : "text-clay"}`} aria-hidden="true" />; }
function ResultSkeleton() { return <div className="grid gap-4" aria-hidden="true"><div className="h-56 animate-pulse rounded-md border border-line bg-panel" /><div className="h-80 animate-pulse rounded-md border border-line bg-panel" /></div>; }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)); }
