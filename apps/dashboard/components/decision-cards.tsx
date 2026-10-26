"use client";

import { useEffect, useRef } from "react";
import type { Approval } from "../lib/approvals";
import type { DecisionCardRefusalView, DecisionCardView, LegacyBadges } from "../lib/decision-cards";
import { TodoCard } from "./todo-card";

export interface CardOutcome {
  ok: boolean;
  reason?: string;
  message: string;
}

export interface DecisionCardsProps {
  views: DecisionCardView[];
  pendingId: string | null;
  outcomes: Record<string, CardOutcome | undefined>;
  onPress: (view: DecisionCardView, optionId: string) => void;
  /** Keep only cards whose verb is in this list (the /actions page shows run cards). */
  verbs?: ReadonlyArray<string>;
  heading?: string;
  /** Sources that produced no pressable card; each is shown with its reason. */
  refused?: ReadonlyArray<DecisionCardRefusalView>;
  /** Blocking and stale state of the same Decision's to-do row, keyed `project:id`; shown on the card header. */
  badges?: Readonly<Record<string, LegacyBadges | undefined>>;
}

const VERB_LABEL: Record<string, string> = { answer: "Answer", run: "Run", merge: "Merge", veto: "Veto" };

/** Only web links are rendered as links; anything else in an evidence url is shown as inert text. */
function safeHref(url: string | undefined): string | null {
  if (url === undefined) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * A card's anchor, encoded exactly as next-step links build it (`#card-${encodeURIComponent(id)}` in
 * src/decisions/nextSteps.ts), so a link always names its card whatever characters the id holds.
 */
export const cardAnchor = (id: string): string => `card-${encodeURIComponent(id)}`;

/** The card a `#card-…` hash names, accepting a fragment the browser left partly unencoded (`:` and `/`). */
function hashedCard(hash: string): string | null {
  if (!hash.startsWith("#card-")) return null;
  try {
    return cardAnchor(decodeURIComponent(hash.slice("#card-".length)));
  } catch {
    return hash.slice(1);
  }
}

/**
 * Cards arrive after the page loads, so the browser's own jump to `#card-…` finds nothing. Once the named card is
 * rendered, scroll to it, once per hash: the 15-second refresh never pulls the operator back.
 */
function useScrollToHashedCard(renderedIds: string) {
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    const go = () => {
      const target = hashedCard(window.location.hash);
      if (target === null || scrolledTo.current === target) return;
      const element = document.getElementById(target);
      if (!element) return;
      scrolledTo.current = target;
      element.scrollIntoView({ block: "start" });
    };
    go();
    const onHashChange = () => {
      scrolledTo.current = null;
      go();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [renderedIds]);
}

/**
 * Pinned decision cards: what is being decided, what every option does, the evidence, and one verb button per
 * pressable option. The button posts only the card id and the option's pinned fingerprint. All card text is rendered
 * as text; nothing here is HTML.
 */
export function DecisionCards({ views, pendingId, outcomes, onPress, verbs, heading = "Decision cards", refused = [], badges = {} }: DecisionCardsProps) {
  const shown = views.filter((view) => verbs === undefined || verbs.includes(view.card.verb));
  // Refusals concern Decision cards; the run-card view lists only its own verbs.
  const refusals = verbs === undefined ? refused : [];
  useScrollToHashedCard(shown.map((view) => view.card.id).join("\n"));
  if (shown.length === 0 && refusals.length === 0) return null;
  return (
    <section aria-label={heading} className="mb-6" data-testid="decision-cards">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{heading} ({shown.length})</h2>
      {refusals.length > 0 ? (
        <ul className="mb-3 grid gap-2" aria-label="Cards not offered">
          {refusals.map((entry) => (
            <li key={`${entry.id}-${entry.reason}`} role="alert" className="rounded-md border border-line bg-panel p-3 text-sm text-red-700" data-testid="card-refusal">
              Card not offered ({entry.reason}): <span className="break-words">{entry.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-3">
        {shown.map((view) => {
          const { card } = view;
          const outcome = outcomes[card.id];
          const pressableIds = Object.keys(view.pressable);
          const badge = view.duplicates === null ? undefined : badges[`${view.duplicates.project}:${view.duplicates.id}`];
          return (
            <article key={card.id} id={cardAnchor(card.id)} className="min-w-0 scroll-mt-16 rounded-md border border-line bg-panel p-4 shadow-soft">
              {badge?.blocking ? (
                <p className="mb-2 inline-block rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">Blocking progress</p>
              ) : null}
              <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                {VERB_LABEL[card.verb] ?? card.verb} · {card.kind}
                {badge?.blocking ? " · Blocking" : ""}
                {badge?.staleReason ? " · Stale" : ""}
              </span>
              {badge?.staleReason ? <p className="mt-1 break-words text-xs text-muted">Stale: {badge.staleReason}</p> : null}
              <h3 className="mt-1 break-words font-semibold">{card.what}</h3>
              <p className="mt-1 break-all text-xs text-muted">Card id: <code className="text-ink">{card.id}</code></p>
              <ul className="mt-2 grid gap-2">
                {card.options.map((option) => (
                  <li key={option.id} className="rounded border border-line p-2 text-sm" data-testid="card-option">
                    <strong className="break-words">{option.label}</strong>
                    <span className="block break-words text-muted">{option.consequence}</span>
                  </li>
                ))}
              </ul>
              {card.evidence.length > 0 ? (
                <ul className="mt-2 grid gap-1 text-xs text-muted" aria-label="Evidence">
                  {card.evidence.map((item, index) => {
                    const href = safeHref(item.url);
                    return (
                      <li key={`${index}-${item.label}`} className="break-all">
                        {href !== null ? <a className="underline" href={href} rel="noreferrer noopener" target="_blank">{item.label}</a> : item.label}
                        {item.fingerprint ? <> · <code>{item.fingerprint.slice(0, 12)}</code></> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {pressableIds.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {pressableIds.map((optionId) => {
                    const option = card.options.find((candidate) => candidate.id === optionId);
                    return (
                      <button
                        key={optionId}
                        type="button"
                        disabled={pendingId !== null}
                        data-card-id={card.id}
                        data-option-id={optionId}
                        onClick={() => onPress(view, optionId)}
                        className="min-h-[44px] rounded-md border border-line bg-ink px-3 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {pendingId === `${card.id}:${optionId}` ? "Working…" : `${VERB_LABEL[card.verb] ?? card.verb}: ${option?.label ?? optionId}`}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  {view.notExecutableReason}
                  {view.actionsHref !== null ? <> <a className="underline" href={view.actionsHref}>Open it on the Actions page</a></> : null}
                </p>
              )}
              {outcome ? (
                <p role={outcome.ok ? "status" : "alert"} className={`mt-2 text-sm ${outcome.ok ? "text-moss" : "text-red-700"}`}>
                  {outcome.ok ? outcome.message : `Refused (${outcome.reason ?? "unknown"}): ${outcome.message}`}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The to-do rows of Decisions that have a pressable card, kept (collapsed, read-only) under the cards so their
 * stale and gate information is never lost and nothing here can answer the Decision a second way.
 */
export function DecisionRecordsUnderCards({ approvals }: { approvals: ReadonlyArray<Approval> }) {
  if (approvals.length === 0) return null;
  return (
    <details className="mb-6" data-testid="decision-records">
      <summary className="cursor-pointer text-sm font-semibold text-muted">Decision records for the cards above ({approvals.length})</summary>
      <div className="mt-2 grid gap-3">
        {approvals.map((approval) => (
          <div key={`${approval.project}:${approval.id}`}>
            <TodoCard approval={{ ...approval, readOnly: true }} expanded={false} pendingId={null} onAct={() => undefined} />
            {approval.gateQuestion ? <p className="mt-1 break-words text-xs text-muted">Gate: {approval.gateQuestion}</p> : null}
          </div>
        ))}
      </div>
    </details>
  );
}
