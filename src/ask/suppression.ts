/**
 * Asks that create no new question (Plan Action stop-asks-vanishing).
 *
 * Under `ask.routing.v2` every operator Ask that is not an Idea becomes a
 * question the operator can see, so the two things that must not become one are
 * named here and nothing else is: a whole message that is only an
 * acknowledgement, and an exact repeat of a question that is still open.
 */

/** A suppressed Ask's `suppressed_reason`: `acknowledgement`, or `duplicate:<review id>`. */
export const SUPPRESSED_ACKNOWLEDGEMENT = "acknowledgement";
export const SUPPRESSED_DUPLICATE_PREFIX = "duplicate:";

/** An open question suppresses an exact repeat for this long. */
export const DUPLICATE_ASK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The closed list. A whole message must equal one of these, after trimming
 * whitespace and punctuation and ignoring case. Bare "done" is deliberately not
 * on it: from an operator it can be a completion report ("done" after a manual
 * step), and an Ask that might be a report must stay visible (PR #1091 review).
 */
export const ACKNOWLEDGEMENTS: readonly string[] = ["thanks", "thank you", "ok", "okay", "got it", "ack"];

const EDGE_NOISE = /^[\s\p{P}]+|[\s\p{P}]+$/gu;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u200d|\ufe0f|\s)+$/u;

/**
 * True only when the whole message is an acknowledgement or emoji only. "ok, ship X"
 * is not one: only the edges are trimmed, so any other word keeps the Ask.
 */
export function isTrivialAcknowledgement(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (EMOJI_ONLY.test(trimmed) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(trimmed)) return true;
  const normalized = trimmed.replace(EDGE_NOISE, "").toLowerCase().replace(/\s+/g, " ");
  return ACKNOWLEDGEMENTS.includes(normalized);
}
