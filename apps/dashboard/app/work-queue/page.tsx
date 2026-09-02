"use client";

import { ArrowDown, ArrowUp, Check, ChevronsUp, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  WorkQueue,
  WorkQueueEntry,
  WorkQueueMakeNextResponse,
  WorkQueueMutationResponse
} from "../../lib/work-queue-types";

type MutationBody = Record<string, unknown> & {
  action: "move" | "arrange" | "undo" | "make-next";
  requestId: string;
  revision: number;
  apply: boolean;
};

interface PendingChange {
  title: string;
  body: MutationBody;
  preview: WorkQueueMutationResponse | WorkQueueMakeNextResponse;
}

export default function WorkQueuePage() {
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("all");
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [batchOrder, setBatchOrder] = useState<string[] | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/work-queue", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the work queue.");
      setQueue(body as WorkQueue);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const entriesByKey = useMemo(
    () => new Map((queue?.ordered ?? []).flatMap((entry) => entry.orderKey ? [[entry.orderKey, entry] as const] : [])),
    [queue]
  );
  const displayedEntries = useMemo(() => {
    const source = batchOrder ? batchOrder.map((key) => entriesByKey.get(key)).filter((entry): entry is WorkQueueEntry => Boolean(entry)) : queue?.ordered ?? [];
    return source.filter((entry) => {
      if (projectFilter !== "all" && entry.projectSlug !== projectFilter) return false;
      return matchesReadiness(entry, readinessFilter);
    });
  }, [batchOrder, entriesByKey, projectFilter, queue, readinessFilter]);
  const next = queue?.ordered.find((entry) => entry.orderKey === queue.nextActionKey) ?? null;
  const projects = [...new Map((queue?.ordered ?? []).flatMap((entry) => entry.projectSlug ? [[entry.projectSlug, entry.projectName ?? entry.projectSlug] as const] : [])).entries()];

  async function preview(title: string, body: MutationBody) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await postMutation(body);
      setPending({ title, body, preview: result });
    } catch (mutationError) {
      await handleMutationError(mutationError);
    } finally {
      setBusy(false);
    }
  }

  async function applyPending() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const fingerprint = "previewFingerprint" in pending.preview.receipt
        ? pending.preview.receipt.previewFingerprint
        : undefined;
      const result = await postMutation({
        ...pending.body,
        apply: true,
        ...(fingerprint ? { previewFingerprint: fingerprint } : {})
      });
      const receipt = result.receipt;
      setNotice(`Applied ${pending.title.toLowerCase()}. Receipt ${receipt.id}. Next: ${result.nextActionKey ?? "none"}.`);
      setPending(null);
      setBatchOrder(null);
      await load();
    } catch (mutationError) {
      await handleMutationError(mutationError);
    } finally {
      setBusy(false);
    }
  }

  async function handleMutationError(mutationError: unknown) {
    const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
    setPending(null);
    if (/revision changed|refresh/i.test(message)) {
      setNotice("The queue changed elsewhere. Arcadia preserved both choices; the current order has been refreshed for a new preview.");
      setBatchOrder(null);
      await load();
    } else {
      setError(message);
    }
  }

  function beginMove(entry: WorkQueueEntry, placement: "top" | "before" | "after", anchor?: string) {
    if (!queue || !entry.orderKey) return;
    void preview(`Move ${entry.actionTitle ?? entry.orderKey}`, {
      action: "move", requestId: crypto.randomUUID(), revision: queue.revision, apply: false,
      move: entry.orderKey, placement, ...(anchor ? { anchor } : {})
    });
  }

  function beginMakeNext(entry: WorkQueueEntry) {
    if (!queue || !entry.orderKey) return;
    void preview(`Make ${entry.actionTitle ?? entry.orderKey} next`, {
      action: "make-next", requestId: crypto.randomUUID(), revision: queue.revision, apply: false,
      actionKey: entry.orderKey
    });
  }

  function beginUndo() {
    if (!queue?.undoReceipt) return;
    void preview("Undo the latest queue change", {
      action: "undo", requestId: crypto.randomUUID(), revision: queue.revision, apply: false,
      receiptId: queue.undoReceipt.id
    });
  }

  function startBatch() {
    setProjectFilter("all");
    setReadinessFilter("all");
    setPending(null);
    setBatchOrder((queue?.ordered ?? []).flatMap((entry) => entry.orderKey ? [entry.orderKey] : []));
  }

  function moveDraft(key: string, delta: number) {
    if (!batchOrder) return;
    const current = batchOrder.indexOf(key);
    const target = current + delta;
    if (current < 0 || target < 0 || target >= batchOrder.length) return;
    const nextOrder = [...batchOrder];
    [nextOrder[current], nextOrder[target]] = [nextOrder[target]!, nextOrder[current]!];
    setBatchOrder(nextOrder);
  }

  function previewBatch() {
    if (!queue || !batchOrder) return;
    void preview("Batch queue reorder", {
      action: "arrange", requestId: crypto.randomUUID(), revision: queue.revision, apply: false, order: batchOrder
    });
  }

  if (loading && !queue) return <PageState title="Loading the work queue…" />;
  if (!queue) return <PageState title="Work queue unavailable" detail={error ?? undefined} retry={() => void load()} />;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-moss">Operator control</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Work Queue</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">One explicit portfolio order. Filters change only this view; they never change priority.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} className="queue-button">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </header>

      {!queue.orderValid ? (
        <Banner tone="warning">{queue.unpositionedCount} approved Action{queue.unpositionedCount === 1 ? " is" : "s are"} unpositioned. Arcadia will not invent a next priority.</Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      <section aria-labelledby="next-action-title" className="mb-6 rounded-xl border border-moss/30 bg-moss/5 p-5 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Arcadia works here next</p>
        {next ? (
          <>
            <h2 id="next-action-title" className="mt-2 text-xl font-semibold text-ink">{next.actionTitle}</h2>
            <p className="mt-1 text-sm text-muted">{next.projectName} · {next.milestone ?? next.planSlug ?? "Active Plan"}</p>
            <p className="mt-3 text-sm text-ink">{next.reason}</p>
            <p className="mt-2 text-sm"><span className="font-medium">Next Action:</span> {next.nextAction}</p>
          </>
        ) : (
          <>
            <h2 id="next-action-title" className="mt-2 text-xl font-semibold text-ink">No eligible next Action</h2>
            <p className="mt-2 text-sm text-muted">{queue.orderValid ? "Every ordered Action is active, waiting, operator-owned, or blocked. The reasons remain visible below." : "Position every approved Action before Arcadia selects work."}</p>
          </>
        )}
      </section>

      <section aria-label="Queue controls" className="mb-4 rounded-xl border border-line bg-panel p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-medium text-ink">Project
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} disabled={Boolean(batchOrder)} className="queue-select">
              <option value="all">All Projects</option>
              {projects.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-ink">Readiness
            <select value={readinessFilter} onChange={(event) => setReadinessFilter(event.target.value)} disabled={Boolean(batchOrder)} className="queue-select">
              <option value="all">All states</option>
              <option value="ready">Ready & authorized</option>
              <option value="waiting">Waiting for pointer</option>
              <option value="active">Active</option>
              <option value="operator">Operator-owned</option>
              <option value="external">External / blocked</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            {batchOrder ? (
              <>
                <button type="button" onClick={previewBatch} disabled={busy || (queue.orderValid && sameOrder(batchOrder, queue.ordered))} className="queue-button queue-button-primary"><Save className="h-4 w-4" aria-hidden="true" /> Preview batch</button>
                <button type="button" onClick={() => setBatchOrder(null)} disabled={busy} className="queue-icon-button" aria-label="Cancel batch reorder"><X className="h-4 w-4" /></button>
              </>
            ) : (
              <button type="button" onClick={startBatch} disabled={busy || queue.ordered.length < 2} className="queue-button">Reorder multiple</button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
          <span>Revision {queue.revision} · {queue.ordered.length} approved Action{queue.ordered.length === 1 ? "" : "s"}</span>
          {queue.undoReceipt && !batchOrder ? (
            <button type="button" onClick={beginUndo} disabled={busy} className="queue-button"><RotateCcw className="h-4 w-4" aria-hidden="true" /> Undo receipt {queue.undoReceipt.id.slice(-6)}</button>
          ) : null}
        </div>
      </section>

      {pending ? <ChangePreview pending={pending} busy={busy} onApply={() => void applyPending()} onCancel={() => setPending(null)} /> : null}

      <section aria-label="Complete approved Action order" className="grid gap-3">
        {displayedEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">No Actions match this view. The underlying order is unchanged.</div>
        ) : displayedEntries.map((entry, index) => {
          const fullIndex = batchOrder ? batchOrder.indexOf(entry.orderKey ?? "") : queue.ordered.findIndex((candidate) => candidate.orderKey === entry.orderKey);
          const previous = queue.ordered[fullIndex - 1]?.orderKey;
          const following = queue.ordered[fullIndex + 1]?.orderKey;
          return (
            <QueueCard
              key={entry.id}
              entry={entry}
              displayPosition={fullIndex + 1}
              nextSelected={entry.orderKey === queue.nextActionKey}
              batch={Boolean(batchOrder)}
              busy={busy}
              canUp={fullIndex > 0}
              canDown={fullIndex < queue.ordered.length - 1}
              onUp={() => batchOrder ? moveDraft(entry.orderKey!, -1) : beginMove(entry, "before", previous ?? undefined)}
              onDown={() => batchOrder ? moveDraft(entry.orderKey!, 1) : beginMove(entry, "after", following ?? undefined)}
              onTop={() => beginMove(entry, "top")}
              onMakeNext={() => beginMakeNext(entry)}
              canMakeNext={queue.orderValid}
            />
          );
        })}
      </section>
    </main>
  );
}

function QueueCard(props: {
  entry: WorkQueueEntry; displayPosition: number; nextSelected: boolean; batch: boolean; busy: boolean;
  canUp: boolean; canDown: boolean; canMakeNext: boolean; onUp: () => void; onDown: () => void; onTop: () => void; onMakeNext: () => void;
}) {
  const { entry } = props;
  const label = readinessLabel(entry);
  return (
    <article className={`rounded-xl border bg-panel p-4 shadow-soft ${cardTone(entry)}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-muted" aria-label={`Queue position ${props.displayPosition}`}>{props.displayPosition}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeTone(entry)}`}>{label}</span>
            <span className="text-xs text-muted">{entry.responsibility ?? "Unassigned"}</span>
            {props.nextSelected ? <span className="rounded-full bg-moss px-2 py-0.5 text-xs font-semibold text-white">Selected next</span> : null}
          </div>
          <h2 className="mt-2 text-base font-semibold text-ink">{entry.actionTitle ?? entry.actionId ?? "Untitled Action"}</h2>
          <p className="mt-1 text-sm text-muted">{entry.projectName ?? "Unassigned Project"} · {entry.milestone ?? entry.planSlug ?? "No Milestone"}</p>
          {entry.outcome ? <p className="mt-2 text-sm"><span className="font-medium">Outcome:</span> {entry.outcome}</p> : null}
          <p className="mt-2 text-sm"><span className="font-medium">Why here:</span> {entry.reason}</p>
          <p className="mt-1 text-sm"><span className="font-medium">Next Action:</span> {entry.nextAction}</p>

          <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <Meta label="Status" value={entry.status} />
            <Meta label="Effort" value={entry.effort ?? "Not set"} />
            <Meta label="Token Impact" value={entry.tokenImpact ?? "Not set"} />
            <Meta label="Dependencies" value={entry.dependencies?.length ? entry.dependencies.join(", ") : "None"} />
            <Meta label="Decisions" value={entry.decisions?.length ? entry.decisions.join(", ") : "None"} />
            <Meta label="Acceptance" value={entry.acceptanceCriteria?.[0] ?? "Not declared"} />
          </dl>

          {entry.blockers.length > 0 ? (
            <ul className="mt-3 grid gap-2" aria-label="Eligibility blockers">
              {entry.blockers.map((blocker) => (
                <li key={`${blocker.relativePath}:${blocker.field}:${blocker.message}`} className="rounded-md bg-amber-50 p-2 text-xs text-amber-950">
                  <span className="font-semibold">{blocker.field}:</span> {blocker.message} <span className="block mt-1">Fix: {blocker.remedy}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {entry.orderKey ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
              {!props.batch ? <button type="button" onClick={props.onTop} disabled={props.busy || props.displayPosition === 1} className="queue-button"><ChevronsUp className="h-4 w-4" /> Top</button> : null}
              <button type="button" onClick={props.onUp} disabled={props.busy || !props.canUp} className="queue-icon-button" aria-label={`Move ${entry.actionTitle} before the preceding Action`}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" onClick={props.onDown} disabled={props.busy || !props.canDown} className="queue-icon-button" aria-label={`Move ${entry.actionTitle} after the following Action`}><ArrowDown className="h-4 w-4" /></button>
              {!props.batch && entry.state === "ready" && !entry.pointerAuthorized ? <button type="button" onClick={props.onMakeNext} disabled={props.busy || !props.canMakeNext} className="queue-button queue-button-primary"><Check className="h-4 w-4" /> Make next</button> : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ChangePreview({ pending, busy, onApply, onCancel }: { pending: PendingChange; busy: boolean; onApply: () => void; onCancel: () => void }) {
  const receipt = pending.preview.receipt;
  const changed = "before" in receipt ? changedSegment(receipt.before, receipt.after) : [];
  return (
    <section aria-live="polite" className="mb-4 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-950">
      <h2 className="font-semibold">Preview: {pending.title}</h2>
      {changed.length > 0 ? <ol className="mt-2 list-decimal pl-5 text-sm">{changed.map((key) => <li key={key}>{key}</li>)}</ol> : null}
      {"previewFingerprint" in receipt ? <p className="mt-2 break-all text-xs">Governed pointer fingerprint: {receipt.previewFingerprint}</p> : null}
      <p className="mt-2 text-xs">Current revision {pending.body.revision}. Apply is atomic; a concurrent change will be refused and refreshed.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onApply} disabled={busy} className="queue-button queue-button-primary">Apply exact preview</button>
        <button type="button" onClick={onCancel} disabled={busy} className="queue-button">Cancel</button>
      </div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-0.5 text-ink">{value}</dd></div>;
}

function Banner({ tone, children }: { tone: "warning" | "error" | "success"; children: React.ReactNode }) {
  const styles = tone === "error" ? "border-red-300 bg-red-50 text-red-900" : tone === "success" ? "border-moss/30 bg-moss/5 text-ink" : "border-amber-300 bg-amber-50 text-amber-950";
  return <div className={`mb-4 rounded-lg border p-3 text-sm ${styles}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

function PageState({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  return <main className="mx-auto max-w-3xl px-4 py-16 text-center"><h1 className="text-xl font-semibold">{title}</h1>{detail ? <p className="mt-2 text-sm text-muted">{detail}</p> : null}{retry ? <button type="button" onClick={retry} className="queue-button mt-4">Try again</button> : null}</main>;
}

async function postMutation(body: MutationBody): Promise<WorkQueueMutationResponse | WorkQueueMakeNextResponse> {
  const response = await fetch("/api/work-queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The queue change failed.");
  return result as WorkQueueMutationResponse | WorkQueueMakeNextResponse;
}

function matchesReadiness(entry: WorkQueueEntry, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "ready") return entry.state === "ready" && entry.pointerAuthorized === true;
  if (filter === "waiting") return entry.state === "ready" && entry.pointerAuthorized !== true;
  if (filter === "active") return entry.state === "running";
  if (filter === "operator") return entry.responsibility === "requires_review";
  if (filter === "external") return entry.responsibility === "blocked" || entry.state === "attention";
  return true;
}

function readinessLabel(entry: WorkQueueEntry): string {
  if (entry.state === "running") return "Active";
  if (entry.state === "ready" && entry.pointerAuthorized) return "Ready";
  if (entry.state === "ready") return "Waiting for pointer";
  if (entry.responsibility === "requires_review") return "Operator Decision";
  if (entry.responsibility === "blocked") return "External blocker";
  return "Needs attention";
}

function cardTone(entry: WorkQueueEntry): string {
  if (entry.state === "running") return "border-sky-300";
  if (entry.state === "ready" && entry.pointerAuthorized) return "border-moss/40";
  if (entry.state === "ready") return "border-violet-300";
  if (entry.responsibility === "requires_review") return "border-amber-300";
  return "border-red-200";
}

function badgeTone(entry: WorkQueueEntry): string {
  if (entry.state === "running") return "bg-sky-100 text-sky-900";
  if (entry.state === "ready" && entry.pointerAuthorized) return "bg-moss/10 text-moss";
  if (entry.state === "ready") return "bg-violet-100 text-violet-900";
  if (entry.responsibility === "requires_review") return "bg-amber-100 text-amber-950";
  return "bg-red-100 text-red-900";
}

function changedSegment(before: string[], after: string[]): string[] {
  const changed = before.map((key, index) => key === after[index] ? -1 : index).filter((index) => index >= 0);
  if (changed.length === 0) return [];
  return after.slice(Math.min(...changed), Math.max(...changed) + 1);
}

function sameOrder(order: string[], entries: WorkQueueEntry[]): boolean {
  const current = entries.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []);
  return JSON.stringify(order) === JSON.stringify(current);
}
