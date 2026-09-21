/**
 * Arcadia stores an abstract reasoning-effort key (`e1_brief` … `e4_rigorous`)
 * on an Action and in a prepared packet's selection. A provider CLI only accepts
 * its own native value, so the translation happens here, at the spawn boundary,
 * and nowhere else: the stored and bound value stays abstract. Provider-native
 * values in packets written before the abstract keys pass through unchanged.
 */
const NATIVE_REASONING_EFFORT: Record<string, string> = {
  e1_brief: "low",
  e2_standard: "medium",
  e3_deep: "high",
  e4_rigorous: "xhigh"
};

/** Codex's `model_reasoning_effort` value for a stored effort key. */
export function codexReasoningEffort(effort: string): string {
  return NATIVE_REASONING_EFFORT[effort] ?? effort;
}

/** Claude Code's `--effort` value for a stored effort key. */
export function claudeReasoningEffort(effort: string): string {
  return NATIVE_REASONING_EFFORT[effort] ?? effort;
}
