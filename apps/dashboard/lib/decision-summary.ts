/**
 * The short view of a Decision, derived only from what its record already holds. No model call, nothing invented:
 * where the record has no clean question or no consequence, the summary says so instead of filling the gap. Every word
 * it returns is the record's own, in the record's order. `rest` keeps whatever `headline` leaves out, so the caller can
 * always show all of it.
 *
 * The record's question is always the one shown, however thin, because it's what a card's pin binds: an operator must
 * never answer with some other text standing in for it. A worded gate question only ever appears beside it.
 */
import { decodeIdPart } from "./decision-cards";
import { todoHrefOf } from "./approvals";

/** "question": reads as a question or a sentence. "title": only a few words of title. "none": the record holds no text. */
export type QuestionKind = "question" | "title" | "none";

export interface DecisionSummaryOption {
  /** The card's option id when this option comes from a pinned card; null when it comes from the to-do row. */
  id: string | null;
  label: string;
  /** Null when the record states none. Otherwise the text exactly as the record holds it, only trimmed. */
  consequence: string | null;
  recommended: boolean;
}

export interface DecisionSummary {
  kind: QuestionKind;
  /** The first sentence of the question, or the whole of a short one; null when the record has none. */
  headline: string | null;
  /** The rest of the question after the first sentence; null when nothing is left. */
  rest: string | null;
  /** The record's gate question, when it's in words and the question itself is only a title or absent. Extra, never a substitute. */
  gateQuestion: string | null;
  options: DecisionSummaryOption[];
  /** The record's recommendation, kept only when there are no options to carry it. */
  recommendation: string | null;
}

export interface DecisionSummaryInput {
  question?: string | null;
  gateQuestion?: string | null;
  recommendation?: string | null;
  options?: ReadonlyArray<{ id?: string; label?: string | null; consequence?: string | null; recommended?: boolean }> | null;
  /** Labels the record marks recommended; a pinned card's options carry no such flag. */
  recommendedLabels?: ReadonlyArray<string>;
}

/** A full stop after these does not end a sentence. */
const NOT_A_SENTENCE_END = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|no|nos|dr|mr|mrs|ms|st|pr|[A-Za-z])\.$/i;

const tidy = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

/** Split at the first real sentence end. Text with no clear one stays whole; a caller clamps it visually if it's long. */
export function splitFirstSentence(text: string): { head: string; rest: string | null } {
  const boundary = /[.?!]+["')\]]*(?=\s+["'([`A-Z0-9])/g;
  for (let match = boundary.exec(text); match !== null; match = boundary.exec(text)) {
    const head = text.slice(0, match.index + match[0].length);
    if (NOT_A_SENTENCE_END.test(head)) continue;
    const rest = text.slice(head.length).trim();
    return { head, rest: rest === "" ? null : rest };
  }
  return { head: text, rest: null };
}

/** A gate question is either an enum like `approval_boundary` or real words; only real words ending in "?" are shown. */
const isWordedQuestion = (value: string): boolean => value.endsWith("?") && /\s/.test(value);

function classify(question: string): QuestionKind {
  if (question === "") return "none";
  if (question.endsWith("?")) return "question";
  return question.split(" ").length >= 5 ? "question" : "title";
}

export function summarizeDecision(input: DecisionSummaryInput): DecisionSummary {
  const question = tidy(input.question);
  const gate = tidy(input.gateQuestion);
  const kind = classify(question);
  const { head, rest } = question === "" ? { head: null, rest: null } : splitFirstSentence(question);
  const recommended = new Set((input.recommendedLabels ?? []).map((label) => label.trim().toLowerCase()));
  const options = (input.options ?? []).flatMap((option): DecisionSummaryOption[] => {
    const label = (option.label ?? "").trim();
    if (label === "") return [];
    const consequence = (option.consequence ?? "").trim();
    return [{
      id: option.id ?? null,
      label,
      consequence: consequence === "" ? null : consequence,
      recommended: option.recommended === true || recommended.has(label.toLowerCase())
    }];
  });
  const recommendation = tidy(input.recommendation);
  return { kind, headline: head, rest, gateQuestion: kind !== "question" && isWordedQuestion(gate) ? gate : null, options, recommendation: options.length === 0 && recommendation !== "" ? recommendation : null };
}

/** How tightly an option is clamped before it's chosen, so that a whole Decision fits one phone screen. */
export function optionClampLines(optionCount: number): 2 | 3 | 4 {
  return optionCount >= 4 ? 2 : optionCount === 3 ? 3 : 4;
}

/**
 * The Decision page a `#card-…` link names, or null when the fragment is any other card. Only an id in the exact form
 * `decisionCardKey` builds qualifies, and every part must encode back to itself, so nothing else can be misread as one.
 */
export function decisionTodoHrefFromHash(hash: string): string | null {
  if (!hash.startsWith("#card-")) return null;
  let cardId: string;
  try {
    cardId = decodeURIComponent(hash.slice("#card-".length));
  } catch {
    return null;
  }
  const match = /^decision-k\.([^.]+)\.([^.]+)$/.exec(cardId);
  if (match === null) return null;
  const project = decodeIdPart(match[1]);
  const id = decodeIdPart(match[2]);
  return project === null || id === null ? null : todoHrefOf("decision", project, id);
}
