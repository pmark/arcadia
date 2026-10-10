"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { cardKey, useApprovals } from "../hooks/use-approvals";
import { EmptyState, ErrorState } from "./dashboard-ui";
import { TodoCard } from "./todo-card";

/**
 * The Accept/Reject queue. It leads /runs and loads on mount, because these
 * buttons are what the operator opens the page for; every slower or less
 * urgent section on /runs loads on demand instead. Collapsing it stops the
 * poll. `refreshSignal` lets the page's refresh button reload it. The card is
 * the shared TodoCard that /todo also renders.
 */
export function ApprovalQueue({ refreshSignal = 0 }: { refreshSignal?: number } = {}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const { approvals, error, note, pendingId, message, hasLoaded, act } = useApprovals({ enabled: open, refreshSignal });

  const liveApprovals = approvals.filter((approval) => !approval.staleReason);
  const staleApprovals = approvals.filter((approval) => approval.staleReason);

  const renderCard = (approval: (typeof approvals)[number]) => {
    const key = cardKey(approval);
    return (
      <TodoCard
        key={key}
        approval={approval}
        expanded={expandedId === key}
        onToggle={() => setExpandedId(expandedId === key ? null : key)}
        pendingId={pendingId}
        onAct={act}
        showLink
      />
    );
  };

  return (
    <section className="mb-6" aria-label="Approval queue">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-11 items-center gap-2 uppercase tracking-[0.14em]"
        >
          To-do{hasLoaded ? ` (${liveApprovals.length})` : ""}
          {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      </h2>
      {!open ? null : !hasLoaded && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</p>
      ) : (
        <>
      {error ? <ErrorState title="Approvals unavailable" message={error} /> : null}
      {note ? <p role="status" className="mb-3 rounded-md border border-line bg-panel p-3 text-sm text-muted">{note}</p> : null}
      {message ? <p className="mb-3 flex items-center gap-2 text-sm text-moss"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{message}</p> : null}
      {approvals.length === 0 && !error ? (
        <EmptyState text="Nothing is waiting on you." />
      ) : (
        <>
          {liveApprovals.length === 0 && !error ? <EmptyState text="Nothing is waiting on you." /> : null}
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {liveApprovals.map(renderCard)}
          </div>
          {staleApprovals.length > 0 ? (
            <details className="mt-4">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold uppercase tracking-[0.14em] text-muted">Stale ({staleApprovals.length})</summary>
              <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
                {staleApprovals.map(renderCard)}
              </div>
            </details>
          ) : null}
        </>
      )}
        </>
      )}
    </section>
  );
}
