"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MobileShell } from "../../components/mobile-shell";
import { TodoListView } from "../../components/todo-views";
import { DecisionCards, DecisionRecordsUnderCards } from "../../components/decision-cards";
import { NextSteps } from "../../components/next-steps";
import { useNextSteps } from "../../hooks/use-next-steps";
import { useApprovals } from "../../hooks/use-approvals";
import { useDecisionCards } from "../../hooks/use-decision-cards";
import { legacyBadges, splitLegacyDecisions } from "../../lib/decision-cards";
import { decisionTodoHrefFromHash } from "../../lib/decision-summary";

/**
 * A `#card-…` link that names a Decision opens that Decision's own short page instead of the whole list, whichever way
 * it arrives. The URL is replaced, so Back returns to where the operator was and never bounces through here again. The
 * list and its reads don't start until that has been checked.
 */
export default function TodoPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"checking" | "opening" | "list">("checking");
  useEffect(() => {
    const open = (): boolean => {
      const href = decisionTodoHrefFromHash(window.location.hash);
      if (href === null) return false;
      setMode("opening");
      router.replace(href);
      return true;
    };
    if (!open()) setMode("list");
    const onHashChange = () => void open();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [router]);
  if (mode === "list") return <TodoList />;
  return (
    <MobileShell deferMenuData>
      <p role="status" aria-live="polite" className="text-sm text-muted">{mode === "opening" ? "Opening this Decision..." : "Opening your to-do list..."}</p>
    </MobileShell>
  );
}

/** Everything waiting on the operator, phone-first: one column, blocking first. */
function TodoList() {
  const state = useApprovals();
  const cards = useDecisionCards();
  const nextSteps = useNextSteps();
  // A Decision that has a pressable card is answered there and its row is kept collapsed under the cards; every other
  // item, including a Decision whose card is stale, refused or unavailable, keeps its existing row, unchanged.
  const { remaining, underCards } = splitLegacyDecisions(state.approvals, cards.views);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  return (
    <MobileShell>
      <NextSteps data={nextSteps.data} failed={nextSteps.failed} />
      <DecisionCards views={cards.views} refused={cards.refused} badges={legacyBadges(underCards)} pendingId={cards.pendingId} outcomes={cards.outcomes} onPress={(view, optionId) => void cards.press(view, optionId)} />
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
