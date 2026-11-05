"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DecisionAnswerView } from "../../../../components/decision-answer";
import { MobileShell } from "../../../../components/mobile-shell";
import { TodoItemView } from "../../../../components/todo-views";
import { useApprovals } from "../../../../hooks/use-approvals";
import { useDecisionCards } from "../../../../hooks/use-decision-cards";
import { matchesTodoTarget, parseTodoPath, todoItemUrl } from "../../../../lib/approvals";
import type { DecisionCardMeta } from "../../../../lib/decision-cards-server";

type Target = NonNullable<ReturnType<typeof parseTodoPath>>;

/** The deep-link target for one to-do: /todo/<kind>/<project>/<id>. */
export default function TodoItemPage() {
  const params = useParams<{ kind?: string; id?: string[] }>();
  const target = parseTodoPath(params?.kind, params?.id);
  if (target?.kind === "decision") return <DecisionItem key={target.todoKey} target={target} />;
  return <OtherItem target={target} />;
}

function OtherItem({ target }: { target: Target | null }) {
  const state = useApprovals({ enabled: target !== null, url: target ? todoItemUrl(target) : undefined });
  return (
    <MobileShell deferMenuData>
      <TodoItemView
        target={target}
        approvals={state.approvals}
        source={state.source}
        pendingId={state.pendingId}
        onAct={state.act}
        message={state.message}
        error={state.error}
        note={state.note}
        hasLoaded={state.hasLoaded}
        onRetry={() => void state.refresh()}
        readingLabel={target ? `Reading this ${target.kind === "agent_ask" ? "request" : "to-do"}...` : undefined}
      />
    </MobileShell>
  );
}

const SLOW_READ_MS = 8_000;

/**
 * A Decision: the shell at once, then the short view, filled by two small reads that don't wait for each other. The row
 * can come from a cached list in milliseconds; the card pins the answer and needs a fresh read of the record.
 */
function DecisionItem({ target }: { target: Target }) {
  const state = useApprovals({ url: todoItemUrl(target) });
  const cards = useDecisionCards<DecisionCardMeta>({ url: `/api/todo-item/decision?project=${encodeURIComponent(target.project)}&id=${encodeURIComponent(target.id)}` });
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_READ_MS);
    return () => clearTimeout(timer);
  }, []);

  const row = state.approvals.find((approval) => approval.todoKey === target.todoKey) ?? state.approvals.find((approval) => matchesTodoTarget(approval, target)) ?? null;
  const view = cards.views[0] ?? null;
  // An answered Decision leaves the open list; keep what it asked on screen beside the receipt.
  const answered = view !== null && cards.outcomes[view.card.id]?.ok === true;
  const meta = cards.decision ?? (answered ? cards.lastDecision : null);
  const refusal = cards.refused[0] ?? null;
  const rowSettled = state.hasLoaded || state.error !== null;
  const known = row !== null || meta !== null || view !== null;
  return (
    <div data-theme-scope="auto">
      <MobileShell deferMenuData>
        {known ? (
          <DecisionAnswerView
            project={target.project}
            id={target.id}
            row={row}
            rowSettled={rowSettled}
            view={view}
            meta={meta}
            cardLoaded={cards.loaded}
            cardFailed={cards.readFailed}
            refusal={refusal}
            pendingId={cards.pendingId}
            outcome={view ? cards.outcomes[view.card.id] : undefined}
            onPress={(pressed, optionId) => void cards.press(pressed, optionId)}
            rowPendingId={state.pendingId}
            onRowAct={state.act}
            rowMessage={state.message}
            rowError={state.error}
            rowNote={state.note}
          />
        ) : (
          // Nothing known yet: the same truthful states as every other to-do. Done is claimed only from a complete list,
          // and never while the card's own read could still say it's open.
          <TodoItemView
            target={target}
            approvals={state.approvals}
            source={state.source}
            pendingId={state.pendingId}
            onAct={state.act}
            message={state.message}
            error={state.error}
            note={state.note}
            hasLoaded={state.hasLoaded && cards.loaded}
            onRetry={() => void state.refresh()}
            readingLabel={slow ? "Still reading this Decision. Your tap was received; this read is slow right now." : "Reading this Decision..."}
          />
        )}
      </MobileShell>
    </div>
  );
}
