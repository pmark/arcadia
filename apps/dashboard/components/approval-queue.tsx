"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Approval } from "../lib/approvals";
import { EmptyState, ErrorState } from "./dashboard-ui";

interface Choice {
  /** The action button's own label, shown while pending. */
  label: string;
  /** For kind "agent_ask": the settlement disposition to send. */
  disposition?: "accepted" | "rejected";
  /** For kind "decision": the option label to answer with. */
  option?: string;
}

// Not a hook value: guards a single ApprovalQueue instance's poll against an
// earlier response overwriting a later one, the same pattern the Operator
// actions section already uses for the same reason.
let approvalRefreshSequence = 0;

const KIND_LABEL: Record<Approval["kind"], string> = {
  decision: "Decision",
  agent_ask: "Agent Ask",
  review_item: "Review item"
};

function cardKey(approval: Approval): string {
  // Decision ids are per-repository sequences ("0001", "0002", …), so two
  // Projects can share one — include the Project to keep cards and pending
  // state distinct across them.
  return `${approval.kind}:${approval.project}:${approval.id}`;
}

/**
 * The Accept/Reject queue. It leads /runs and loads on mount, because these
 * buttons are what the operator opens the page for; every slower or less
 * urgent section on /runs loads on demand instead. Collapsing it stops the
 * poll. `refreshSignal` lets the page's refresh button reload it.
 */
export function ApprovalQueue({ refreshSignal = 0 }: { refreshSignal?: number } = {}) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [open, setOpen] = useState(true);

  const refresh = useCallback(async () => {
    const requested = ++approvalRefreshSequence;
    await fetch("/api/approvals", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { approvals?: Approval[]; note?: string | null; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not load pending approvals.");
        if (requested === approvalRefreshSequence) {
          setApprovals(body.approvals ?? []);
          setNote(body.note ?? null);
          setError(null);
        }
      })
      .catch((err) => {
        if (requested === approvalRefreshSequence) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (requested === approvalRefreshSequence) setHasLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(interval);
  }, [open, refresh, refreshSignal]);

  const act = useCallback(async (approval: Approval, choice: Choice) => {
    const key = `${cardKey(approval)}:${choice.label}`;
    setPendingId(key);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: approval.kind,
          id: approval.id,
          project: approval.project,
          disposition: choice.disposition,
          option: choice.option
        })
      });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not apply this approval.");
      setMessage(body.message ?? "Applied.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }, [refresh]);

  const liveApprovals = approvals.filter((approval) => !approval.staleReason);
  const staleApprovals = approvals.filter((approval) => approval.staleReason);

  const renderCard = (approval: Approval) => {
            const key = cardKey(approval);
            const options = approval.options ?? [];
            // Decision options are real settlement alternatives (answering
            // with a different label changes the outcome); an Agent Ask's
            // options describe something else entirely (e.g. a `plan`
            // intent's activation choices) and never drive its disposition,
            // so only Decisions get an option-driven Approve control.
            const recommendedOption = approval.kind === "decision"
              ? options.find((option) => option.recommended) ?? options[0] ?? null
              : null;
            const expanded = expandedId === key;
            return (
              <article key={key} className="rounded-md border border-line bg-panel p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {KIND_LABEL[approval.kind]} · {approval.project}
                      {approval.blocking ? " · Blocking" : ""}
                      {approval.staleReason ? " · Stale" : ""}
                    </span>
                    <h3 className="mt-1 font-semibold">{approval.title}</h3>
                  </div>
                </div>
                {approval.readOnly ? (
                  <ReadOnlyAnswer approval={approval} />
                ) : approval.kind === "decision" ? (
                  recommendedOption ? (
                    <p className="mt-2 text-sm text-muted">
                      Recommended: <strong className="text-ink">{recommendedOption.label}</strong> — {recommendedOption.consequence}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-muted">No option was offered; open the source document to answer.</p>
                  )
                ) : (
                  <p className="mt-2 text-sm text-muted">Recommended: accept, unless the details below change your mind.</p>
                )}
                <div className="mt-3 flex items-center gap-3">
                  {approval.readOnly ? null : approval.kind === "decision" ? (
                    recommendedOption ? (
                      <button
                        type="button"
                        disabled={pendingId !== null}
                        onClick={() => void act(approval, { label: recommendedOption.label, option: recommendedOption.label })}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-steel px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                      >
                        {pendingId === `${key}:${recommendedOption.label}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        Approve
                      </button>
                    ) : null
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={pendingId !== null}
                        onClick={() => void act(approval, { label: "Accept", disposition: "accepted" })}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-steel px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                      >
                        {pendingId === `${key}:Accept` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={pendingId !== null}
                        onClick={() => void act(approval, { label: "Reject", disposition: "rejected" })}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm font-semibold text-ink transition hover:bg-panel disabled:cursor-wait disabled:opacity-60"
                      >
                        {pendingId === `${key}:Reject` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        Reject
                      </button>
                    </>
                  )}
                  {approval.readOnly ? null : <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : key)}
                    className="inline-flex items-center gap-1 text-sm font-medium text-steel hover:underline"
                  >
                    Details {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                  </button>}
                </div>
                {expanded && !approval.readOnly ? (
                  <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm text-muted">
                    {approval.staleReason ? <p>Stale: {approval.staleReason}</p> : null}
                    {approval.detail ? <p>{approval.detail}</p> : null}
                    {approval.gateQuestion ? <p>Gate: {approval.gateQuestion}</p> : null}
                    <p>Cost: {approval.cost}</p>
                    {approval.evidence.length > 0 ? (
                      <div>
                        <p className="font-semibold text-ink">What settling this will change:</p>
                        <ul className="ml-4 list-disc">
                          {approval.evidence.map((line, index) => <li key={index}>{line}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {(approval.sourceEvidence ?? []).length > 0 ? (
                      <div>
                        <p className="font-semibold text-ink">Evidence:</p>
                        <ul className="ml-4 list-disc">
                          {approval.sourceEvidence.map((line, index) => <li key={index}>{line}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {approval.kind === "decision" && options.length > 1 ? (
                      <div>
                        <p className="font-semibold text-ink">Alternatives</p>
                        <ul className="ml-4 list-disc">
                          {options.filter((option) => option !== recommendedOption).map((option) => (
                            <li key={option.label}>
                              <button
                                type="button"
                                disabled={pendingId !== null}
                                onClick={() => void act(approval, { label: option.label, option: option.label })}
                                className="font-medium text-steel hover:underline disabled:cursor-wait disabled:opacity-60"
                              >
                                {option.label}
                              </button>
                              {" — "}{option.consequence}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {approval.kind === "agent_ask" && options.length > 0 ? (
                      <div>
                        <p className="font-semibold text-ink">Named options (informational — accept/reject decide this Ask, not these)</p>
                        <ul className="ml-4 list-disc">
                          {options.map((option) => <li key={option.label}>{option.label}{option.recommended ? " (recommended)" : ""} — {option.consequence}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
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

/** A read-only row: the dashboard offers no control, only the command that answers it. */
function ReadOnlyAnswer({ approval }: { approval: Approval }) {
  return (
    <div className="mt-2 space-y-2 text-sm text-muted">
      {approval.origin ? <p>Raised by: {approval.origin}</p> : null}
      {approval.staleReason ? <p>Stale: {approval.staleReason}</p> : null}
      <p>Read-only here. Answer it from a terminal:</p>
      {approval.answer ? (
        <code className="block overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-2 text-xs text-ink">{approval.answer}</code>
      ) : null}
      {approval.answerVia.length > 0 ? (
        <ul className="ml-4 list-disc">
          {approval.answerVia.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
