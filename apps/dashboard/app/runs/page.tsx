"use client";

import { Loader2, Play } from "lucide-react";
import { useState } from "react";
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

export default function RunsPage() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [handoffPending, setHandoffPending] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const runs = useRuns(historyOpen);
  const control = useProductionControl();
  const activeSessions = runs.data?.activeAgentSessions ?? [];
  const activeRuns = runs.data?.activeExecutionRuns ?? [];

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
      <section className="mb-6 rounded-md border border-line bg-panel p-4 shadow-soft" aria-label="Protected Go handoff">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Issue #419 protected handoff</h2>
            <p className="mt-1 text-sm text-muted">Merge the reviewed repair instructions and reconcile through protected Arcadia Go.</p>
          </div>
          <button
            type="button"
            disabled={handoffPending}
            onClick={async () => {
              setHandoffPending(true);
              setHandoffMessage(null);
              setHandoffError(null);
              try {
                const response = await fetch("/api/operator-script", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: "request-arcadia-go-handoff" })
                });
                const body = await response.json() as { message?: string; error?: string };
                if (!response.ok) throw new Error(body.error ?? "Could not start the protected handoff.");
                setHandoffMessage(body.message ?? "Protected handoff started.");
              } catch (error) {
                setHandoffError(error instanceof Error ? error.message : String(error));
                setHandoffPending(false);
              }
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-steel px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {handoffPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {handoffPending ? "Starting…" : "Run protected handoff"}
          </button>
        </div>
        {handoffMessage ? <p className="mt-3 text-sm text-moss">{handoffMessage}</p> : null}
        {handoffError ? <p className="mt-3 text-sm text-clay">{handoffError}</p> : null}
      </section>
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
