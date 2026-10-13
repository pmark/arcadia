"use client";

import { useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import { TodoListView } from "../../components/todo-views";
import { DecisionCards } from "../../components/decision-cards";
import { useApprovals } from "../../hooks/use-approvals";
import { useDecisionCards } from "../../hooks/use-decision-cards";

/** Everything waiting on the operator, phone-first: one column, blocking first. */
export default function TodoPage() {
  const state = useApprovals();
  const cards = useDecisionCards();
  // A Decision that has a pressable card is answered there; every other item keeps its existing row, unchanged.
  const answeredByCard = new Set(
    cards.views.flatMap((view) => (view.duplicates !== null && Object.keys(view.pressable).length > 0 ? [`${view.duplicates.project}:${view.duplicates.id}`] : []))
  );
  const approvals = state.approvals.filter((approval) => !(approval.kind === "decision" && answeredByCard.has(`${approval.project}:${approval.id}`)));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  return (
    <MobileShell>
      <DecisionCards views={cards.views} pendingId={cards.pendingId} outcomes={cards.outcomes} onPress={(view, optionId) => void cards.press(view, optionId)} />
      <TodoListView
        approvals={approvals}
        expandedKey={expandedKey}
        onToggle={(key) => setExpandedKey((current) => (current === key ? null : key))}
        pendingId={state.pendingId}
        onAct={state.act}
        message={state.message}
        error={state.error}
        note={state.note}
        hasLoaded={state.hasLoaded}
      />
    </MobileShell>
  );
}
