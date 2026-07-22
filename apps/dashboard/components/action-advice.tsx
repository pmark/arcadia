"use client";

import { Lightbulb, Loader2 } from "lucide-react";
import { useState } from "react";
import { useEnrichment } from "../hooks/use-enrichment";

/**
 * ActionAdvice is the shared "ask AI about this item" affordance for Mission
 * Control. It renders one common icon on an action item; clicking it invokes
 * the most useful plan the AI can perform with that target — by default,
 * surfacing the obstacles to clear and insightful recommendations for excellent
 * execution.
 *
 * It is a progressive enhancement: the surrounding deterministic UI stands on
 * its own, the request is issued only on demand (never on mount), and any
 * failure resolves quietly to a non-fatal note.
 */
export function ActionAdvice({
  target,
  label = "AI advice",
}: {
  /** The action item plus any context the model should reason about. */
  target: string;
  /** Accessible label / tooltip for the trigger. */
  label?: string;
}) {
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);

  const trimmed = target.trim();
  const { status, value } = useEnrichment("action.advice", trimmed, {
    enabled: requested && trimmed.length > 0,
  });

  const isPending = requested && (status === "pending" || status === "idle");
  const isReady = status === "ready" && Boolean(value);
  const isEmpty = requested && (status === "unavailable" || status === "skipped");

  function onClick() {
    if (!requested) {
      setRequested(true);
      setOpen(true);
      return;
    }
    setOpen((prev) => !prev);
  }

  const buttonLabel = !requested
    ? label
    : isPending
      ? "Thinking…"
      : open
        ? "Hide advice"
        : "Show advice";

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending || trimmed.length === 0}
        title={label}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-steel/30 bg-steel/10 px-3 text-sm font-semibold text-steel transition hover:border-steel disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Lightbulb className="h-4 w-4" aria-hidden="true" />
        )}
        {buttonLabel}
      </button>

      {open && isReady ? (
        <div className="mt-3 rounded-md border border-steel/30 bg-steel/5 p-3 text-sm leading-5 text-ink">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-steel">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
            AI advice
          </div>
          <div className="whitespace-pre-line [overflow-wrap:anywhere]">{value}</div>
        </div>
      ) : null}

      {open && isEmpty ? (
        <div className="mt-3 rounded-md border border-dashed border-line bg-panel px-3 py-2 text-xs text-muted">
          AI advice is unavailable right now. The item and its actions are unaffected.
        </div>
      ) : null}
    </div>
  );
}
