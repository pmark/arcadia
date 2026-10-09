import { normalizeAskText } from "./corrections.js";

/**
 * The token pattern the Ask report uses to group corrections (Plan Action ask-golden-set-and-vanish-report).
 *
 * Deliberately simple: lower-case the normalized text, split it into letter and digit tokens, drop a few leading filler
 * words (articles and politeness), and keep the first {@link PATTERN_TOKENS} tokens. Two corrections that open with the
 * same words, such as "I want to ...", share a pattern. It is a hint for a person or agent to propose a deterministic
 * rule in a reviewed PR; it never generates a rule and is not used to route an Ask.
 */
export const PATTERN_TOKENS = 3;

/** How many distinct memos must share a corrected type and a pattern before the report points at a possible rule. */
export const MEMO_PATTERN_THRESHOLD = 3;

/** Leading words that say nothing about what is being asked. Only skipped at the start of the text. */
const LEADING_FILLER = new Set(["a", "an", "the", "please", "hey", "so", "ok", "okay"]);

/** The first {@link PATTERN_TOKENS} meaningful tokens of `text`, joined by one space; empty when there are none. */
export function tokenPattern(text: string): string {
  const tokens = normalizeAskText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  let start = 0;
  while (start < tokens.length - 1 && LEADING_FILLER.has(tokens[start])) start += 1;
  return tokens.slice(start, start + PATTERN_TOKENS).join(" ");
}

/** The key under which a correction and a golden case are compared: the same corrected type and the same pattern. */
export function backingKey(type: string, text: string): string {
  return `${type}\u0000${tokenPattern(text)}`;
}
