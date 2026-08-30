"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { AttentionCard, EmptyState, ErrorState, LoadingState, ReviewCard } from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";
import { buildNeedsYouBoard, type RankedNeedsYouItem } from "../../lib/needs-you";
import type { DashboardAttentionItem, DashboardReviewItem } from "../../lib/types";

interface Receipt {
  decisionLabel: string;
  message: string;
  nextAction: string | null;
}

export default function ReviewPage() {
  const router = useRouter();
  const { snapshot, error, loading, refreshing, lastLoadedAt, refresh } = useArcadiaSnapshot();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);

  const reviewItems = snapshot?.requiresReviewItems ?? [];
  const reviewById = useMemo(() => new Map(reviewItems.map((review) => [review.id, review])), [reviewItems]);

  const board = useMemo(
    () =>
      buildNeedsYouBoard(
        snapshot?.attentionItems ?? [],
        reviewItems,
        snapshot ? [...snapshot.agentQueue.ready, ...snapshot.agentQueue.running, ...snapshot.agentQueue.attention] : [],
        Date.now(),
        snapshot?.reviewFocus ?? null
      ),
    [snapshot, reviewItems]
  );

  const all = board.dominant ? [board.dominant, ...board.queue] : board.queue;
  const dominant = selectedId ? all.find((entry) => entry.item.id === selectedId) ?? board.dominant : board.dominant;
  const queue = all.filter((entry) => entry.item.id !== dominant?.item.id);

  async function submitAction(item: DashboardReviewItem, action: "approve" | "reject" | "defer") {
    await submitReviewAction(item, action);
  }

  async function submitDefer(item: DashboardReviewItem, trigger: string) {
    await submitReviewAction(item, "defer", undefined, trigger);
  }

  async function submitRefinement(item: DashboardReviewItem, feedback: string) {
    await submitReviewAction(item, "reject", undefined, undefined, feedback);
  }

  async function submitApproveAndExecute(item: DashboardReviewItem) {
    const key = `${item.id}:approve-execute`;
    setPendingKey(key);
    setReceipt(null);
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

      setReceipt({
        decisionLabel: item.displayId || item.id,
        message: typeof body.message === "string" ? body.message : "Execution queued.",
        nextAction: item.proposedAction || null
      });
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

  async function submitAnswer(item: DashboardReviewItem, answer: string) {
    await submitReviewAction(item, "resolve", answer);
  }

  async function submitReviewAction(
    item: DashboardReviewItem,
    action: "approve" | "reject" | "defer" | "resolve",
    reply?: string,
    trigger?: string,
    feedback?: string
  ) {
    const key = action === "resolve" ? `${item.id}:resolve:${reply}` : `${item.id}:${action}`;
    setPendingKey(key);
    setReceipt(null);
    setActionError(null);

    try {
      const response = await fetch("/api/review-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action, reply, trigger, feedback, requireTrigger: action === "defer" })
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromBody(body, "Review action failed."));
      }

      const message = typeof body.message === "string" ? body.message : "Review action completed.";
      setReceipt({
        decisionLabel: item.displayId || item.id,
        message,
        nextAction: item.proposedAction || null
      });
      setSelectedId(null);
      await refresh();
      const result = body && typeof body === "object" && "result" in body
        ? body.result as { action?: string; item?: { resolvedIntent?: string; workItemId?: string | null } }
        : null;
      if (
        action === "resolve" &&
        result?.action === "approved" &&
        result.item?.resolvedIntent === "ActionClarification" &&
        result.item.workItemId
      ) {
        setReceipt((prev) => prev ? { ...prev, message: `${prev.message} Arcadia is continuing clarification in the background…` } : prev);
        void continueAnsweredAction(result.item.workItemId);
      }
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setPendingKey(null);
    }
  }

  async function continueAnsweredAction(workItemId: string) {
    try {
      const response = await fetch("/api/clarify-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workItemId })
      });
      const body = await response.json() as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(errorMessageFromBody(body, "Automatic clarification is unavailable."));
      }
      await refresh();
    } catch {
      setReceipt((prev) => prev ? {
        ...prev,
        message: "Answer recorded. Automatic clarification is unavailable right now; the Action remains ready to continue."
      } : prev);
    }
  }

  function renderRankedItem(entry: RankedNeedsYouItem, emphasized: boolean) {
    const review = entry.item.relatedReviewId ? reviewById.get(entry.item.relatedReviewId) : undefined;

    if (review) {
      return (
        <ReviewCard
          key={entry.item.id}
          item={review}
          rankReasons={emphasized ? entry.reasons : undefined}
          pendingAction={pendingActionFor(review, pendingKey)}
          onAction={(reviewItem, action) => void submitAction(reviewItem, action)}
          onDefer={(reviewItem, trigger) => void submitDefer(reviewItem, trigger)}
          onRefine={(reviewItem, feedback) => void submitRefinement(reviewItem, feedback)}
          onApproveAndExecute={(reviewItem) => void submitApproveAndExecute(reviewItem)}
          onResolveOption={(reviewItem, option) => void submitOption(reviewItem, option)}
          onResolveReply={(reviewItem, answer) => void submitAnswer(reviewItem, answer)}
        />
      );
    }

    return (
      <AttentionCard
        key={entry.item.id}
        item={entry.item}
        pendingAction={null}
        confirmActions
        rankReasons={emphasized ? entry.reasons : undefined}
      />
    );
  }

  return (
    <DashboardChrome
      title="Needs you"
      subtitle={snapshot ? `${board.queue.length + (board.dominant ? 1 : 0)} focused · ${board.excluded.length} more` : undefined}
      refreshing={refreshing}
      lastLoadedAt={lastLoadedAt}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} /> : null}
      {actionError ? <ErrorState title="Review action failed" message={actionError} /> : null}
      {receipt ? (
        <div className="mb-3 rounded-md border border-moss/30 bg-moss/10 p-4 text-sm text-moss">
          <p className="text-xs font-semibold uppercase tracking-wide">Receipt · {receipt.decisionLabel}</p>
          <p className="mt-1 font-medium leading-5">{receipt.message}</p>
          {receipt.nextAction ? <p className="mt-1 text-xs leading-5 text-moss/80">Next: {receipt.nextAction}</p> : null}
        </div>
      ) : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : dominant ? (
        <div className="grid min-w-0 gap-6">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Highest leverage</h2>
            {renderRankedItem(dominant, true)}
          </section>
          {queue.length > 0 ? (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Also waiting ({queue.length})</h2>
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                {queue.map((entry) => (
                  <button
                    key={entry.item.id}
                    type="button"
                    onClick={() => setSelectedId(entry.item.id)}
                    className="min-w-0 rounded-md border border-line bg-panel p-3 text-left text-sm shadow-soft transition hover:border-steel"
                  >
                    <p className="break-words font-semibold leading-5">{entry.item.reason}</p>
                    <p className="mt-1 break-words text-xs text-muted">{entry.item.projectName ?? "Unassigned"}</p>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <ExcludedSection excluded={board.excluded} show={showExcluded} onToggle={() => setShowExcluded((prev) => !prev)} />
        </div>
      ) : (
        <div className="grid min-w-0 gap-6">
          <EmptyState text="Nothing needs you right now." />
          <ExcludedSection excluded={board.excluded} show={showExcluded} onToggle={() => setShowExcluded((prev) => !prev)} />
        </div>
      )}
    </DashboardChrome>
  );
}

function ExcludedSection({
  excluded,
  show,
  onToggle
}: {
  excluded: Array<{ item: DashboardAttentionItem; exclusionReason: string }>;
  show: boolean;
  onToggle: () => void;
}) {
  if (excluded.length === 0) {
    return null;
  }

  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="text-xs font-semibold uppercase tracking-wide text-muted underline underline-offset-2"
      >
        {show ? "Hide" : "Show"} lower-priority & historical ({excluded.length})
      </button>
      {show ? (
        <ul className="mt-3 grid min-w-0 gap-2">
          {excluded.map(({ item, exclusionReason }) => (
            <li key={item.id} className="min-w-0 rounded-md border border-line bg-canvas p-3 text-xs text-muted">
              <p className="break-words font-medium text-ink/80">{item.reason}</p>
              <p className="mt-1 break-words">{exclusionReason}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
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
