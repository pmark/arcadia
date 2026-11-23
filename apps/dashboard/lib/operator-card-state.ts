/**
 * What has become of one operator-script card: still waiting on the operator (`actionable`), or finished without
 * them (`pressed`, `superseded`, `voided`, `expired`). Pure and display-only: it reads recorded evidence and never
 * writes, so a consumed card stays in the library and stays findable under the feed's history filter.
 *
 * Evidence, all already recorded by the executors:
 *  - `<id>.consumed.json` (a START or grant card was pressed): `{ state: "CONSUMED", at }`.
 *  - `<id>.held-history.jsonl` (one JSON event per line): a `held` event whose reason starts "Voided" voids the card;
 *    one that says it was replaced or superseded marks it superseded. A later `unheld` only clears the hold, it does
 *    not make a void card pressable again.
 *  - the descriptor's `expires_at`: an unpressed card past it is expired.
 */
export type CardState = "actionable" | "pressed" | "superseded" | "voided" | "expired";
export type EndedCardState = Exclude<CardState, "actionable">;

export interface HeldEvent {
  event?: string;
  at?: string;
  reason?: string;
}

export interface CardEvidence {
  id: string;
  title?: string;
  /** The parsed `<id>.consumed.json`, or null when there is none. */
  consumed: { state?: string; at?: string } | null;
  /** The parsed lines of `<id>.held-history.jsonl`, oldest first. */
  heldHistory: ReadonlyArray<HeldEvent>;
  /** The descriptor's `expires_at` (ISO 8601), if it has one. */
  expiresAt?: string | null;
}

export interface CardClassification {
  id: string;
  title: string;
  state: CardState;
  /** When the card reached its end state (ISO 8601); null when the record has no time. */
  at: string | null;
}

const VOIDED = /^\s*void/i;
const SUPERSEDED = /supersed|replaced by/i;

export function classifyCard(evidence: CardEvidence, now: Date): CardClassification {
  const base = { id: evidence.id, title: evidence.title ?? evidence.id };
  if (evidence.consumed?.state === "CONSUMED") return { ...base, state: "pressed", at: evidence.consumed.at ?? null };
  const held = evidence.heldHistory.filter(e => e.event === "held" && typeof e.reason === "string");
  const voided = [...held].reverse().find(e => VOIDED.test(e.reason!));
  if (voided) return { ...base, state: "voided", at: voided.at ?? null };
  const superseded = [...held].reverse().find(e => SUPERSEDED.test(e.reason!));
  if (superseded) return { ...base, state: "superseded", at: superseded.at ?? null };
  const expires = evidence.expiresAt ? Date.parse(evidence.expiresAt) : NaN;
  if (Number.isFinite(expires) && expires <= now.getTime()) return { ...base, state: "expired", at: new Date(expires).toISOString() };
  return { ...base, state: "actionable", at: null };
}

/** The feed step id a card appears under (`card-` plus the card id, which is `script-` plus the script id). */
export const cardStepId = (scriptId: string) => `card-script-${scriptId}`;

export const CARD_STATE_LABEL: Record<EndedCardState, string> = { pressed: "Pressed", superseded: "Superseded", voided: "Voided", expired: "Expired" };

/** "Nov 17, 11:00 AM PST" in the given zone (the browser's own when omitted); empty when there is no time. */
export function formatCardTime(at: string | null, timeZone?: string): string {
  const ms = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(ms);
}
