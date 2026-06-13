"use client";

import { useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { BackBurnerCard, EmptyState, ErrorState, LoadingState } from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";
import type { DashboardBackBurnerItem } from "../../lib/types";

export default function BackBurnerPage() {
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function submitAction(item: DashboardBackBurnerItem, action: "promote" | "archive") {
    setPendingKey(`${item.id}:${action}`);
    setActionMessage(null);
    setActionError(null);

    try {
      const response = await fetch("/api/back-burner-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action })
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromBody(body, "Back Burner action failed."));
      }

      setActionMessage(typeof body.message === "string" ? body.message : "Back Burner action completed.");
      await refresh();
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <DashboardChrome
      title="Back Burner"
      subtitle={snapshot ? `${snapshot.counts.backBurner} active` : undefined}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} /> : null}
      {actionError ? <ErrorState title="Back Burner action failed" message={actionError} /> : null}
      {actionMessage ? (
        <div className="mb-3 rounded-md border border-moss/30 bg-moss/10 p-4 text-sm font-medium text-moss">
          {actionMessage}
        </div>
      ) : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : snapshot?.backBurnerItems.length ? (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {snapshot.backBurnerItems.map((item) => (
            <BackBurnerCard
              key={item.id}
              item={item}
              pendingAction={pendingActionFor(item, pendingKey)}
              onPromote={(backBurnerItem) => void submitAction(backBurnerItem, "promote")}
              onArchive={(backBurnerItem) => void submitAction(backBurnerItem, "archive")}
            />
          ))}
        </div>
      ) : (
        <EmptyState text="No active Back Burner items." />
      )}
    </DashboardChrome>
  );
}

function pendingActionFor(item: DashboardBackBurnerItem, pendingKey: string | null): string | null {
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
