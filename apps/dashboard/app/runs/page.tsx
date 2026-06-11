"use client";

import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState, RunCard } from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";

export default function RunsPage() {
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();

  return (
    <DashboardChrome
      title="Recent Runs"
      subtitle={snapshot ? `${snapshot.counts.recentRuns} loaded` : undefined}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} /> : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : snapshot?.recentRuns.length ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {snapshot.recentRuns.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      ) : (
        <EmptyState text="No execution runs yet." />
      )}
    </DashboardChrome>
  );
}
