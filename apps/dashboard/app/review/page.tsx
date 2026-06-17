"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { EmptyState, ErrorState, LoadingState, ReviewCard } from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";
import type { DashboardReviewItem } from "../../lib/types";

export default function ReviewPage() {
  const router = useRouter();
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function submitAction(item: DashboardReviewItem, action: "approve" | "reject" | "defer") {
    await submitReviewAction(item, action);
  }

  async function submitApproveAndExecute(item: DashboardReviewItem) {
    const key = `${item.id}:approve-execute`;
    setPendingKey(key);
    setActionMessage(null);
    setActionError(null);

    try {
      const response = await fetch("/api/review-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action: "approve", execute: true })
      });
      const body = await response.json() as { message?: string; runId?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(errorMessageFromBody(body, "Review action failed."));
      }

      if (typeof body.runId === "string") {
        router.push(`/runs/${encodeURIComponent(body.runId)}`);
        return;
      }

      setActionMessage(typeof body.message === "string" ? body.message : "Execution queued.");
      await refresh();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setPendingKey(null);
    }
  }

  async function submitOption(item: DashboardReviewItem, option: string) {
    await submitReviewAction(item, "resolve", option);
  }

  async function submitReviewAction(
    item: DashboardReviewItem,
    action: "approve" | "reject" | "defer" | "resolve",
    reply?: string
  ) {
    const key = action === "resolve" ? `${item.id}:resolve:${reply}` : `${item.id}:${action}`;
    setPendingKey(key);
    setActionMessage(null);
    setActionError(null);

    try {
      const response = await fetch("/api/review-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action, reply })
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromBody(body, "Review action failed."));
      }

      setActionMessage(typeof body.message === "string" ? body.message : "Review action completed.");
      await refresh();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <DashboardChrome
      title="Requires Review"
      subtitle={snapshot ? `${snapshot.counts.requiresReview} active` : undefined}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} /> : null}
      {actionError ? <ErrorState title="Review action failed" message={actionError} /> : null}
      {actionMessage ? (
        <div className="mb-3 rounded-md border border-moss/30 bg-moss/10 p-4 text-sm font-medium text-moss">
          {actionMessage}
        </div>
      ) : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : snapshot?.requiresReviewItems.length ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {snapshot.requiresReviewItems.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              pendingAction={pendingActionFor(item, pendingKey)}
              onAction={(reviewItem, action) => void submitAction(reviewItem, action)}
              onApproveAndExecute={(reviewItem) => void submitApproveAndExecute(reviewItem)}
              onResolveOption={(reviewItem, option) => void submitOption(reviewItem, option)}
            />
          ))}
        </div>
      ) : (
        <EmptyState text="No items require review." />
      )}
    </DashboardChrome>
  );
}

function pendingActionFor(item: DashboardReviewItem, pendingKey: string | null): string | null {
  if (!pendingKey?.startsWith(`${item.id}:`)) {
    return null;
  }

  return pendingKey.slice(item.id.length + 1);
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
