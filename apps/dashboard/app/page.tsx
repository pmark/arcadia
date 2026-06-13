"use client";

import { DashboardChrome } from "../components/chrome";
import {
  ArtifactRow,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  MilestoneRow,
  Section,
  SmallRunRow
} from "../components/dashboard-ui";
import { useArcadiaSnapshot } from "../hooks/use-arcadia-snapshot";

export default function MissionControlPage() {
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();

  return (
    <DashboardChrome
      title="Mission Control"
      subtitle={snapshot?.workspace}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} /> : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : snapshot ? (
        <div className="grid min-w-0 gap-6">
          <section className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-5">
            <Metric label="Active" value={snapshot.counts.activeProjects} tone="green" />
            <Metric label="Paused" value={snapshot.counts.pausedProjects} tone="gold" />
            <Metric label="Incubating" value={snapshot.counts.incubatingProjects} tone="steel" />
            <Metric label="Requires Review" value={snapshot.counts.requiresReview} tone="clay" />
            <Metric label="Back Burner" value={snapshot.counts.backBurner} tone="neutral" />
          </section>

          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Section title="Current Milestones">
              {snapshot.currentMilestones.length > 0 ? (
                <div className="grid min-w-0 gap-3">
                  {snapshot.currentMilestones.slice(0, 6).map((milestone) => (
                    <MilestoneRow key={milestone.id} milestone={milestone} />
                  ))}
                </div>
              ) : (
                <EmptyState text="No active milestones." />
              )}
            </Section>

            <Section title="Latest Runs">
              {snapshot.recentRuns.length > 0 ? (
                <div className="grid min-w-0 gap-3">
                  {snapshot.recentRuns.slice(0, 6).map((run) => (
                    <SmallRunRow key={run.id} run={run} />
                  ))}
                </div>
              ) : (
                <EmptyState text="No execution runs yet." />
              )}
            </Section>
          </div>

          <Section title="Latest Artifacts">
            {snapshot.recentArtifacts.length > 0 ? (
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                {snapshot.recentArtifacts.slice(0, 6).map((artifact) => (
                  <ArtifactRow key={artifact.id} artifact={artifact} />
                ))}
              </div>
            ) : (
              <EmptyState text="No artifacts yet." />
            )}
          </Section>
        </div>
      ) : null}
    </DashboardChrome>
  );
}
