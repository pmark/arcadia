"use client";

import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState, RunCard, SessionCard } from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";

export default function RunsPage() {
  const { snapshot, error, loading, refreshing, stale, lastLoadedAt, refresh } = useArcadiaSnapshot();
  const activeSessions = snapshot?.activeAgentSessions ?? [];
  const activeRuns = snapshot?.activeExecutionRuns ?? [];

  return (
    <DashboardChrome
      title="Recent Runs"
      subtitle={snapshot ? `${snapshot.counts.recentRuns} loaded` : undefined}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={stale ? `${error} Showing the last known state.` : error} /> : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : (
        <>
          <section aria-label="Active now" className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
              Active now — every Session and Run, regardless of history limits
            </h2>
            {activeSessions.length === 0 && activeRuns.length === 0 ? (
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

          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Recent history</h2>
          {snapshot?.recentRuns.length ? (
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              {snapshot.recentRuns.map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
            </div>
          ) : (
            <EmptyState text="No runs yet." />
          )}
        </>
      )}
    </DashboardChrome>
  );
}
