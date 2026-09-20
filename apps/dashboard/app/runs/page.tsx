"use client";

import { CheckCircle2, CircleAlert, Loader2, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, RunCard, SessionCard } from "../../components/dashboard-ui";
import { ProductionControlPanel } from "../../components/production-control-panel";
import { useProductionControl } from "../../hooks/use-production-control";
import { useRuns } from "../../hooks/use-runs";

function CardSkeletons() {
  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-md border border-line bg-panel" />
      ))}
    </div>
  );
}

interface OperatorScript {
  id: string;
  title: string;
  desiredEffect: string;
  authority: { does: string[]; never_does: string[] };
  repeatable: boolean;
  state: {
    status: "available" | "running" | "succeeded" | "failed";
    startedAt?: string;
    finishedAt?: string;
    exitCode?: number | null;
    message?: string;
  };
}

export default function RunsPage() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [operatorScripts, setOperatorScripts] = useState<OperatorScript[]>([]);
  const [operatorScriptError, setOperatorScriptError] = useState<string | null>(null);
  const [pendingScriptId, setPendingScriptId] = useState<string | null>(null);
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const runs = useRuns(historyOpen);
  const control = useProductionControl();
  const activeSessions = runs.data?.activeAgentSessions ?? [];
  const activeRuns = runs.data?.activeExecutionRuns ?? [];

  const refreshOperatorScripts = useCallback(async () => {
    await fetch("/api/operator-script", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { scripts?: OperatorScript[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not load operator scripts.");
        setOperatorScripts(body.scripts ?? []);
        setOperatorScriptError(null);
      })
      .catch((error) => setOperatorScriptError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    void refreshOperatorScripts();
    const interval = setInterval(() => void refreshOperatorScripts(), 3_000);
    return () => clearInterval(interval);
  }, [refreshOperatorScripts]);

  return (
    <DashboardChrome
      title="Runs"
      subtitle={runs.data ? `${activeSessions.length + activeRuns.length} active` : undefined}
      refreshing={runs.refreshing}
      lastLoadedAt={runs.lastLoadedAt}
      onRefresh={() => {
        void runs.refresh();
        void control.refresh();
      }}
    >
      <ProductionControlPanel
        core={control.core}
        queue={control.queue}
        alerts={control.alerts}
        error={control.error}
        queueError={control.queueError}
        alertsError={control.alertsError}
        toggling={control.toggling}
        onToggle={control.toggle}
      />
      {operatorScripts.length > 0 || operatorScriptError ? (
        <section className="mb-6" aria-label="Operator script library">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Operator actions</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {operatorScripts.map((script) => (
              <article key={script.id} className="rounded-md border border-line bg-panel p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{script.title}</h3>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${operatorStateClass(script.state.status)}`}>
                    {operatorStateLabel(script.state.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{script.desiredEffect}</p>
                {script.state.status === "failed" ? (
                  <p className="mt-3 flex items-start gap-2 text-sm text-clay">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {script.state.message ?? `The last attempt failed${script.state.exitCode == null ? "." : ` with exit code ${script.state.exitCode}.`}`}
                  </p>
                ) : null}
                {script.state.status === "succeeded" ? (
                  <p className="mt-3 flex items-start gap-2 text-sm text-moss">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    Completed{script.repeatable ? "; this reusable action remains available." : "; this one-shot action is now disabled."}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={pendingScriptId !== null || script.state.status === "running" || (script.state.status === "succeeded" && !script.repeatable)}
                  onClick={async () => {
                    setPendingScriptId(script.id);
                    setOperatorMessage(null);
                    setOperatorScriptError(null);
                    try {
                      const response = await fetch("/api/operator-script", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: script.id })
                      });
                      const body = await response.json() as { message?: string; error?: string };
                      if (!response.ok) throw new Error(body.error ?? "Could not start the operator action.");
                      setOperatorMessage(body.message ?? `${script.title} started.`);
                      await refreshOperatorScripts();
                    } catch (error) {
                      setOperatorScriptError(error instanceof Error ? error.message : String(error));
                    } finally {
                      setPendingScriptId(null);
                    }
                  }}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-steel px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                >
                  {pendingScriptId === script.id || script.state.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                  {pendingScriptId === script.id ? "Starting…" : script.state.status === "running" ? "Running…" : script.state.status === "failed" ? "Retry" : script.state.status === "succeeded" && !script.repeatable ? "Completed" : "Run"}
                </button>
              </article>
            ))}
          </div>
          {operatorMessage ? <p className="mt-3 text-sm text-moss">{operatorMessage}</p> : null}
          {operatorScriptError ? <p className="mt-3 text-sm text-clay">{operatorScriptError}</p> : null}
        </section>
      ) : null}
      {runs.error ? (
        <ErrorState title="Runs unavailable" message={runs.stale ? `${runs.error} Showing the last known state.` : runs.error} />
      ) : null}

      <section aria-label="Active now" aria-busy={runs.loading} className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Active now</h2>
        {runs.loading && !runs.data ? (
          <CardSkeletons />
        ) : activeSessions.length === 0 && activeRuns.length === 0 ? (
          <EmptyState text="Nothing is currently prepared or running." />
        ) : (
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {activeSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
            {activeRuns
              .filter((run) => !activeSessions.some((session) => session.actionId === run.workItemId))
              .map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
          </div>
        )}
      </section>

      <section aria-label="Recent history">
        <button
          type="button"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
          className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted hover:text-ink"
        >
          {historyOpen ? "▾" : "▸"} Recent history
        </button>
        {historyOpen ? (
          !runs.historyLoaded ? (
            <CardSkeletons />
          ) : runs.data && runs.data.recentRuns.length > 0 ? (
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              {runs.data.recentRuns.map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
            </div>
          ) : (
            <EmptyState text="No runs yet." />
          )
        ) : null}
      </section>
    </DashboardChrome>
  );
}

function operatorStateLabel(status: OperatorScript["state"]["status"]): string {
  return status === "available" ? "Ready" : status === "running" ? "Running" : status === "succeeded" ? "Completed" : "Failed";
}

function operatorStateClass(status: OperatorScript["state"]["status"]): string {
  if (status === "running") return "bg-steel/10 text-steel";
  if (status === "succeeded") return "bg-moss/10 text-moss";
  if (status === "failed") return "bg-clay/10 text-clay";
  return "bg-line text-muted";
}
