import { PANE_SIGNAL_CATALOG } from "../production/sessionSignals.js";

export interface ScoutExecutionFailure {
  kind: "auth_failure" | "provider_limit" | "isolation" | "authority" | "runtime" | "product" | "unknown";
  diagnostic: string;
  matched: string[];
  retryable: boolean;
}

/** Reuse the shared provider wording catalog; unknown failures never grant retry. */
export function classifyScoutFailure(input: { diagnostic: string; runtime?: boolean; product?: boolean }): ScoutExecutionFailure {
  const matches = PANE_SIGNAL_CATALOG.filter((entry) => entry.pattern.test(input.diagnostic));
  const kind = matches.some((entry) => entry.class === "auth_failure") ? "auth_failure"
    : matches.some((entry) => entry.class === "provider_limit") ? "provider_limit"
    : matches.some((entry) => entry.class === "sandbox_denial") || /\b(?:isolation violation|isolation (?:check )?failed|unverified isolation|unexpected protected.state change|protected.state (?:violation|mismatch))\b/i.test(input.diagnostic) ? "isolation"
    : /\b(?:missing|revoked|denied|invalid|expired)\s+(?:\w+\s+){0,2}(?:authority|approval)\b|\b(?:authority|approval)\s+(?:is\s+)?(?:missing|revoked|denied|invalid|expired)\b/i.test(input.diagnostic) ? "authority"
    : input.product ? "product" : input.runtime ? "runtime" : "unknown";
  const diagnostic = input.diagnostic.length <= 8000 ? input.diagnostic : `${input.diagnostic.slice(0, 4000)}\n[diagnostic truncated; full executor output retained]\n${input.diagnostic.slice(-4000)}`;
  return { kind, diagnostic, matched: matches.map((entry) => entry.id), retryable: kind === "runtime" || kind === "product" };
}
