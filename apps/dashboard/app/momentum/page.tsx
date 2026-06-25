"use client";

import { useEffect, useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import {
  ActivityRow,
  ArtifactRow,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Section
} from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";
import type { FeedbackListResponse } from "../../lib/types";

export default function MomentumPage() {
  const { snapshot, error, loading } = useArcadiaSnapshot();
  const [feedback, setFeedback] = useState<FeedbackListResponse | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/feedback", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) {
          return;
        }
        if (body?.result) {
          setFeedback(body.result as FeedbackListResponse);
        } else {
          setFeedbackError(typeof body?.error === "string" ? body.error : "Feedback request failed.");
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setFeedbackError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MobileShell>
      <h1 className="mb-4 text-lg font-semibold">Momentum</h1>

      {error ? <ErrorState message={error} /> : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : snapshot ? (
        <div className="grid min-w-0 gap-6">
          <section className="grid min-w-0 grid-cols-2 gap-3">
            <Metric label="Active" value={snapshot.counts.activeProjects} tone="green" />
            <Metric label="Attention" value={snapshot.counts.attention} tone="clay" />
            <Metric label="Recent Runs" value={snapshot.counts.recentRuns} tone="steel" />
            <Metric label="Recent Artifacts" value={snapshot.counts.recentArtifacts} tone="gold" />
          </section>

          <Section title="Feedback">
            {feedbackError ? (
              <ErrorState title="Feedback unavailable" message={feedbackError} />
            ) : feedback ? (
              <div className="flex min-w-0 gap-3">
                <Metric label="Up" value={feedback.counts.up} tone="green" />
                <Metric label="Down" value={feedback.counts.down} tone="clay" />
              </div>
            ) : (
              <LoadingState />
            )}
          </Section>

          <Section title="Recent Activity">
            {snapshot.activityEvents.length > 0 ? (
              <div className="grid min-w-0 gap-3">
                {snapshot.activityEvents.slice(0, 8).map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </div>
            ) : (
              <EmptyState text="No activity yet." />
            )}
          </Section>

          <Section title="Latest Artifacts">
            {snapshot.recentArtifacts.length > 0 ? (
              <div className="grid min-w-0 gap-3">
                {snapshot.recentArtifacts.slice(0, 5).map((artifact) => (
                  <ArtifactRow key={artifact.id} artifact={artifact} />
                ))}
              </div>
            ) : (
              <EmptyState text="No artifacts yet." />
            )}
          </Section>
        </div>
      ) : null}
    </MobileShell>
  );
}
