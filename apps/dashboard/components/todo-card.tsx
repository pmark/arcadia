import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
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
  return (
    <article id={anchorOf(approval)} className="min-w-0 scroll-mt-20 rounded-md border border-line bg-panel p-4 shadow-soft">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
        {kindLabel(approval.kind)} · {approval.project}
        {approval.blocking ? " · Blocking" : ""}
        {approval.staleReason ? " · Stale" : ""}
      </span>
      <h3 className="mt-1 break-words font-semibold">{approval.title}</h3>
      <p className="mt-1 break-all text-xs text-muted">
        {approval.kind === "decision" ? "Decision id" : "Id"}: <code className="text-ink">{approval.id}</code>
        {approval.requestId ? <> · Request id: <code className="text-ink">{approval.requestId}</code></> : null}
      </p>
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
      ) : askRecommendation ? (
        <p className="mt-2 text-sm text-muted">
          Recommended: <strong className="text-ink">{askRecommendation.label}</strong> — {askRecommendation.consequence}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {approval.readOnly ? null : approval.kind === "decision" ? (
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
            <button type="button" disabled={pendingId !== null} onClick={() => onAct(approval, { label: "Accept", disposition: "accepted" })} className={PRIMARY_BUTTON}>
              {pendingId === `${key}:Accept` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Accept
            </button>
            <button type="button" disabled={pendingId !== null} onClick={() => onAct(approval, { label: "Reject", disposition: "rejected" })} className={SECONDARY_BUTTON}>
              {pendingId === `${key}:Reject` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Reject
            </button>
          </>
        )}
        {approval.readOnly || !onToggle ? null : (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-steel hover:underline"
          >
            Details {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
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
