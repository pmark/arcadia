"use client";

import { useEffect, useState } from "react";
import type { CardClassification } from "../lib/operator-card-state";

/** Reads the ended operator-script cards (GET only). A failed read yields none: every card then stays where it was. */
export function useCardHistory(): CardClassification[] {
  const [cards, setCards] = useState<CardClassification[]>([]);
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const response = await fetch("/api/workspace/card-history", { cache: "no-store" });
        if (response.ok && live) setCards(((await response.json()) as { cards: CardClassification[] }).cards);
      } catch { /* keep the last good read */ }
    };
    void read();
    const interval = setInterval(() => { if (document.visibilityState !== "hidden") void read(); }, 30_000);
    return () => { live = false; clearInterval(interval); };
  }, []);
  return cards;
}
