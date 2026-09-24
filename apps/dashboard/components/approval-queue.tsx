"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState } from "./dashboard-ui";

interface ApprovalOption {
  label: string;
  consequence: string;
  recommended: boolean;
}

interface Approval {
  kind: "agent_ask" | "decision";
  id: string;
  project: string;
  title: string;
  detail: string | null;
  gateQuestion: string | null;
  options: ApprovalOption[];
  evidence: string[];
  cost: string;
  createdAt: string;
}

// Not a hook value: guards a single ApprovalQueue instance's poll against an
// earlier response overwriting a later one, the same pattern the Operator
// actions section already uses for the same reason.
let approvalRefreshSequence = 0;

export function ApprovalQueue() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const requested = ++approvalRefreshSequence;
    await fetch("/api/approvals", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { approvals?: Approval[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not load pending approvals.");
        if (requested === approvalRefreshSequence) {
          setApprovals(body.approvals ?? []);
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
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const act = useCallback(async (approval: Approval, option: ApprovalOption) => {
    const key = `${approval.kind}:${approval.id}:${option.label}`;
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
          option: option.label
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

  if (!hasLoaded && approvals.length === 0 && !error) {
    return null;
  }

  return (
    <section className="mb-6" aria-label="Approval queue">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Needs your approval</h2>
      {error ? <ErrorState title="Approvals unavailable" message={error} /> : null}
      {message ? <p className="mb-3 flex items-center gap-2 text-sm text-moss"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{message}</p> : null}
      {approvals.length === 0 && !error ? (
        <EmptyState text="Nothing is waiting on you." />
      ) : (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {approvals.map((approval) => {
            const key = `${approval.kind}:${approval.id}`;
            const options = approval.options ?? [];
            const recommended = options.find((option) => option.recommended) ?? options[0] ?? null;
            const expanded = expandedId === key;
            return (
              <article key={key} className="rounded-md border border-line bg-panel p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {approval.kind === "decision" ? "Decision" : "Agent Ask"} · {approval.project}
                    </span>
                    <h3 className="mt-1 font-semibold">{approval.title}</h3>
                  </div>
                </div>
                {recommended ? (
                  <p className="mt-2 text-sm text-muted">
                    Recommended: <strong className="text-ink">{recommended.label}</strong> — {recommended.consequence}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted">No option was offered; open the source document to answer.</p>
                )}
                <div className="mt-3 flex items-center gap-3">
                  {recommended ? (
                    <button
                      type="button"
                      disabled={pendingId !== null}
                      onClick={() => void act(approval, recommended)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-md bg-steel px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                    >
                      {pendingId === `${key}:${recommended.label}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                      Approve
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : key)}
                    className="inline-flex items-center gap-1 text-sm font-medium text-steel hover:underline"
                  >
                    Details {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                {expanded ? (
                  <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm text-muted">
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
                    {options.length > 1 ? (
                      <div>
                        <p className="font-semibold text-ink">Alternatives</p>
                        <ul className="ml-4 list-disc">
                          {options.filter((option) => option !== recommended).map((option) => (
                            <li key={option.label}>
                              <button
                                type="button"
                                disabled={pendingId !== null}
                                onClick={() => void act(approval, option)}
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
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
