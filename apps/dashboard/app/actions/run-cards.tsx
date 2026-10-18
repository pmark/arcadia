"use client";

import { DecisionCards } from "../../components/decision-cards";
import { useDecisionCards } from "../../hooks/use-decision-cards";

/** Mounted only when the operator opens "Show decision cards", so nothing is fetched or polled before that. */
export function RunCards() {
  const cards = useDecisionCards();
  return <DecisionCards views={cards.views} pendingId={cards.pendingId} outcomes={cards.outcomes} onPress={(view, optionId) => void cards.press(view, optionId)} verbs={["run"]} heading="Run cards" />;
}
