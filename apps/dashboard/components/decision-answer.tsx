"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Approval } from "../lib/approvals";
import type { DecisionCardRefusalView, DecisionCardView } from "../lib/decision-cards";
import type { DecisionCardMeta } from "../lib/decision-cards-server";
import type { DecisionRecord } from "../lib/decision-record-server";
import { optionClampLines, summarizeDecision, type DecisionSummaryOption } from "../lib/decision-summary";
import type { Choice } from "../hooks/use-approvals";
import type { CardOutcome } from "./decision-cards";
import { TodoCard } from "./todo-card";

// The document's renderer stays out of the first view's script: only someone who asks to read a record pays for it.
const MarkdownBody = dynamic(() => import("./markdown-body").then((module) => module.MarkdownBody), {
  ssr: false,
  loading: () => <Activity>Getting the record ready...</Activity>
});

/** A specific line about what's happening right now. */
export function Activity({ children }: { children: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {children}
    </p>
  );
}

const CLAMP: Record<number, string> = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4" };
const REFUSAL_WITH_NO_CONTROL = "no_options";

export interface DecisionAnswerViewProps {
  project: string;
  id: string;
  /** The to-do row: blocking and stale state, and what's shown until the card arrives. */
  row: Approval | null;
  /** True once the row's read has answered, whichever way. */
  rowSettled: boolean;
  view: DecisionCardView | null;
  meta: DecisionCardMeta | null;
  cardLoaded: boolean;
  cardFailed: boolean;
  refusal: DecisionCardRefusalView | null;
  pendingId: string | null;
  outcome: CardOutcome | undefined;
  onPress: (view: DecisionCardView, optionId: string) => void;
  /** The to-do row's existing control, for a Decision that gets no pinned card. */
  rowPendingId: string | null;
  onRowAct: (approval: Approval, choice: Choice) => void;
  rowMessage: string | null;
  rowError: string | null;
  rowNote: string | null;
}

/**
 * The short view of a Decision. It shows the record's question and every option's consequence, compact enough for one
 * phone screen, and answers through the existing pinned press.
 *
 * What a press is bound to has not moved: an Answer button exists only once an option is chosen, and choosing one opens
 * the whole question and every option's whole consequence, the same text the card's pins bind. Before that the text is
 * only clamped by CSS, never cut, so it's all in the page. When the pinned card changes, the choice is dropped and has
 * to be made again against the new text.
 */
export function DecisionAnswerView(props: DecisionAnswerViewProps) {
  const { project, id, row, rowSettled, view, meta, cardLoaded, cardFailed, refusal, pendingId, outcome, onPress } = props;
  const stateHash = view?.card.pins.stateHash ?? null;
  const [chosen, setChosen] = useState<{ optionId: string; stateHash: string | null } | null>(null);
  const [answeredLabel, setAnsweredLabel] = useState<string | null>(null);
  const answerRef = useRef<HTMLButtonElement | null>(null);
  const changed = chosen !== null && chosen.stateHash !== stateHash;
  const chosenId = chosen !== null && !changed ? chosen.optionId : null;

  useEffect(() => {
    if (chosenId !== null) answerRef.current?.scrollIntoView({ block: "nearest" });
  }, [chosenId]);

  // Only the pinned card's text may sit beside an Answer button. The row's is shown only until the card arrives.
  const summary = summarizeDecision({
    question: meta?.question ?? row?.title,
    gateQuestion: meta?.gateQuestion ?? row?.gateQuestion,
    recommendation: meta?.recommendation ?? row?.detail,
    options: view ? view.card.options : row?.options,
    recommendedLabels: meta?.recommendedLabels ?? row?.options?.filter((option) => option.recommended).map((option) => option.label)
  });
  const expanded = chosenId !== null;
  const answered = outcome?.ok === true;
  const pressable = view !== null && !answered ? view.pressable : {};
  const notOpen = cardLoaded && !cardFailed && meta === null && view === null;
  const noOptions = refusal?.reason === REFUSAL_WITH_NO_CONTROL || (cardLoaded && !cardFailed && view === null && !refusal && summary.options.length === 0);
  // A Decision refused a pinned card keeps its row's existing control, as the to-do list has always done. A failed read is
  // not a refusal, so it never moves a Decision to the unpinned path: it says so and the next read tries again.
  const fallback = row !== null && !notOpen && !noOptions && view === null && refusal !== null;
  const readFailed = cardFailed && view === null;
  const blocked = view !== null && !answered && Object.keys(view.pressable).length === 0 ? view.notExecutableReason : null;
  const heading = meta?.id ?? row?.id ?? id;
  const clampLines = optionClampLines(summary.options.length);

  return (
    <article aria-label={`Decision ${heading}`} data-testid="decision-answer" className="-mb-8">
      <div className="-mt-5 mb-1 flex min-h-11 items-center gap-x-2 text-sm">
        <Link href="/todo" className="inline-flex min-h-11 shrink-0 items-center font-medium text-steel hover:underline">All to-dos</Link>
        <span className="min-w-0 truncate text-xs text-muted">Decision {heading} · {project}</span>
        {row?.blocking && !row.staleReason ? <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">Blocking</span> : null}
      </div>
      {row?.staleReason ? <p className="mb-2 break-words text-sm text-muted">Stale: {row.staleReason}</p> : null}

      {summary.headline !== null ? (
        <h1 className={`text-base font-semibold leading-snug [overflow-wrap:anywhere] ${expanded ? "" : "line-clamp-4"}`} data-testid="decision-question">
          {summary.headline}
          {summary.rest !== null ? <span className={expanded ? "font-normal" : "sr-only"}> {summary.rest}</span> : null}
        </h1>
      ) : (
        <h1 className="text-base font-semibold" data-testid="decision-question">Decision {heading}</h1>
      )}
      {summary.kind === "title" ? <p className="mt-1 text-xs text-muted">The record gives only this title, not a full question.</p> : null}
      {summary.kind === "none" && (row !== null || meta !== null) ? <p className="mt-1 text-xs text-muted">The record states no question.</p> : null}
      {summary.gateQuestion !== null ? <p className={`mt-1 text-sm text-muted [overflow-wrap:anywhere] ${expanded ? "" : "line-clamp-2"}`} data-testid="decision-gate-question">Its gate asks: {summary.gateQuestion}</p> : null}

      {summary.options.length > 0 ? (
        <ul className="mt-2 grid min-w-0 grid-cols-1 gap-1" aria-label="Options">
          {summary.options.map((option) => (
            <OptionRow
              key={option.id ?? option.label}
              option={option}
              clampLines={clampLines}
              expanded={expanded}
              chosen={option.id !== null && option.id === chosenId && pressable[option.id] !== undefined}
              selectable={option.id !== null && pressable[option.id] !== undefined && rowSettled}
              answered={answered && answeredLabel === option.label}
              pending={pendingId !== null}
              working={view !== null && pendingId === `${view.card.id}:${option.id}`}
              answerRef={answerRef}
              onChoose={() => setChosen(option.id === chosenId ? null : { optionId: option.id as string, stateHash })}
              onAnswer={() => {
                if (view === null || option.id === null) return;
                setAnsweredLabel(option.label);
                onPress(view, option.id);
              }}
            />
          ))}
        </ul>
      ) : null}
      {summary.recommendation !== null ? <p className="mt-2 line-clamp-4 text-sm text-muted [overflow-wrap:anywhere]">The record recommends: {summary.recommendation}</p> : null}

      <div className="mt-2 grid gap-1.5" aria-live="polite">
        {!cardLoaded && !fallback ? <Activity>{row ? "Getting the answer buttons ready..." : "Reading this Decision..."}</Activity> : null}
        {cardLoaded && !rowSettled && !answered ? <Activity>Checking whether this is still waiting on you...</Activity> : null}
        {changed ? <p role="alert" className="text-sm text-clay">This Decision changed while you were reading it. Read it again and choose.</p> : null}
        {readFailed ? <p role="alert" className="text-sm text-clay">{refusal ? "Couldn't read this Decision again just now, so what's below may be out of date. Trying again every 15 seconds." : "Couldn't read this Decision's answer buttons, so nothing can be pressed yet. Trying again every 15 seconds."}</p> : null}
        {refusal && !noOptions ? <p className="text-sm text-muted">No pinned answer button here ({refusal.reason}): <span className="break-words">{refusal.message}</span></p> : null}
        {notOpen ? <p className="text-sm text-muted">This Decision isn&apos;t open any more. Nothing here can answer it.</p> : null}
        {noOptions && !notOpen ? <p className="text-sm text-muted">This Decision offers no options to answer between, so there&apos;s nothing to press here. Its full record may say more.</p> : null}
        {blocked ? <p className="text-sm text-muted">{blocked}</p> : null}
        {outcome && !outcome.ok && pendingId === null ? <p role="alert" className="break-words text-sm text-clay" data-testid="decision-refused">Refused ({outcome.reason ?? "unknown"}): {outcome.message}</p> : null}
        {answered ? (
          <p role="status" className="flex items-start gap-2 text-sm text-moss" data-testid="decision-answered">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">Answered{answeredLabel ? `: ${answeredLabel}` : ""}. Nothing else is needed here.</span>
          </p>
        ) : null}
      </div>

      {fallback && row ? <RowControl {...props} row={row} /> : null}

      <FullRecord project={project} id={id} row={row} meta={meta} hint={Object.keys(pressable).length > 0 && !expanded} />
    </article>
  );
}

function OptionRow({ option, clampLines, expanded, chosen, selectable, answered, pending, working, answerRef, onChoose, onAnswer }: {
  option: DecisionSummaryOption;
  clampLines: 2 | 3 | 4;
  expanded: boolean;
  chosen: boolean;
  selectable: boolean;
  answered: boolean;
  pending: boolean;
  working: boolean;
  answerRef: RefObject<HTMLButtonElement | null>;
  onChoose: () => void;
  onAnswer: () => void;
}) {
  const body = (
    <>
      <span className={`text-sm font-semibold [overflow-wrap:anywhere] ${expanded ? "block" : "line-clamp-2"}`}>
        {option.recommended ? <span className="mr-1 text-xs font-semibold text-moss">Recommended:</span> : null}
        {option.label}
      </span>
      <span className={`mt-0.5 text-sm leading-snug text-muted [overflow-wrap:anywhere] ${expanded ? "block" : CLAMP[clampLines]}`} data-testid="decision-consequence">
        {option.consequence ?? <em>The record states no consequence for this option.</em>}
      </span>
    </>
  );
  const frame = `w-full rounded-md border bg-panel p-2 text-left ${chosen || answered ? "border-steel ring-1 ring-steel" : "border-line"}`;
  return (
    <li className="min-w-0" data-testid="decision-option">
      {selectable ? (
        <button type="button" aria-pressed={chosen} disabled={pending} onClick={onChoose} className={`${frame} block min-h-11 disabled:opacity-60`}>{body}</button>
      ) : (
        <div className={frame}>{body}</div>
      )}
      {chosen ? (
        <button
          ref={answerRef}
          type="button"
          disabled={pending}
          onClick={onAnswer}
          data-testid="decision-answer-button"
          className="mt-1.5 block min-h-11 w-full min-w-0 scroll-mb-4 rounded-md bg-steel px-3 py-2 text-center text-sm font-semibold text-white transition [overflow-wrap:anywhere] hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
        >
          {working ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin align-text-bottom motion-reduce:animate-none" aria-hidden="true" /> : null}
          {working ? "Writing your answer..." : `Answer: ${option.label}`}
        </button>
      ) : null}
    </li>
  );
}

/** A Decision refused a pinned card: its row's existing control, one tap away and otherwise unchanged. */
function RowControl({ row, rowPendingId, onRowAct, rowMessage, rowError, rowNote }: DecisionAnswerViewProps & { row: Approval }) {
  return (
    <div className="mt-2" data-testid="decision-row-control">
      {rowNote ? <p role="status" className="mt-1 text-sm text-muted">{rowNote}</p> : null}
      {rowError ? <p role="alert" className="mt-1 break-words text-sm text-clay">{rowError}</p> : null}
      {rowMessage ? <p role="status" className="mt-1 text-sm text-moss">{rowMessage}</p> : null}
      <details className="mt-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-steel">Answer from the to-do card</summary>
        <TodoCard approval={row} expanded pendingId={rowPendingId} onAct={onRowAct} />
      </details>
    </div>
  );
}

type RecordState = { kind: "closed" } | { kind: "reading" } | { kind: "ready"; record: DecisionRecord } | { kind: "failed"; message: string };

export function decisionRecordUrl(project: string, id: string): string {
  return `/api/todo-item/decision/record?project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`;
}

/** The whole document, read only when asked for. Nothing about answering depends on it. */
function FullRecord({ project, id, row, meta, hint }: { project: string; id: string; row: Approval | null; meta: DecisionCardMeta | null; hint: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RecordState>({ kind: "closed" });
  const read = useCallback(async () => {
    setState({ kind: "reading" });
    try {
      const response = await fetch(decisionRecordUrl(project, id), { cache: "no-store" });
      const body = (await response.json()) as DecisionRecord & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The full record could not be read.");
      setState({ kind: "ready", record: body });
    } catch (error) {
      setState({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }, [project, id]);
  const toggle = () => {
    setOpen((current) => !current);
    if (state.kind === "closed") void read();
  };
  const gate = meta?.gateQuestion ?? row?.gateQuestion;
  const recommendation = meta?.recommendation ?? row?.detail;
  const evidence = row?.sourceEvidence ?? [];
  return (
    <section aria-label="Full record" className="mt-1">
      <div className="flex items-center justify-between gap-x-3">
        {hint ? <p className="min-w-0 truncate text-xs text-muted">Tap one to read and answer.</p> : null}
        <button type="button" aria-expanded={open} onClick={toggle} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-medium text-steel hover:underline">
          {open ? "Hide the full record" : "Read the full record"}
          {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {open ? (
        <div className="mt-1 grid gap-2 border-t border-line pt-2 text-sm text-muted" data-testid="decision-record">
          {state.kind === "reading" ? <Activity>Reading the full record...</Activity> : null}
          {state.kind === "failed" ? (
            <div role="alert">
              <p className="break-words text-clay">{state.message}</p>
              <button type="button" onClick={() => void read()} className="mt-1 inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm font-semibold text-ink">Try again</button>
            </div>
          ) : null}
          {recommendation ? <p className="break-words">Recommendation: {recommendation}</p> : null}
          {gate ? <p className="break-words">Gate: {gate}</p> : null}
          {row?.cost ? <p className="break-words">Cost: {row.cost}</p> : null}
          {evidence.length > 0 ? (
            <div>
              <p className="font-semibold text-ink">Evidence:</p>
              <ul className="ml-4 list-disc">{evidence.map((line, index) => <li key={index} className="break-words">{line}</li>)}</ul>
            </div>
          ) : null}
          {row?.answer ? <p>From a terminal: <code className="break-all text-xs text-ink">{row.answer}</code></p> : null}
          {state.kind === "ready" ? (
            <>
              <p className="break-all text-xs">{state.record.relativePath} · updated {state.record.updated}</p>
              <div className="text-ink"><MarkdownBody text={state.record.markdown} /></div>
              {state.record.frontMatter ? (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-steel">Record fields</summary>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-2 text-xs text-ink">{state.record.frontMatter}</pre>
                </details>
              ) : null}
              {state.record.truncated ? <p>This document is too long to show whole here. Read the rest in {state.record.relativePath}.</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
