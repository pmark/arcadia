"use client";

import { useCallback, useEffect, useState } from "react";
import type { DecisionCardRefusalView, DecisionCardView } from "../lib/decision-cards";
import type { CardOutcome } from "../components/decision-cards";

const POLL_MS = 15_000;

/** Reads current cards and presses one: the press body is exactly {cardId, fingerprint}. */
export function useDecisionCards() {
  const [views, setViews] = useState<DecisionCardView[]>([]);
  const [refused, setRefused] = useState<DecisionCardRefusalView[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // A card that was just answered or run leaves the list on the next read; keep it, un-pressable, so its receipt shows.
  const [kept, setKept] = useState<DecisionCardView[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, CardOutcome | undefined>>({});

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/decision-card", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { cards?: DecisionCardView[]; refused?: DecisionCardRefusalView[] };
      setViews(body.cards ?? []);
      setRefused(body.refused ?? []);
    } catch {
      // Cards are additive; a failed read leaves the existing to-do list untouched.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const press = useCallback(
    async (view: DecisionCardView, optionId: string) => {
      const fingerprint = view.pressable[optionId];
      if (fingerprint === undefined) return;
      setPendingId(`${view.card.id}:${optionId}`);
      try {
        const response = await fetch("/api/decision-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: view.card.id, fingerprint })
        });
        const body = (await response.json()) as { error?: string; reason?: string; message?: string };
        if (response.ok) setKept((current) => [...current.filter((item) => item.card.id !== view.card.id), { ...view, pressable: {}, notExecutableReason: null }]);
        setOutcomes((current) => ({
          ...current,
          [view.card.id]: response.ok
            ? { ok: true, message: body.message ?? "Done." }
            : { ok: false, reason: body.reason, message: body.error ?? "The card was refused." }
        }));
      } catch (cause) {
        setOutcomes((current) => ({
          ...current,
          [view.card.id]: { ok: false, reason: "network", message: cause instanceof Error ? cause.message : String(cause) }
        }));
      } finally {
        setPendingId(null);
        void refresh();
      }
    },
    [refresh]
  );

  const merged = [...views, ...kept.filter((item) => !views.some((view) => view.card.id === item.card.id))];
  return { views: merged, refused, pendingId, outcomes, press };
}
