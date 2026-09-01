"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardChrome } from "../../components/chrome";
import { AttentionCard, EmptyState, ErrorState, LoadingState, ReviewCard } from "../../components/dashboard-ui";
import { useArcadiaSnapshot } from "../../hooks/use-arcadia-snapshot";
import { buildNeedsYouBoard, type RankedNeedsYouItem } from "../../lib/needs-you";
import { decisionLabelForAttention, reviewSearchText } from "../../lib/review-search";
import type { DashboardAttentionItem, DashboardProject, DashboardReviewFocus, DashboardReviewItem } from "../../lib/types";

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
  const [search, setSearch] = useState("");

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

  const focused = board.dominant ? [board.dominant, ...board.queue] : board.queue;
  const searchable = useMemo(() => [
    ...focused,
    ...board.excluded.map(({ item }) => ({
      item,
      reasons: [],
      attentionCost: "medium" as const,
      tokenImpact: null,
      tokenBudget: null
    }))
  ], [board]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const searchResults = useMemo(
    () => normalizedSearch
      ? searchable.filter((entry) => reviewSearchText(entry.item, reviewById).includes(normalizedSearch))
      : focused,
    [focused, normalizedSearch, reviewById, searchable]
  );
  const all = normalizedSearch ? searchResults : focused;
  const dominant = selectedId ? all.find((entry) => entry.item.id === selectedId) ?? all[0] ?? null : all[0] ?? null;
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

  async function submitReassess(item: DashboardReviewItem) {
    await submitReviewAction(item, "reassess");
  }

  async function submitFlagAgent(item: DashboardReviewItem) {
    await submitReviewAction(item, "flag_agent");
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
    action: "approve" | "reject" | "defer" | "resolve" | "reassess" | "flag_agent",
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
      const responseNextAction = typeof body.nextAction === "string" ? body.nextAction : null;
      setReceipt({
        decisionLabel: item.displayId || item.id,
        message,
        nextAction: responseNextAction ?? (item.proposedAction || null)
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
          onReassess={(reviewItem) => void submitReassess(reviewItem)}
          onFlagAgent={(reviewItem) => void submitFlagAgent(reviewItem)}
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
      <label className="mb-4 grid gap-1 text-xs font-semibold text-muted">
        Search Decisions
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setSelectedId(null);
          }}
          placeholder="Decision number, question, or Project"
          className="min-w-0 rounded-md border border-line bg-panel px-3 py-2 text-sm font-normal text-ink shadow-soft"
        />
      </label>
      {snapshot ? (
        <ReviewFocusControls
          projects={snapshot.projects}
          focus={snapshot.reviewFocus}
          onSaved={refresh}
        />
      ) : null}
      {loading && !snapshot ? (
        <LoadingState />
      ) : normalizedSearch && searchResults.length === 0 ? (
        <EmptyState text={`No Decisions match “${search.trim()}”.`} />
      ) : dominant ? (
        <div className="grid min-w-0 gap-6">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{normalizedSearch ? "Selected result" : "Highest leverage"}</h2>
            {renderRankedItem(dominant, !normalizedSearch)}
          </section>
          {queue.length > 0 ? (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{normalizedSearch ? `Other matches (${queue.length})` : `Also waiting (${queue.length})`}</h2>
              <div className="grid min-w-0 gap-3 md:grid-cols-2">
                {queue.map((entry) => (
                  <button
                    key={entry.item.id}
                    type="button"
                    onClick={() => setSelectedId(entry.item.id)}
                    className="min-w-0 rounded-md border border-line bg-panel p-3 text-left text-sm shadow-soft transition hover:border-steel"
                  >
                    {decisionLabelForAttention(entry.item, reviewById) ? (
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-steel">
                        {decisionLabelForAttention(entry.item, reviewById)}
                      </p>
                    ) : null}
                    <p className="break-words font-semibold leading-5">{entry.item.reason}</p>
                    <p className="mt-1 break-words text-xs text-muted">{entry.item.projectName ?? "Unassigned"}</p>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {!normalizedSearch ? (
            <ExcludedSection
              excluded={board.excluded}
              reviewById={reviewById}
              show={showExcluded}
              onToggle={() => setShowExcluded((prev) => !prev)}
            />
          ) : null}
        </div>
      ) : (
        <div className="grid min-w-0 gap-6">
          <EmptyState text="Nothing needs you right now." />
          <ExcludedSection
            excluded={board.excluded}
            reviewById={reviewById}
            show={showExcluded}
            onToggle={() => setShowExcluded((prev) => !prev)}
          />
        </div>
      )}
    </DashboardChrome>
  );
}

function ReviewFocusControls({
  projects,
  focus,
  onSaved
}: {
  projects: DashboardProject[];
  focus: DashboardReviewFocus | null;
  onSaved: () => Promise<void>;
}) {
  const available = projects.filter((project) => project.status !== "completed").map((project) => project.name);
  const [primary, setPrimary] = useState(focus?.projectOrder[0] ?? "");
  const [secondary, setSecondary] = useState(focus?.projectOrder[1] ?? "");
  const [parked, setParked] = useState(() => new Set(focus?.excludedProjects ?? []));
  const [hasEdited, setHasEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedFocus = useRef({ primary, secondary, parked: new Set(parked) });
  const prioritySummary = [primary, secondary].filter(Boolean).join(" → ") || "No Project preference";
  const parkedSignature = [...parked].sort().join("\n");
  const incomingFocusSignature = JSON.stringify(focus);

  useEffect(() => {
    if (hasEdited) return;
    const next = {
      primary: focus?.projectOrder[0] ?? "",
      secondary: focus?.projectOrder[1] ?? "",
      parked: new Set(focus?.excludedProjects ?? [])
    };
    savedFocus.current = next;
    setPrimary(next.primary);
    setSecondary(next.secondary);
    setParked(next.parked);
  }, [incomingFocusSignature, hasEdited, focus]);

  useEffect(() => {
    if (!hasEdited) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSaving(true);
      setMessage(null);
      setSaveError(null);
      const projectOrder = [primary, secondary].filter(Boolean);
      const excludedProjects = [...parked].filter((project) => !projectOrder.includes(project));
      try {
        const response = await fetch("/api/review-focus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectOrder, excludedProjects, maxItems: focus?.maxItems ?? 5 }),
          signal: controller.signal
        });
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(errorMessageFromBody(body, "Review focus could not be saved."));
        savedFocus.current = { primary, secondary, parked: new Set(excludedProjects) };
        setSaving(false);
        setMessage("Saved");
        setHasEdited(false);
        void onSaved();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const previous = savedFocus.current;
        setSaving(false);
        setHasEdited(false);
        setPrimary(previous.primary);
        setSecondary(previous.secondary);
        setParked(new Set(previous.parked));
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [focus?.maxItems, hasEdited, onSaved, parkedSignature, primary, secondary]);

  function choosePrimary(value: string) {
    setPrimary(value);
    if (value === secondary) setSecondary("");
    setParked((current) => withoutProject(current, value));
    setHasEdited(true);
  }

  function chooseSecondary(value: string) {
    setSecondary(value);
    setParked((current) => withoutProject(current, value));
    setHasEdited(true);
  }

  function toggleParked(project: string, checked: boolean) {
    setParked((current) => {
      const next = new Set(current);
      if (checked) next.add(project);
      else next.delete(project);
      return next;
    });
    setHasEdited(true);
    setMessage(null);
    setSaveError(null);
  }

  return (
    <details className="mb-4 rounded-md border border-line bg-panel p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-ink">
        Focus: {prioritySummary}{parked.size > 0 ? ` · ${parked.size} parked` : ""}
      </summary>
      <div className="mt-4 grid gap-4">
        <p className="text-xs leading-5 text-muted">Choose what deserves attention now. Changes save automatically to the Arcadia workspace and follow you across devices.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-muted">
            Primary Project
            <select
              aria-label="Primary Project"
              value={primary}
              onChange={(event) => choosePrimary(event.target.value)}
              className="min-w-0 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-normal text-ink"
            >
              <option value="">No preference</option>
              {available.map((project) => <option key={project} value={project}>{project}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-muted">
            Secondary Project
            <select
              aria-label="Secondary Project"
              value={secondary}
              onChange={(event) => chooseSecondary(event.target.value)}
              className="min-w-0 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-normal text-ink"
            >
              <option value="">None</option>
              {available.filter((project) => project !== primary).map((project) => <option key={project} value={project}>{project}</option>)}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="text-xs font-semibold text-muted">Park for now</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {available.filter((project) => project !== primary && project !== secondary).map((project) => (
              <label key={project} className="inline-flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={parked.has(project)}
                  onChange={(event) => toggleParked(project, event.target.checked)}
                />
                {project}
              </label>
            ))}
          </div>
        </fieldset>
        {saveError ? <p role="alert" className="text-xs text-red-700">{saveError} The previous focus was restored.</p> : null}
        <p role="status" aria-live="polite" className="min-h-5 text-xs text-muted">
          {saving ? "Saving…" : message}
        </p>
      </div>
    </details>
  );
}

function withoutProject(projects: Set<string>, project: string): Set<string> {
  const next = new Set(projects);
  next.delete(project);
  return next;
}

function ExcludedSection({
  excluded,
  reviewById,
  show,
  onToggle
}: {
  excluded: Array<{ item: DashboardAttentionItem; exclusionReason: string }>;
  reviewById: Map<string, DashboardReviewItem>;
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
              {decisionLabelForAttention(item, reviewById) ? (
                <p className="mb-1 font-semibold uppercase tracking-wide text-steel">
                  {decisionLabelForAttention(item, reviewById)}
                </p>
              ) : null}
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
