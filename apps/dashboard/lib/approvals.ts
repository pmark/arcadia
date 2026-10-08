import type { AgentAskPendingItem, OpenDecisionItem, OperatorTodoItem } from "./arcadia-cli";

export type ApprovalOption = { label: string; consequence: string; recommended: boolean };

/**
 * One row of the operator's list. Decisions and Agent Asks carry the settle
 * controls the dashboard has always had (`readOnly: false`); every other kind
 * from `arcadia todo` (review items, anything newer) is shown read-only with
 * the command that answers it.
 */
export interface Approval {
  kind: "agent_ask" | "decision" | "review_item";
  id: string;
  project: string;
  title: string;
  detail: string | null;
  gateQuestion: string | null;
  options: ApprovalOption[];
  evidence: string[];
  /** Evidence the Decision or Agent Ask itself cites, from `arcadia todo`; distinct from `evidence` (what settling will change). */
  sourceEvidence: string[];
  /** What settling this costs to run — both settlement paths are deterministic CLI writes, never a model call. */
  cost: string;
  createdAt: string;
  /** True when the dashboard offers no control for this row; answer it with `answer`. */
  readOnly: boolean;
  /** Blocking per `arcadia todo`; false when the to-do list did not list the row. */
  blocking: boolean;
  /** Positive evidence the row no longer waits on the operator (`arcadia todo --all`). */
  staleReason: string | null;
  /** The canonical command that answers the row, when `arcadia todo` supplied one. */
  answer: string | null;
  answerVia: string[];
  /** review_item only: what raised it. */
  origin: string | null;
}

export const NO_MODEL_COST = "Deterministic — a CLI write, no model call.";
const READ_ONLY_COST = "Read-only here — answer it with the command shown.";

export function todoKeyOf(kind: "decision" | "agent_ask", project: string, id: string): string {
  return `${kind}:${project || "unknown"}/${id}`;
}

function toAgentAskApproval(item: AgentAskPendingItem): Approval {
  return {
    kind: "agent_ask",
    id: item.proposalId,
    project: item.project,
    title: item.desiredResult,
    detail: item.rationale,
    gateQuestion: item.gateQuestion,
    options: item.options,
    evidence: item.effects,
    sourceEvidence: [],
    cost: NO_MODEL_COST,
    createdAt: item.createdAt,
    readOnly: false,
    blocking: false,
    staleReason: null,
    answer: null,
    answerVia: [],
    origin: null
  };
}

function toDecisionApproval(item: OpenDecisionItem): Approval {
  return {
    kind: "decision",
    id: item.id,
    project: item.projectSlug,
    title: item.question,
    detail: item.recommendation,
    gateQuestion: item.gateQuestion,
    options: item.options,
    evidence: [],
    sourceEvidence: [],
    cost: NO_MODEL_COST,
    createdAt: item.updated,
    readOnly: false,
    blocking: false,
    staleReason: null,
    answer: null,
    answerVia: [],
    origin: null
  };
}

/** The id part of a to-do key (`<kind>:<project>/<id>`) after the first slash. */
function idOfTodo(item: OperatorTodoItem): string {
  const slash = item.key.indexOf("/");
  return slash >= 0 ? item.key.slice(slash + 1) : item.key;
}

/** An evidence entry as one line of text. */
function evidenceLines(item: OperatorTodoItem): string[] {
  return (item.evidence ?? []).map((entry) => `${entry.text}${entry.status ? ` [${entry.status}]` : ""}${entry.note ? ` — ${entry.note}` : ""}`);
}

function toReadOnlyApproval(item: OperatorTodoItem): Approval {
  return {
    kind: item.kind,
    id: idOfTodo(item),
    project: item.project,
    title: item.title,
    detail: null,
    gateQuestion: item.gateQuestion ?? null,
    options: item.options ?? [],
    evidence: [],
    sourceEvidence: evidenceLines(item),
    cost: READ_ONLY_COST,
    createdAt: item.createdAt,
    readOnly: true,
    blocking: item.blocking,
    staleReason: item.staleReason ?? null,
    answer: item.answer,
    // A read-only row has no dashboard control, so a dashboard path `arcadia todo` lists for it is not offered here.
    answerVia: (item.answerVia ?? []).filter((line) => !line.startsWith("Dashboard:")),
    origin: item.origin ?? null
  };
}

export interface ApprovalSources {
  /** Null when `decision list` failed; `loadError` says why. */
  asks: AgentAskPendingItem[] | null;
  decisions: OpenDecisionItem[] | null;
  /** Null when `arcadia todo` failed; `todoError` says why. */
  todo: { items: OperatorTodoItem[]; unavailable: string[] } | null;
  loadError?: string;
  todoError?: string;
}

export interface ApprovalList {
  approvals: Approval[];
  /** A visible caveat the page must show above the list, or null when the list is complete. */
  note: string | null;
  /** "todo" when `arcadia todo` supplied the list; "fallback" when it failed and the old loaders stand alone. */
  source: "todo" | "fallback";
}

/**
 * The one list. Every Decision and Agent Ask the old loaders return stays,
 * with its options and settle controls, whatever `arcadia todo` says (parity);
 * the to-do list adds blocking/stale marks, its answer command, and the
 * kinds the old loaders never had. A to-do Decision or Ask the loaders did not
 * return still appears, read-only, rather than being dropped. When the to-do
 * call failed the old loaders stand alone and `note` says so; the list is never
 * silently empty.
 */
export function buildApprovals(sources: ApprovalSources): ApprovalList {
  const legacy: Approval[] = [
    ...(sources.asks ?? []).map(toAgentAskApproval),
    ...(sources.decisions ?? []).map(toDecisionApproval)
  ];
  const notes: string[] = [];
  const todo = sources.todo;

  if (!todo) {
    notes.push(
      `The arcadia to-do list could not be read (${sources.todoError ?? "unknown error"}), so only Decisions and Agent Asks are shown. Review items are missing from this list.`
    );
  } else {
    const byKey = new Map(todo.items.map((item) => [item.key, item]));
    const claimed = new Set<string>();
    for (const row of legacy) {
      const key = todoKeyOf(row.kind as "decision" | "agent_ask", row.project, row.id);
      const match = byKey.get(key);
      if (!match) continue;
      claimed.add(key);
      row.blocking = match.blocking;
      row.staleReason = match.staleReason ?? null;
      row.answer = match.answer;
      // The legacy loaders win; to-do's own record only fills what they lack.
      if (row.options.length === 0 && match.options) row.options = match.options;
      if (!row.gateQuestion && match.gateQuestion) row.gateQuestion = match.gateQuestion;
      row.sourceEvidence = evidenceLines(match);
    }
    for (const item of todo.items) {
      if (!claimed.has(item.key)) legacy.push(toReadOnlyApproval(item));
    }
    for (const line of todo.unavailable) notes.push(`The to-do list could not read a source: ${line}`);
  }
  if (sources.loadError) {
    notes.push(`Settle controls are unavailable (${sources.loadError}); Decisions and Agent Asks are read-only until this clears.`);
  }

  const approvals = legacy.sort(
    (a, b) => Number(b.blocking) - Number(a.blocking) || Number(Boolean(a.staleReason)) - Number(Boolean(b.staleReason)) || b.createdAt.localeCompare(a.createdAt)
  );
  return { approvals, note: notes.length > 0 ? notes.join(" ") : null, source: todo ? "todo" : "fallback" };
}
