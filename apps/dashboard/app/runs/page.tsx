"use client";

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
