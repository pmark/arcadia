"use client";

import { useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import { TodoListView } from "../../components/todo-views";
import { DecisionCards, DecisionRecordsUnderCards } from "../../components/decision-cards";
import { useApprovals } from "../../hooks/use-approvals";
import { useDecisionCards } from "../../hooks/use-decision-cards";
import { splitLegacyDecisions } from "../../lib/decision-cards";

/** Everything waiting on the operator, phone-first: one column, blocking first. */
export default function TodoPage() {
  const state = useApprovals();
  const cards = useDecisionCards();
  // A Decision that has a pressable card is answered there and its row is kept collapsed under the cards; every other
  // item, including a Decision whose card is stale, refused or unavailable, keeps its existing row, unchanged.
  const { remaining, underCards } = splitLegacyDecisions(state.approvals, cards.views);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  return (
    <MobileShell>
      <DecisionCards views={cards.views} refused={cards.refused} pendingId={cards.pendingId} outcomes={cards.outcomes} onPress={(view, optionId) => void cards.press(view, optionId)} />
      <DecisionRecordsUnderCards approvals={underCards} />
      <TodoListView
        approvals={remaining}
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
