"use client";

import { AlertTriangle, ArrowDown, CheckCircle2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { OperatorActionCard, type OperatorScript } from "../../components/operator-action-card";
import { singleFlight } from "../../lib/singleFlight";
import { RunCards } from "./run-cards";
import {
  deriveNextOperatorAction,
  formatCountdown,
  formatLocalTime,
  offPathConfirmation,
  productionObservation,
  type NextOperatorAction,
  type ProductionObservation
} from "../../lib/nextOperatorAction";

const PRODUCTION_POLL_MS = 20_000;

export function ActionsList() {
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
  const [showCards, setShowCards] = useState(false);

  // Never start a read while the previous one is still in flight: a slow library read must not stack.
  const refresh = useMemo(() => singleFlight(async () => {
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
  }), []);

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
    const load = singleFlight(async () => {
      try {
        const response = await fetch("/api/production-control?part=core", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const observation = productionObservation(response.ok, await response.json());
        if (!disposed) setProduction(observation);
      } catch {
        if (!disposed) setProduction(null);
      }
    });
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
      <div className="mb-4">
        <button type="button" onClick={() => setShowCards((open) => !open)} aria-expanded={showCards} className="min-h-11 rounded-md border border-line px-3 text-sm font-semibold text-muted hover:border-steel hover:text-steel">
          {showCards ? "Hide decision cards" : "Show decision cards"}
        </button>
        {showCards ? <RunCards /> : null}
      </div>
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

function ActionSkeletons() { return <div className="grid gap-3 lg:grid-cols-2" aria-hidden="true">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-md border border-line bg-panel" />)}</div>; }
function EmptyActions({ query }: { query: string }) { return <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">{query ? "No operator actions match that search." : "No operator scripts are available."}</div>; }
