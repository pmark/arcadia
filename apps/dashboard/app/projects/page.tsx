"use client";

import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState, ProjectCard } from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";

export default function ProjectsPage() {
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();

  return (
    <DashboardChrome
      title="Projects"
      subtitle={snapshot ? `${snapshot.counts.totalProjects} total` : undefined}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} /> : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : snapshot?.projects.length ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {snapshot.projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <EmptyState text="No projects yet." />
      )}
    </DashboardChrome>
  );
}
