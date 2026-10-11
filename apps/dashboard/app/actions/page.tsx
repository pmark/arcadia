"use client";

import { AlertTriangle, ArrowDown, CheckCircle2, Clock3, Loader2, Play, Search, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import {
  deriveNextOperatorAction,
  formatCountdown,
  formatLocalTime,
  offPathConfirmation,
  productionObservation,
  shortName,
  type NextAfterRule,
  type NextOperatorAction,
  type ProductionObservation
} from "../../lib/nextOperatorAction";

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
  failure?: { effect: string; next: string };
  nextAfter?: NextAfterRule | null;
  lastRunReceipt?: { outcome: string; startedAt: string | null; finishedAt: string | null; succeededAt?: string | null } | null;
  modifiedAt: string;
}

const PRODUCTION_POLL_MS = 20_000;

export default function OperatorActionsPage() {
  const [scripts, setScripts] = useState<OperatorScript[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [production, setProduction] = useState<ProductionObservation | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
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

  // A deep link (/actions?q=<action id>) opens with the search prefilled, so a ping can point at one button.
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("q")?.trim();
    if (linked) setQuery(linked.slice(0, 200));
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Live production status feeds the derivation only when a published next_after needs it; an
  // unreadable status is shown as such, never treated as Off.
  const needsProduction = scripts.some((script) => script.nextAfter?.when_production === "inactive");
  useEffect(() => {
    if (!needsProduction) return undefined;
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch("/api/production-control?part=core", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const observation = productionObservation(response.ok, await response.json());
        if (!disposed) setProduction(observation);
      } catch {
        if (!disposed) setProduction(null);
      }
    };
    void load();
    const interval = setInterval(() => void load(), PRODUCTION_POLL_MS);
    return () => { disposed = true; clearInterval(interval); };
  }, [needsProduction]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  const nextAction = useMemo<NextOperatorAction | null>(
    () => loading || (needsProduction && production === undefined) ? null : deriveNextOperatorAction(scripts, needsProduction ? production ?? null : null, now),
    [loading, needsProduction, production, scripts, now]
  );
  const nextScript = nextAction?.status === "next" ? scripts.find((script) => script.id === nextAction.scriptId) ?? null : null;

  const visibleScripts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return scripts
      .filter((script) => script.id !== nextScript?.id)
      .filter((script) => !normalized || [script.id, script.title, script.problem, script.desiredEffect].some((value) => value.toLowerCase().includes(normalized)))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }, [query, scripts, nextScript?.id]);

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
      <NextActionPanel unavailable={!loading && loadedAt === null} next={nextAction} script={nextScript} now={now} launching={launching === nextScript?.id} onLaunch={() => nextScript && void launch(nextScript)} />
      <section aria-label="Other operator actions" className={nextAction?.status === "next" ? "border-t-2 border-dashed border-line pt-5" : ""}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">{nextAction?.status === "next" ? "Other actions (not next)" : "All actions"}</h2>
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
        {/* No press before the next action is known, so an off-path press always meets its confirmation. */}
        {loading || nextAction === null ? <ActionSkeletons /> : visibleScripts.length === 0 ? <EmptyActions query={query} /> : (
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            {visibleScripts.map((script) => (
              <OperatorActionCard
                key={script.id}
                script={script}
                muted={nextAction?.status === "next"}
                confirmation={nextAction ? offPathConfirmation(nextAction, script, scripts) : null}
                nextTitle={nextAction?.status === "next" ? nextAction.title : null}
                launching={launching === script.id}
                onLaunch={() => void launch(script)}
              />
            ))}
          </div>
        )}
      </section>
    </DashboardChrome>
  );
}

interface CardProps {
  script: OperatorScript;
  launching: boolean;
  onLaunch: () => void;
  /** De-emphasize: another action is the operator's next action. */
  muted?: boolean;
  /** Shown before launch when this press is off the next-action path. */
  confirmation?: string | null;
  nextTitle?: string | null;
  /** Rendered inside the "Do this next" panel. */
  primary?: boolean;
}

function OperatorActionCard({ script, launching, onLaunch, muted = false, confirmation = null, nextTitle = null, primary = false }: CardProps) {
  const [confirming, setConfirming] = useState(false);
  const terminal = script.state.status === "succeeded" || script.state.status === "failed";
  const canRun = script.state.status !== "running" && !(script.state.status === "succeeded" && !script.repeatable);
  const press = () => { if (confirmation) setConfirming(true); else onLaunch(); };
  const frame = primary ? "rounded-md border border-line bg-panel p-4" : muted ? "rounded-md border border-line/70 bg-panel/60 p-4 text-ink/80" : "rounded-md border border-line bg-panel p-4 shadow-soft";
  const runStyle = muted ? "border border-line bg-panel text-ink hover:border-steel hover:text-steel" : "bg-steel text-white hover:brightness-110";
  return (
    <article className={frame} data-testid={primary ? "next-action-card" : `operator-action-${script.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={primary ? "text-lg font-semibold" : "font-semibold"}>{script.title}</h3>
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
      {confirming && confirmation ? (
        <div role="alertdialog" aria-label="Not your next action" className="mt-4 rounded-md border-2 border-clay/60 bg-clay/5 p-3 text-sm">
          <p className="font-semibold text-clay">This is not your next action.</p>
          <p className="mt-1">{confirmation}</p>
          {nextTitle ? <p className="mt-2 text-xs text-muted">Next action card: {nextTitle}</p> : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => setConfirming(false)} className="min-h-12 rounded-md bg-steel px-4 font-semibold text-white">Keep my place</button>
            <button type="button" onClick={() => { setConfirming(false); onLaunch(); }} className="min-h-12 rounded-md border border-clay/60 px-4 font-semibold text-clay">Run {shortName(script.title)} anyway</button>
          </div>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canRun && !confirming ? (
          <button type="button" onClick={press} disabled={launching} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${primary ? "min-h-12 w-full bg-steel text-base text-white hover:brightness-110 sm:w-auto" : runStyle}`}>
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

function NextActionPanel({ unavailable, next, script, now, launching, onLaunch }: { unavailable: boolean; next: NextOperatorAction | null; script: OperatorScript | null; now: number; launching: boolean; onLaunch: () => void }) {
  if (unavailable) {
    return (
      <section aria-label="Do this next" className="mb-6 rounded-md border-2 border-clay/40 bg-clay/5 p-4">
        <p className="text-lg font-semibold text-clay">Your next action is unknown: the operator actions could not be read.</p>
      </section>
    );
  }
  if (!next) return <div className="mb-6 h-28 animate-pulse rounded-md border-2 border-line bg-panel" aria-hidden="true" />;
  if (next.status === "none" || !script) {
    const unknown = next.status === "none" && next.unknown === true;
    return (
      <section aria-label="Do this next" className={`mb-6 rounded-md border-2 p-4 ${unknown ? "border-clay/40 bg-clay/5" : "border-moss/40 bg-moss/5"}`}>
        <p className={`flex items-center gap-2 text-lg font-semibold ${unknown ? "text-clay" : "text-moss"}`}>
          {unknown ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          {next.status === "none" ? next.message : "Nothing needs you right now."}
        </p>
        {next.status === "none" && next.note ? <p className="mt-1 text-sm text-muted">{next.note}</p> : null}
      </section>
    );
  }
  const countdown = next.deadline ? formatCountdown(next.deadline, now) : null;
  return (
    <section aria-label="Do this next" className="mb-6 rounded-md border-2 border-steel bg-steel/5 p-4 shadow-soft">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-steel"><ArrowDown className="h-4 w-4" aria-hidden="true" />Do this next</p>
      <p className="mt-2 text-lg font-semibold leading-snug" data-testid="next-action-instruction">{next.instruction}</p>
      {next.deadline ? (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="next-action-deadline">
          <span>Deadline <strong>{formatLocalTime(next.deadline)}</strong></span>
          <span className="font-mono text-2xl font-bold tabular-nums text-steel" aria-live="polite" aria-atomic="true">{countdown ?? "0:00"}</span>
          <span className="text-muted">left</span>
        </p>
      ) : null}
      {next.note ? <p className="mt-2 text-sm text-muted">{next.note}</p> : null}
      <div className="mt-3">
        <OperatorActionCard script={script} primary launching={launching} onLaunch={onLaunch} />
      </div>
    </section>
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
