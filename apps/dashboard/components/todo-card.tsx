"use client";

import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import type { Approval } from "../lib/approvals";
import type { Choice } from "../hooks/use-approvals";
import { cardKey } from "../hooks/use-approvals";

const KIND_LABEL: Record<string, string> = {
  decision: "Decision",
  agent_ask: "Agent Ask",
  review_item: "Review item"
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
}

/** A stable in-page anchor for an item: `#todo-decision-alpha-0001`. */
export function anchorOf(approval: Pick<Approval, "todoKey">): string {
  return `todo-${approval.todoKey.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export interface TodoCardProps {
  approval: Approval;
  expanded: boolean;
  /** Omit on the deep-link page, where the card is always expanded. */
  onToggle?: () => void;
  pendingId: string | null;
  onAct: (approval: Approval, choice: Choice) => void;
  /** Show a link to the item's own page (the list does; the page itself does not). */
  showLink?: boolean;
}

const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-md bg-steel px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm font-semibold text-ink transition hover:bg-panel disabled:cursor-wait disabled:opacity-60";

/**
 * One operator to-do, shared by /runs and /todo. Pure: state lives in the
 * caller. Every control is a button of at least 44px; nothing depends on hover.
 */
export function TodoCard({ approval, expanded, onToggle, pendingId, onAct, showLink = false }: TodoCardProps) {
  const key = cardKey(approval);
  const options = approval.options ?? [];
  // Decision options are real settlement alternatives (answering with a
  // different label changes the outcome); an Agent Ask's options describe
  // something else entirely (e.g. a `plan` intent's activation choices) and
  // never drive its disposition, so only Decisions get an option-driven
  // Approve control.
  const recommendedOption = approval.kind === "decision"
    ? options.find((option) => option.recommended) ?? options[0] ?? null
    : null;
  // A recommendation is shown only when the data carries one.
  const askRecommendation = approval.kind === "agent_ask" ? options.find((option) => option.recommended) ?? null : null;
  const reviewControl = approval.readOnly || approval.buildPacket ? null : approval.reviewControl ?? null;
  const blockerRemedy = approval.blockerRemedy ?? null;
  const clearControl = blockerRemedy?.oneClick ? blockerRemedy : null;
  // Two interactions at most: the button, then this confirm. The consequence is shown before either.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const blockingLive = approval.blocking && !approval.staleReason;
  return (
    <article
      id={anchorOf(approval)}
      className={`min-w-0 scroll-mt-20 rounded-md border bg-panel p-4 shadow-soft ${blockingLive ? "border-2 border-red-600" : "border-line"}`}
    >
      {blockingLive ? (
        <p className="mb-2 inline-block rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
          Blocking progress
        </p>
      ) : null}
      <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
        {kindLabel(approval.kind)} · {approval.project}
        {approval.blocking ? " · Blocking" : ""}
        {approval.staleReason ? " · Stale" : ""}
      </span>
      <h3 className="mt-1 break-words font-semibold">{approval.title}</h3>
      <p className="mt-1 break-all text-xs text-muted">
        {approval.kind === "decision" ? "Decision id" : "Id"}: <code className="text-ink">{approval.id}</code>
        {approval.requestId ? <> · Request id: <code className="text-ink">{approval.requestId}</code></> : null}
      </p>
      {clearControl ? (
        <p className="mt-2 text-sm text-muted">{clearControl.consequence}</p>
      ) : approval.readOnly ? (
        <ReadOnlyAnswer approval={approval} />
      ) : approval.buildPacket ? (
        <p className="mt-2 text-sm text-muted">
          Approving records your answer only; it starts nothing. The guarded build Session is launched separately.
        </p>
      ) : reviewControl ? (
        <p className="mt-2 text-sm text-muted">
          {reviewControl.consequence}
          {reviewControl.canReject && reviewControl.rejectConsequence ? ` Reject: ${reviewControl.rejectConsequence}` : ""}
        </p>
      ) : approval.kind === "decision" ? (
        recommendedOption ? (
          <p className="mt-2 text-sm text-muted">
            Recommended: <strong className="text-ink">{recommendedOption.label}</strong> — {recommendedOption.consequence}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">No option was offered; open the source document to answer.</p>
        )
      ) : approval.acceptable === false ? (
        <p className="mt-2 text-sm text-muted">
          Likely won&apos;t apply — {approval.acceptWhy ?? "the settlement preview was refused"}. This is a hint; applying re-checks. Reject it, or fix what blocks it first.
        </p>
      ) : askRecommendation ? (
        <p className="mt-2 text-sm text-muted">
          Recommended: <strong className="text-ink">{askRecommendation.label}</strong> — {askRecommendation.consequence}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {clearControl ? (
          confirmingClear ? (
            <>
              <button
                type="button"
                disabled={pendingId !== null}
                onClick={() => { setConfirmingClear(false); onAct(approval, { label: "Clear", blockerClear: true }); }}
                className={PRIMARY_BUTTON}
              >
                {pendingId === `${key}:Clear` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Confirm: {clearControl.label}
              </button>
              <button type="button" onClick={() => setConfirmingClear(false)} className={SECONDARY_BUTTON}>Cancel</button>
            </>
          ) : (
            <button type="button" disabled={pendingId !== null} onClick={() => setConfirmingClear(true)} className={PRIMARY_BUTTON}>
              {clearControl.label}…
            </button>
          )
        ) : null}
        {approval.readOnly ? null : approval.buildPacket ? (
          <>
            <button type="button" disabled={pendingId !== null} onClick={() => onAct(approval, { label: "Approve", reviewAction: "approve" })} className={PRIMARY_BUTTON}>
              {pendingId === `${key}:Approve` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Approve (no execute)
            </button>
            <button type="button" disabled={pendingId !== null} onClick={() => onAct(approval, { label: "Reject", reviewAction: "reject" })} className={SECONDARY_BUTTON}>
              {pendingId === `${key}:Reject` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Reject
            </button>
          </>
        ) : reviewControl ? (
          <>
            <button type="button" disabled={pendingId !== null} onClick={() => onAct(approval, { label: "Approve", reviewAction: "approve" })} className={PRIMARY_BUTTON}>
              {pendingId === `${key}:Approve` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {reviewControl.approveLabel}
            </button>
            {reviewControl.canReject ? (
              <button type="button" disabled={pendingId !== null} onClick={() => onAct(approval, { label: "Reject", reviewAction: "reject" })} className={SECONDARY_BUTTON}>
                {pendingId === `${key}:Reject` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Reject
              </button>
            ) : null}
          </>
        ) : approval.kind === "decision" ? (
          recommendedOption ? (
            <button
              type="button"
              disabled={pendingId !== null}
              onClick={() => onAct(approval, { label: recommendedOption.label, option: recommendedOption.label })}
              className={PRIMARY_BUTTON}
            >
              {pendingId === `${key}:${recommendedOption.label}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Approve
            </button>
          ) : null
        ) : (
          <>
            {approval.acceptable === false ? (
              <button type="button" disabled aria-disabled="true" className={SECONDARY_BUTTON}>
                Likely won&apos;t apply — {approval.acceptWhy ?? "preview refused"}
              </button>
            ) : (
              <button type="button" disabled={pendingId !== null} onClick={() => onAct(approval, { label: "Accept", disposition: "accepted" })} className={PRIMARY_BUTTON}>
                {pendingId === `${key}:Accept` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Accept
              </button>
            )}
            <button type="button" disabled={pendingId !== null} onClick={() => onAct(approval, { label: "Reject", disposition: "rejected" })} className={approval.acceptable === false ? PRIMARY_BUTTON : SECONDARY_BUTTON}>
              {pendingId === `${key}:Reject` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Reject
            </button>
          </>
        )}
        {(approval.readOnly && !clearControl) || !onToggle ? null : (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-steel hover:underline"
          >
            Details {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
        {blockerRemedy && !blockerRemedy.oneClick && blockerRemedy.href ? (
          <Link href={blockerRemedy.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-steel hover:underline">
            {blockerRemedy.label}
          </Link>
        ) : null}
        {approval.launchHref ? (
          <Link href={approval.launchHref} className="inline-flex min-h-11 items-center text-sm font-medium text-steel hover:underline">
            Open launch dialog
          </Link>
        ) : null}
        {showLink ? (
          <Link href={approval.href} className="inline-flex min-h-11 items-center text-sm font-medium text-steel hover:underline">
            Open
          </Link>
        ) : null}
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
              <ul className="space-y-1">
                {options.filter((option) => option !== recommendedOption).map((option) => (
                  <li key={option.label}>
                    <button
                      type="button"
                      disabled={pendingId !== null}
                      onClick={() => onAct(approval, { label: option.label, option: option.label })}
                      className="inline-flex min-h-11 items-center font-medium text-steel hover:underline disabled:cursor-wait disabled:opacity-60"
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
}

/** A read-only row: the dashboard offers no control, only the command that answers it. */
export function ReadOnlyAnswer({ approval }: { approval: Approval }) {
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
