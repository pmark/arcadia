"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { DashboardChrome } from "../components/chrome";
import {
  ActivityRow,
  ArtifactRow,
  AttentionCard,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  MilestoneRow,
  Section,
  SmallRunRow
} from "../components/dashboard-ui";
import { useArcadiaSnapshot } from "../hooks/use-arcadia-snapshot";
import type { DashboardAttentionItem } from "../lib/types";

export default function MissionControlPage() {
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();
  const [askText, setAskText] = useState("");
  const [askPending, setAskPending] = useState(false);
  const [askMessage, setAskMessage] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [pendingAttentionAction, setPendingAttentionAction] = useState<string | null>(null);

  async function submitAsk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = askText.trim();
    if (!request) {
      return;
    }

    setAskPending(true);
    setAskMessage(null);
    setAskError(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request })
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromBody(body, "Ask request failed."));
      }

      setAskText("");
      setAskMessage(typeof body.message === "string" ? body.message : "Ask handled.");
      await refresh();
    } catch (submitError) {
      setAskError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setAskPending(false);
    }
  }

  async function runAttentionReviewAction(
    item: DashboardAttentionItem,
    action: "approve" | "reject" | "defer"
  ) {
    if (!item.relatedReviewId) {
      return;
    }

    setPendingAttentionAction(`${item.id}:${action}`);
    try {
      const response = await fetch("/api/review-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.relatedReviewId, action })
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromBody(body, "Review action failed."));
      }
      await refresh();
    } catch (actionError) {
      setAskError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setPendingAttentionAction(null);
    }
  }

  return (
    <DashboardChrome
      title="Mission Control"
      subtitle={snapshot?.workspace}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} /> : null}
      {askError ? <ErrorState title="Ask failed" message={askError} /> : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : snapshot ? (
        <div className="grid min-w-0 gap-6">
          <form onSubmit={(event) => void submitAsk(event)} className="grid min-w-0 gap-2">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <input
                value={askText}
                onChange={(event) => setAskText(event.target.value)}
                placeholder="Ask Arcadia"
                className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-panel px-3 text-sm text-ink outline-none transition placeholder:text-muted focus:border-steel"
              />
              <button
                type="submit"
                disabled={askPending || !askText.trim()}
                title="Ask"
                aria-label="Ask"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-4 text-sm font-semibold text-steel transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {askPending ? "Working..." : "Ask"}
              </button>
            </div>
            {askMessage ? (
              <div className="rounded-md border border-moss/30 bg-moss/10 px-3 py-2 text-sm font-medium text-moss">
                {askMessage}
              </div>
            ) : null}
          </form>

          <section className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Active" value={snapshot.counts.activeProjects} tone="green" />
            <Metric label="Paused" value={snapshot.counts.pausedProjects} tone="gold" />
            <Metric label="Incubating" value={snapshot.counts.incubatingProjects} tone="steel" />
            <Metric label="Attention" value={snapshot.counts.attention} tone="clay" />
            <Metric label="Requires Review" value={snapshot.counts.requiresReview} tone="clay" />
            <Metric label="Back Burner" value={snapshot.counts.backBurner} tone="neutral" />
          </section>

          <Section title="Attention">
            {snapshot.attentionItems.length > 0 ? (
              <div className="grid min-w-0 gap-3">
                {snapshot.attentionItems.slice(0, 8).map((item) => (
                  <AttentionCard
                    key={item.id}
                    item={item}
                    pendingAction={
                      pendingAttentionAction?.startsWith(`${item.id}:`)
                        ? pendingAttentionAction.slice(item.id.length + 1)
                        : null
                    }
                    onReviewAction={(attentionItem, action) => void runAttentionReviewAction(attentionItem, action)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState text="No immediate user-facing blockers." />
            )}
          </Section>

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

          <Section title="Activity">
            {snapshot.activityEvents.length > 0 ? (
              <div className="grid min-w-0 gap-3">
                {snapshot.activityEvents.slice(0, 10).map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </div>
            ) : (
              <EmptyState text="No activity yet." />
            )}
          </Section>

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

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const error = "error" in body && typeof body.error === "string" ? body.error : fallback;
  const details = "details" in body ? body.details : null;
  if (!details) {
    return error;
  }

  return `${error}\n${JSON.stringify(details, null, 2)}`;
}
