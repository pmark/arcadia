import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { loadModelTierRegistry, tierOfModel, type ModelTier, type TierAgent } from "../codingAgents/modelTiers.js";
import { sessionLogPath } from "../sessions/sessionRecording.js";
import type { AgentSession } from "../sessions/index.js";
import { readProductionPolicySafely } from "./policy.js";
import { sessionTokensFromLog } from "./sessionCapability.js";

/**
 * The platform per-Session input-token ceiling (Issue #1284).
 *
 * Spend is bounded by the platform, not by prompt discipline: the first
 * production run spent ~11.1M input tokens (10.4M cached) on a Session that
 * produced no diff. The ceiling counts uncached + cached input tokens (a
 * cached re-read is still a re-read of the same context) and the stop names
 * both counts separately.
 *
 * Source of the value, in order: the active policy scope's
 * `sessionInputTokenCeiling` (validated, fingerprinted, reviewed with the
 * scope), else the Session's tier default below. Nothing a Session, brief,
 * packet or Action text says is read here, and there is no "off".
 *
 * Enforcement points, and the honest gap:
 *  - DURING the Session: each production tick reads the headless Session log
 *    (`sessionTokensFromLog`) and ends the Session once it is over the ceiling.
 *    That log only carries usage at provider turn boundaries (Codex
 *    `turn.completed` per turn; Claude `result` at the end of the run), so a
 *    single very long turn is NOT interruptible: overshoot is bounded by one
 *    provider turn, and a provider that reports usage only at exit is checked
 *    only after exit. There is no finer live token signal today.
 *  - AFTER exit: the exit accounting records the tokens and, over the ceiling,
 *    raises the one named `budget_exhausted` blocker and refuses relaunch.
 */
export const BUDGET_EXHAUSTED_ESCALATION_KIND = "budget_exhausted";
export const BUDGET_EXHAUSTED_STOP_PREFIX = "budget_exhausted:";

/** Total input tokens (uncached + cached) one Session may spend, per tier. */
export const SESSION_INPUT_TOKEN_CEILING_DEFAULTS: Readonly<Record<ModelTier, number>> = {
  light: 3_000_000,
  standard: 6_000_000,
  heavy: 10_000_000
};
/** Tier used when the Session's model is not in the registry (e.g. a fixture provider). */
export const SESSION_CEILING_FALLBACK_TIER: ModelTier = "standard";

const PROVIDER_AGENT: Record<string, TierAgent> = { "codex-cli": "codex", "claude-code-cli": "claude", "opencode-cli": "opencode" };

export interface SessionTokenCeiling {
  ceiling: number;
  tier: ModelTier;
  source: "policy" | "tier_default";
}

export function resolveSessionTokenCeiling(
  db: Database.Database,
  input: { workspace: string; session: Pick<AgentSession, "provider" | "model"> }
): SessionTokenCeiling {
  let tier: ModelTier = SESSION_CEILING_FALLBACK_TIER;
  try {
    const agent = PROVIDER_AGENT[input.session.provider];
    if (agent) tier = tierOfModel(agent, input.session.model, loadModelTierRegistry(input.workspace)) ?? tier;
  } catch { /* an unreadable registry falls back to the standard tier default */ }
  const read = readProductionPolicySafely(db);
  const fromPolicy = read.status === "ok" ? read.policy.scope?.sessionInputTokenCeiling : undefined;
  if (typeof fromPolicy === "number" && Number.isSafeInteger(fromPolicy) && fromPolicy > 0) {
    return { ceiling: fromPolicy, tier, source: "policy" };
  }
  return { ceiling: SESSION_INPUT_TOKEN_CEILING_DEFAULTS[tier], tier, source: "tier_default" };
}

export interface TokenCeilingBreach {
  ceiling: number;
  inputTokens: number;
  cachedInputTokens: number;
  message: string;
}

/** Pure: the breach when uncached + cached input tokens reach the ceiling. */
export function decideTokenCeilingBreach(
  tokens: { inputTokens: number; cachedInputTokens: number } | null,
  ceiling: number
): TokenCeilingBreach | null {
  if (!tokens) return null;
  const total = tokens.inputTokens + tokens.cachedInputTokens;
  if (total < ceiling) return null;
  return {
    ceiling,
    inputTokens: tokens.inputTokens,
    cachedInputTokens: tokens.cachedInputTokens,
    message: `${BUDGET_EXHAUSTED_STOP_PREFIX} the Session used ${total} input tokens (${tokens.inputTokens} uncached + ${tokens.cachedInputTokens} cached), at or over its platform ceiling of ${ceiling}.`
  };
}

/** The tokens the Session's own headless log reports so far; null for an interactive Session or no usage yet. */
export function readSessionLogTokens(workspace: string, sessionId: string) {
  try {
    return sessionTokensFromLog(readFileSync(sessionLogPath(workspace, sessionId), "utf8"));
  } catch {
    return null;
  }
}

/** The breach for a Session as its log stands now, or null. Never throws. */
export function sessionTokenCeilingBreach(
  db: Database.Database,
  input: { workspace: string; session: Pick<AgentSession, "id" | "provider" | "model"> }
): TokenCeilingBreach | null {
  const tokens = readSessionLogTokens(input.workspace, input.session.id);
  if (!tokens) return null;
  return decideTokenCeilingBreach(tokens, resolveSessionTokenCeiling(db, input).ceiling);
}

export function describeBudgetExhausted(actionKey: string, breach: TokenCeilingBreach, wallClasses: string[]): { message: string; remedy: string } {
  const walls = wallClasses.length > 0 ? ` It also hit an environment wall (${wallClasses.join(", ")}).` : "";
  return {
    message: `Budget exhausted for ${actionKey}: ${breach.message} It will not be relaunched automatically.${walls}`,
    remedy: "Find the cause in the Session's log before spending again, then reset this Action's repair budget from its blocker on /todo (also listed on /production) so production relaunches it. "
      + "The ceiling is part of the reviewed production policy; it cannot be raised or disabled from a prompt, brief or Action text."
  };
}
