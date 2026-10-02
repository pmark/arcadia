"use client";

import { AlertTriangle, CheckCircle2, Clock3, Loader2, Play, Search, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardChrome } from "../../components/chrome";

type ScriptStatus = "available" | "running" | "succeeded" | "failed";

interface OperatorScript {
  id: string;
  kind?: "grant";
  title: string;
  problem: string;
  desiredEffect: string;
  authority: { does: string[]; never_does: string[] };
  repeatable: boolean;
  receipt?: { reason: string; message: string; next: string; runDirectory: string; settlement?: unknown } | null;
  state: { status: ScriptStatus; startedAt?: string; finishedAt?: string; exitCode?: number | null; message?: string; runId?: string };
  modifiedAt: string;
}

export default function OperatorActionsPage() {
  const [scripts, setScripts] = useState<OperatorScript[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setRefreshing(true);
    try {
      const response = await fetch("/api/operator-script", { cache: "no-store" });
      const body = await response.json() as { scripts?: OperatorScript[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Operator actions are unavailable.");
      if (sequence !== refreshSequence.current) return;
      setScripts(body.scripts ?? []);
      setError(null);
      setLoadedAt(new Date());
    } catch (cause) {
      if (sequence === refreshSequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === refreshSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const visibleScripts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return scripts
      .filter((script) => !normalized || [script.id, script.title, script.problem, script.desiredEffect].some((value) => value.toLowerCase().includes(normalized)))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }, [query, scripts]);

  async function launch(script: OperatorScript) {
    setLaunching(script.id);
    setError(null);
    try {
      const response = await fetch("/api/operator-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: script.id })
      });
      const body = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !body.runId) throw new Error(body.error ?? "The operator action could not be started.");
      window.location.assign(`/actions/${encodeURIComponent(script.id)}/runs/${encodeURIComponent(body.runId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLaunching(null);
    }
  }

  return (
    <DashboardChrome
      title="Operator actions"
      subtitle="Run the bounded scripts you need right now."
      refreshing={refreshing}
      lastLoadedAt={loadedAt}
      onRefresh={() => void refresh()}
    >
      <section aria-label="Operator script library">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted">Sorted by script modification time.</p>
            <p className="mt-1 text-xs text-muted">{visibleScripts.length} action{visibleScripts.length === 1 ? "" : "s"}</p>
          </div>
          <label className="relative block sm:w-80">
            <span className="sr-only">Search operator actions</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search actions"
              className="min-h-11 w-full rounded-md border border-line bg-panel pl-9 pr-3 text-sm outline-none ring-moss/30 placeholder:text-muted focus:ring-2"
            />
          </label>
        </div>

        {error ? <p className="mb-4 rounded-md border border-clay/30 bg-clay/5 p-3 text-sm text-clay" role="alert">{error}</p> : null}
        {loading ? <ActionSkeletons /> : visibleScripts.length === 0 ? <EmptyActions query={query} /> : (
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            {visibleScripts.map((script) => (
              <OperatorActionCard key={script.id} script={script} launching={launching === script.id} onLaunch={() => void launch(script)} />
            ))}
          </div>
        )}
      </section>
    </DashboardChrome>
  );
}

function OperatorActionCard({ script, launching, onLaunch }: { script: OperatorScript; launching: boolean; onLaunch: () => void }) {
  const terminal = script.state.status === "succeeded" || script.state.status === "failed";
  const canRun = script.state.status !== "running" && !(script.state.status === "succeeded" && !script.repeatable);
  return (
    <article className="rounded-md border border-line bg-panel p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{script.title}</h2>
            {script.kind === "grant" ? <span className="rounded-full bg-gold/10 px-2 py-1 text-xs font-semibold text-gold">Grant</span> : null}
          </div>
          <p className="mt-1 break-all text-xs text-muted">{script.id}</p>
        </div>
        <StatusPill status={script.state.status} />
      </div>

      <p className="mt-4 text-sm text-muted">{script.desiredEffect}</p>
      <details className="mt-4 rounded-md border border-line/70 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-semibold">What this action does</summary>
        <p className="mt-3 text-muted">{script.problem}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <AuthorityList title="Does" items={script.authority.does} tone="text-moss" />
          <AuthorityList title="Never does" items={script.authority.never_does} tone="text-clay" />
        </div>
      </details>

      {script.state.message ? <p className={`mt-3 text-sm ${script.state.status === "failed" ? "text-clay" : "text-muted"}`}>{script.state.message}</p> : null}
      {script.receipt ? <div className="mt-3 text-sm"><p>{script.receipt.message}</p><p className="mt-1 text-muted">Next: {script.receipt.next}</p><details className="mt-2"><summary className="cursor-pointer font-semibold">Receipt: {script.receipt.reason}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(script.receipt, null, 2)}</pre></details></div> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canRun ? (
          <button type="button" onClick={onLaunch} disabled={launching} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-steel px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">
            {launching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {launching ? "Starting…" : script.state.status === "failed" ? "Retry" : "Run"}
          </button>
        ) : null}
        {script.state.runId ? (
          <Link href={`/actions/${encodeURIComponent(script.id)}/runs/${encodeURIComponent(script.state.runId)}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm font-semibold hover:border-steel hover:text-steel">
            <TerminalSquare className="h-4 w-4" aria-hidden="true" />
            {script.state.status === "running" ? "View live result" : "View result"}
          </Link>
        ) : terminal ? <span className="text-xs text-muted">Legacy result; no live run page is available.</span> : null}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted" title={`Modified ${new Date(script.modifiedAt).toLocaleString()}`}>
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          {formatRelativeDate(script.modifiedAt)}
        </span>
      </div>
    </article>
  );
}

function AuthorityList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return <div><p className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function StatusPill({ status }: { status: ScriptStatus }) {
  const config = {
    available: ["Ready", "bg-line text-muted", TerminalSquare],
    running: ["Running", "bg-steel/10 text-steel", Loader2],
    succeeded: ["Completed", "bg-moss/10 text-moss", CheckCircle2],
    failed: ["Failed", "bg-clay/10 text-clay", AlertTriangle]
  }[status] as [string, string, typeof TerminalSquare];
  const Icon = config[2];
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${config[1]}`}><Icon className={`h-3.5 w-3.5 ${status === "running" ? "animate-spin" : ""}`} aria-hidden="true" />{config[0]}</span>;
}

function ActionSkeletons() { return <div className="grid gap-3 lg:grid-cols-2" aria-hidden="true">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-md border border-line bg-panel" />)}</div>; }
function EmptyActions({ query }: { query: string }) { return <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">{query ? "No operator actions match that search." : "No operator scripts are available."}</div>; }
function formatRelativeDate(value: string): string { const age = Date.now() - Date.parse(value); if (age < 60_000) return "just now"; if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`; if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`; return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
