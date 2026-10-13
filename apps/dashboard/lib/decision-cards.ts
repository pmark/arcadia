/**
 * Decision-card press protocol shared by the dashboard route and its tests.
 * Pure and client-safe: it imports only the dependency-free card contract.
 *
 * The browser never supplies a card. A press carries `{cardId, fingerprint}`; the server regenerates the
 * current card from current source state and refuses unless the fingerprint equals the pins it computes now.
 * The fingerprint is `v1|option=<id>|state=<sha>|head=<sha>|preview=<sha>` (only the pins the card carries),
 * so a stale press can be named by pin kind and the option pressed is part of what was pinned.
 */
import { checkPins, type DecisionCard, type DecisionCardPins } from "../../../src/decisions/card";

export const CARD_PRESS_LIMITS = { body: 2048, cardId: 128, fingerprint: 512 } as const;
const OPTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA_RE = /^[0-9a-f]{40,64}$/;

export type CardPressRefusalReason =
  | "malformed_body"
  | "unknown_key"
  | "bad_card_id"
  | "bad_fingerprint"
  | "card_not_open"
  | "option_not_offered"
  | "pin_set_changed"
  | "stale_state_hash"
  | "stale_head_sha"
  | "stale_preview_fingerprint"
  | "expired"
  | "malformed_card"
  | "run_not_executable_here"
  | "merge_not_executable_here"
  | "veto_not_executable_here"
  | "option_not_executable_here"
  | "already_in_progress"
  | "source_unavailable"
  | "write_refused";

export interface CardPressRefusal {
  ok: false;
  status: number;
  reason: CardPressRefusalReason;
  message: string;
}

/** The fingerprint a press must carry for one option of a card, from the card's own pins. */
export function optionFingerprint(card: Pick<DecisionCard, "pins">, optionId: string): string {
  const parts = [`v1`, `option=${optionId}`];
  if (card.pins.stateHash !== undefined) parts.push(`state=${card.pins.stateHash}`);
  if (card.pins.headSha !== undefined) parts.push(`head=${card.pins.headSha}`);
  if (card.pins.previewFingerprint !== undefined) parts.push(`preview=${card.pins.previewFingerprint}`);
  return parts.join("|");
}

interface ParsedFingerprint {
  optionId: string;
  pins: DecisionCardPins;
}

export function parseFingerprint(value: string): ParsedFingerprint | null {
  const parts = value.split("|");
  if (parts[0] !== "v1" || parts.length < 3 || parts.length > 5) return null;
  const seen = new Set<string>();
  let optionId = "";
  const pins: DecisionCardPins = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "option") {
      if (!OPTION_ID_RE.test(val)) return null;
      optionId = val;
    } else if (key === "state" || key === "head" || key === "preview") {
      if (!SHA_RE.test(val)) return null;
      if (key === "state") pins.stateHash = val;
      else if (key === "head") pins.headSha = val;
      else pins.previewFingerprint = val;
    } else {
      return null;
    }
  }
  if (optionId === "" || Object.keys(pins).length === 0) return null;
  return { optionId, pins };
}

const refuse = (status: number, reason: CardPressRefusalReason, message: string): CardPressRefusal => ({ ok: false, status, reason, message });

export interface CardPressBody {
  cardId: string;
  fingerprint: string;
}

/** Strict parse: exactly `cardId` and `fingerprint`, both bounded strings. Nothing else is ever read. */
export function parsePressBody(raw: unknown): { ok: true; body: CardPressBody } | CardPressRefusal {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return refuse(400, "malformed_body", "The request body must be a JSON object with cardId and fingerprint.");
  }
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (key !== "cardId" && key !== "fingerprint") {
      return refuse(400, "unknown_key", `The request may carry only cardId and fingerprint; ${key === "__proto__" ? "a prototype key" : `"${key.slice(0, 40)}"`} is not accepted.`);
    }
  }
  const record = raw as Record<string, unknown>;
  const cardId = record.cardId;
  const fingerprint = record.fingerprint;
  if (typeof cardId !== "string" || cardId === "" || cardId.length > CARD_PRESS_LIMITS.cardId || /[\s\p{Cc}\p{Cf}]/u.test(cardId)) {
    return refuse(400, "bad_card_id", "cardId must be a short string without whitespace.");
  }
  if (typeof fingerprint !== "string" || fingerprint === "" || fingerprint.length > CARD_PRESS_LIMITS.fingerprint) {
    return refuse(400, "bad_fingerprint", "fingerprint must be the string the card was rendered with.");
  }
  return { ok: true, body: { cardId, fingerprint } };
}

/**
 * Decide whether a press still matches current state. `cards` are the cards regenerated server side just now;
 * the match is by card id, then every pin the fingerprint names must equal the current card's, by `checkPins`.
 */
export function evaluatePress(
  cards: ReadonlyArray<DecisionCard>,
  body: CardPressBody,
  now: Date
): { ok: true; card: DecisionCard; optionId: string } | CardPressRefusal {
  const card = cards.find((candidate) => candidate.id === body.cardId);
  if (card === undefined) {
    return refuse(404, "card_not_open", "That card is no longer open: it was already answered or run, closed, or expired. Nothing was written.");
  }
  const parsed = parseFingerprint(body.fingerprint);
  if (parsed === null) return refuse(400, "bad_fingerprint", "The fingerprint is not in the pinned format.");
  if (!card.options.some((option) => option.id === parsed.optionId)) {
    return refuse(409, "option_not_offered", `The card no longer offers option ${parsed.optionId}. Reload to see its current options.`);
  }
  const pinned = Object.keys(card.pins).sort().join(",");
  const claimed = Object.keys(parsed.pins).sort().join(",");
  if (pinned !== claimed) {
    return refuse(409, "pin_set_changed", "The card is now pinned to different state than the one you were shown. Reload and read it again.");
  }
  const check = checkPins({ pins: parsed.pins, expires: card.expires }, card.pins, now);
  if (!check.ok) {
    const stale = check.reason === "stale_state_hash" || check.reason === "stale_head_sha" || check.reason === "stale_preview_fingerprint";
    const reason: CardPressRefusalReason = stale ? check.reason as CardPressRefusalReason : check.reason === "expired" ? "expired" : "malformed_card";
    return refuse(409, reason, stale
      ? `The card changed after you were shown it (${check.reason}). Nothing was written; reload and read the current card.`
      : `The card cannot be used (${check.reason}). Nothing was written.`);
  }
  return { ok: true, card, optionId: parsed.optionId };
}

/** What the browser is given for each card: the card to read, and one pinned fingerprint per pressable option. */
export interface DecisionCardView {
  card: DecisionCard;
  /** Option id to the fingerprint a press must carry; present only for options this dashboard can execute. */
  pressable: Record<string, string>;
  /** Why no button is shown for a verb this dashboard does not execute, in one sentence; null otherwise. */
  notExecutableReason: string | null;
  /** Non-authoritative display metadata used to hide the same item's older to-do row. */
  duplicates: { kind: "decision"; project: string; id: string } | null;
}

/** Server-side only: what a card's source is, so the route can act on it. Never sent to the browser. */
export type CardTarget =
  | { kind: "decision"; projectSlug: string; decisionId: string; labels: string[] }
  | { kind: "script"; scriptId: string }
  | { kind: "pull-request" };

/**
 * The options this dashboard can execute for a card. `answer` executes any option of an open Decision through the
 * canonical `decision approve` writer; `run` executes only the `run` option through the existing operator-script
 * entry; `merge` is the batch-merge operator script's job and `veto` has no writer here, so neither has a button.
 */
export function executableOptions(card: Pick<DecisionCard, "verb" | "options">, target: CardTarget | undefined): string[] {
  if (target === undefined) return [];
  if (card.verb === "answer" && target.kind === "decision") return card.options.map((option) => option.id);
  if (card.verb === "run" && target.kind === "script") return card.options.some((option) => option.id === "run") ? ["run"] : [];
  return [];
}

export function notExecutableMessage(card: Pick<DecisionCard, "verb">): string {
  if (card.verb === "merge") return "Merging is done by the batch-merge operator script, not from this page; read the card there.";
  if (card.verb === "veto") return "A veto has no writer on this page; nothing here can press it.";
  return "This card cannot be executed from this page.";
}

export function toCardViews(cards: ReadonlyArray<DecisionCard>, targets: ReadonlyMap<string, CardTarget>): DecisionCardView[] {
  return cards.map((card) => {
    const target = targets.get(card.id);
    const ids = executableOptions(card, target);
    const pressable: Record<string, string> = {};
    for (const id of ids) pressable[id] = optionFingerprint(card, id);
    return {
      card,
      pressable,
      notExecutableReason: ids.length > 0 ? null : notExecutableMessage(card),
      duplicates: target?.kind === "decision" ? { kind: "decision", project: target.projectSlug, id: target.decisionId } : null
    };
  });
}
