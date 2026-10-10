import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { matchesTodoTarget, type Approval, type ApprovalList } from "../lib/approvals";
import type { Choice } from "../hooks/use-approvals";
import { cardKey } from "../hooks/use-approvals";
import { EmptyState, ErrorState } from "./dashboard-ui";
import { kindLabel, TodoCard } from "./todo-card";

export interface TodoCommon {
  pendingId: string | null;
  onAct: (approval: Approval, choice: Choice) => void;
  message: string | null;
  error: string | null;
  note: string | null;
  hasLoaded: boolean;
}

/** The groups the list shows, in order. Stale items are separate and collapsed. */
export function groupApprovals(approvals: Approval[]): { blocking: Approval[]; decisions: Approval[]; asks: Approval[]; others: Approval[]; stale: Approval[] } {
  const live = approvals.filter((approval) => !approval.staleReason);
  const rest = live.filter((approval) => !approval.blocking);
  return {
    blocking: live.filter((approval) => approval.blocking),
    decisions: rest.filter((approval) => approval.kind === "decision"),
    asks: rest.filter((approval) => approval.kind === "agent_ask"),
    others: rest.filter((approval) => approval.kind !== "decision" && approval.kind !== "agent_ask"),
    stale: approvals.filter((approval) => approval.staleReason)
  };
}

function Notices({ error, note, message }: Pick<TodoCommon, "error" | "note" | "message">) {
  return (
    <>
      {error ? <ErrorState title="To-dos unavailable" message={error} /> : null}
      {note ? <p role="status" className="mb-3 rounded-md border border-line bg-panel p-3 text-sm text-muted">{note}</p> : null}
      {message ? <p role="status" className="mb-3 flex items-center gap-2 text-sm text-moss"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{message}</p> : null}
    </>
  );
}

function Loading() {
  return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</p>;
}

/** The /todo list: single column, blocking first, then Decisions, Asks, others, with stale items collapsed. */
export function TodoListView({
  approvals,
  expandedKey,
  onToggle,
  ...common
}: TodoCommon & { approvals: Approval[]; expandedKey: string | null; onToggle: (key: string) => void }) {
  const groups = groupApprovals(approvals);
  const liveCount = approvals.length - groups.stale.length;
  const card = (approval: Approval) => (
    <TodoCard
      key={approval.todoKey}
      approval={approval}
      expanded={expandedKey === cardKey(approval)}
      onToggle={() => onToggle(cardKey(approval))}
      pendingId={common.pendingId}
      onAct={common.onAct}
      showLink
    />
  );
  const section = (label: string, items: Approval[]) =>
    items.length === 0 ? null : (
      <section aria-label={label} className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">{label} ({items.length})</h2>
        <div className="grid min-w-0 grid-cols-1 gap-3">{items.map(card)}</div>
      </section>
    );
  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">To-do</h1>
        <p className="mt-1 text-sm text-muted" data-testid="todo-summary">
          {common.hasLoaded
            ? `${groups.blocking.length} blocking · ${liveCount} waiting on you`
            : "Loading…"}
        </p>
      </header>
      <Notices error={common.error} note={common.note} message={common.message} />
      {!common.hasLoaded && !common.error ? (
        <Loading />
      ) : (
        <>
          {liveCount === 0 && !common.error ? <EmptyState text="Nothing is waiting on you." /> : null}
          {section("Blocking", groups.blocking)}
          {section("Decisions", groups.decisions)}
          {section("Agent Asks", groups.asks)}
          {section("Other", groups.others)}
          {groups.stale.length > 0 ? (
            <details className="mt-4">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold uppercase tracking-[0.14em] text-muted">Stale ({groups.stale.length})</summary>
              <div className="mt-3 grid min-w-0 grid-cols-1 gap-3">{groups.stale.map(card)}</div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface TodoTarget {
  kind: string;
  project: string;
  id: string;
  todoKey: string;
}

const BACK_LINK = "inline-flex min-h-11 items-center text-sm font-medium text-steel hover:underline";

/**
 * One item, expanded, at its own link. A pending item shows its controls; an
 * item that is no longer in the list renders "Done" rather than a 404, and only
 * a malformed link is "not found". "Done" is never claimed while the list could
 * not be read.
 */
export function TodoItemView({
  target,
  approvals,
  source,
  ...common
}: TodoCommon & { target: TodoTarget | null; approvals: Approval[]; source: ApprovalList["source"] | null }) {
  const back = <Link href="/todo" className={BACK_LINK}>All to-dos</Link>;
  if (!target) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-muted">This link is not a to-do address. Expected /todo/&lt;kind&gt;/&lt;project&gt;/&lt;id&gt;.</p>
        {back}
      </div>
    );
  }
  const found = approvals.find((approval) => matchesTodoTarget(approval, target));
  const heading = `${kindLabel(target.kind)} ${target.id}`;
  if (found) {
    return (
      <div>
        <div className="mb-3">{back}</div>
        <Notices error={common.error} note={common.note} message={common.message} />
        <TodoCard approval={found} expanded pendingId={common.pendingId} onAct={common.onAct} />
      </div>
    );
  }
  if (!common.hasLoaded) {
    return (
      <div>
        <div className="mb-3">{back}</div>
        <Notices error={common.error} note={null} message={null} />
        {common.error ? null : <Loading />}
      </div>
    );
  }
  // Review items come only from `arcadia todo`; if that read failed, an absent one is unknown, not done.
  if (source === "fallback" && target.kind !== "decision" && target.kind !== "agent_ask") {
    return (
      <div>
        <div className="mb-3">{back}</div>
        <Notices error={common.error} note={common.note} message={null} />
        <h1 className="text-xl font-semibold">{heading}</h1>
        <p className="mt-2 text-sm text-muted">The to-do list could not be read, so this item's state is unknown. Try again shortly.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3">{back}</div>
      <Notices error={common.error} note={null} message={common.message} />
      <section aria-label="Done" className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-moss">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Done
        </p>
        <h1 className="mt-1 break-words text-lg font-semibold">{heading}</h1>
        <p className="mt-1 break-all text-xs text-muted">{kindLabel(target.kind)} · {target.project} · <code className="text-ink">{target.id}</code></p>
        <p className="mt-2 text-sm text-muted">Nothing is waiting on you here. It is no longer in the pending list, so it was settled (or this link never matched an item).</p>
      </section>
    </div>
  );
}
