"use client";

import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState, ReviewCard } from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";

export default function ReviewPage() {
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();

  return (
    <DashboardChrome
      title="Requires Review"
      subtitle={snapshot ? `${snapshot.counts.requiresReview} open` : undefined}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} /> : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : snapshot?.requiresReviewItems.length ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {snapshot.requiresReviewItems.map((item) => (
            <ReviewCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState text="No items require review." />
      )}
    </DashboardChrome>
  );
}
