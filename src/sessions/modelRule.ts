import { validationError } from "../cli/errors.js";
import { claudeReasoningEffort } from "../codingAgents/reasoningEffort.js";
import { MODEL_TIERS, tierOfModel, type ModelTierRegistry } from "../codingAgents/modelTiers.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "../execution/profiles.js";
import type { CodingAgentProfile } from "../intent/registries.js";

/**
 * Decision 0290 A, the implementer model and effort rule for production:
 * Opus, high effort, for any Action expected to change files under src/,
 * scripts/ or apps/, or with four or more acceptance criteria; Sonnet, medium
 * effort, for test-only, docs-only and config-only Actions; every repair round
 * after a failed independent review runs on Opus.
 *
 * The rule names Claude models, so it applies only to a Claude Session; any
 * other provider keeps its existing launch choice. It selects among bindings
 * already configured and enabled in the provider-adapter registry and adds no
 * provider, binding, credential or spend. When the binding it selects is not
 * enabled, the Session falls back to the launch's existing choice only when
 * that is no stronger than the rule's (its effort capped at the rule's), and
 * records the departure; it never fails open into a stronger model.
 */
export const MODEL_RULE_LABEL = "Decision 0290 A" as const;

/** A path the Action is expected to change that makes it source work. */
const SOURCE_PATH = /(?<![\w./-])(?:\.\/)?((?:src|scripts|apps)\/[^\s`'",;)]+)/;
const SOURCE_CRITERIA_THRESHOLD = 4;

export type ModelRuleClass = "repair" | "source" | "non_source";

export interface ModelRuleClassification {
  ruleClass: ModelRuleClass;
  tier: "heavy" | "standard";
  effort: ReasoningEffort;
  reason: string;
}

export interface ModelRuleChoice {
  version: 1;
  rule: typeof MODEL_RULE_LABEL;
  ruleClass: ModelRuleClass;
  reason: string;
  /** What the rule selects. `bindingId` is null when no enabled binding offers it. */
  selected: { model: string; effort: ReasoningEffort; tier: "heavy" | "standard"; bindingId: string | null };
  /** What the Session actually launches on. */
  used: { model: string; effort: string | null; bindingId: string | null };
  /** Why `used` differs from `selected`; null when the rule was followed. */
  departure: string | null;
}

export function classifyModelRule(input: {
  action: { acceptanceCriteria: string[]; references: string[] };
  repair: boolean;
}): ModelRuleClassification {
  if (input.repair) {
    return { ruleClass: "repair", tier: "heavy", effort: "e3_deep", reason: "a review repair Session: every repair round after a failed independent review runs on Opus" };
  }
  const named = firstSourcePath(input.action.acceptanceCriteria, "acceptance criteria")
    ?? firstSourcePath(input.action.references, "references");
  if (named) {
    return { ruleClass: "source", tier: "heavy", effort: "e3_deep", reason: `source work: the Action's ${named.where} name ${named.path}` };
  }
  const count = input.action.acceptanceCriteria.length;
  if (count >= SOURCE_CRITERIA_THRESHOLD) {
    return { ruleClass: "source", tier: "heavy", effort: "e3_deep", reason: `the Action has ${count} acceptance criteria (four or more)` };
  }
  return {
    ruleClass: "non_source",
    tier: "standard",
    effort: "e2_standard",
    reason: `test, docs or config work: the Action names no src/, scripts/ or apps/ path in its acceptance criteria or references and has ${count} acceptance criteria (fewer than four)`
  };
}

function firstSourcePath(values: string[], where: string): { path: string; where: string } | null {
  for (const value of values) {
    const match = SOURCE_PATH.exec(value);
    if (match) return { path: match[1].replace(/[.:]+$/, ""), where };
  }
  return null;
}

/**
 * Apply the rule to one production launch. Returns null for a provider the
 * Decision does not name. Throws `model_rule_binding_unavailable` when the
 * rule's binding is not enabled and the only fallback is stronger than it.
 */
export function applyModelRule(input: {
  /** The Session agent (`claude`, `codex`, `opencode` or `fixture`). */
  agent: string;
  provider: string;
  action: { acceptanceCriteria: string[]; references: string[] };
  repair: boolean;
  adapters: ProviderAdapterRegistry;
  profiles: CodingAgentProfile[];
  registry: ModelTierRegistry;
  /** The model and effort the launch would otherwise use. */
  fallback: { model: string; effort: string | null; bindingId?: string | null };
}): ModelRuleChoice | null {
  if (input.agent !== "claude") return null;
  const classified = classifyModelRule({ action: input.action, repair: input.repair });
  const targetModel = input.registry.tiers[classified.tier].claude?.model ?? null;
  const found = targetModel ? findEnabledBuildBinding(input, targetModel, classified.effort) : { bindingId: null, refusal: `no ${classified.tier} tier Claude model is registered` };
  const selected = { model: targetModel ?? `(${classified.tier} tier)`, effort: classified.effort, tier: classified.tier, bindingId: found.bindingId };
  const base = { version: 1 as const, rule: MODEL_RULE_LABEL, ruleClass: classified.ruleClass, reason: classified.reason, selected };
  if (found.bindingId && targetModel) {
    return { ...base, used: { model: targetModel, effort: classified.effort, bindingId: found.bindingId }, departure: null };
  }

  const fallbackTier = tierOfModel("claude", input.fallback.model, input.registry);
  const stronger = fallbackTier === null || MODEL_TIERS.indexOf(fallbackTier) > MODEL_TIERS.indexOf(classified.tier);
  if (stronger) {
    throw validationError(
      `${MODEL_RULE_LABEL} selects ${selected.model} at ${classified.effort} for this Action (${classified.reason}), ` +
        `but ${found.refusal}; the only other choice, ${input.fallback.model}, is ${fallbackTier === null ? "not a known tier model" : "stronger than the rule allows"}, so nothing launches.`,
      {
        code: "model_rule_binding_unavailable",
        rule: MODEL_RULE_LABEL,
        selected,
        fallback: input.fallback,
        remedy: `Enable a build binding for ${input.provider} offering ${selected.model} at ${classified.effort} in the provider-adapter registry.`
      }
    );
  }
  const effort = cappedEffort(input.fallback.effort, classified.effort);
  const used = { model: input.fallback.model, effort, bindingId: input.fallback.bindingId ?? null };
  return {
    ...base,
    used,
    departure: `${found.refusal}; launched on ${used.model} at ${effort}${used.bindingId ? ` (binding ${used.bindingId})` : ""} instead, ` +
      `the launch's own choice, which is no stronger than the rule's${effort !== input.fallback.effort ? ` (effort capped from ${input.fallback.effort ?? "default"})` : ""}.`
  };
}

function findEnabledBuildBinding(
  input: { provider: string; adapters: ProviderAdapterRegistry; profiles: CodingAgentProfile[] },
  model: string,
  effort: ReasoningEffort
): { bindingId: string | null; refusal: string } {
  const providerState = input.adapters.providers.find((provider) => provider.id === input.provider);
  const buildProfiles = new Set(input.profiles.filter((profile) => profile.purpose === "build" && profile.provider === input.provider).map((profile) => profile.name));
  const rejected: string[] = [];
  for (const binding of input.adapters.bindings) {
    if (binding.provider !== input.provider || binding.model !== model) continue;
    if (binding.reviewOnly === true) continue;
    if (!binding.agentProfiles.some((name) => buildProfiles.has(name))) continue;
    if (!providerState?.enabled) rejected.push(`${binding.id} (provider ${input.provider} is not enabled)`);
    else if (!binding.enabled) rejected.push(`${binding.id} (not enabled)`);
    else if (!binding.effortArgs[effort]) rejected.push(`${binding.id} (no ${effort} effort)`);
    else return { bindingId: binding.id, refusal: "" };
  }
  return {
    bindingId: null,
    refusal: rejected.length
      ? `the rule's binding is not enabled: ${rejected.join(", ")}`
      : `no build binding for ${input.provider} offers ${model}`
  };
}

function cappedEffort(effort: string | null, cap: ReasoningEffort): ReasoningEffort {
  const rank = effort ? (REASONING_EFFORTS as readonly string[]).indexOf(effort) : -1;
  return rank < 0 || rank > REASONING_EFFORTS.indexOf(cap) ? cap : (effort as ReasoningEffort);
}

/** The stored launch record, or null for a Session launched without the rule. */
export function parseModelRuleChoice(json: string | null | undefined): ModelRuleChoice | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as ModelRuleChoice;
    return parsed && parsed.rule === MODEL_RULE_LABEL ? parsed : null;
  } catch {
    return null;
  }
}

/** One line for the managed tick's log. */
export function describeModelRuleChoice(choice: ModelRuleChoice): string {
  const used = `${choice.used.model} at ${choice.used.effort ?? "default"}`;
  return choice.departure
    ? `${MODEL_RULE_LABEL} selected ${choice.selected.model} at ${choice.selected.effort} (${choice.reason}) and departed: ${choice.departure}`
    : `${MODEL_RULE_LABEL} chose ${used} (${choice.reason}).`;
}

/** The brief's section naming the model, the effort and the rule that chose them. */
export function renderModelRuleBrief(choice: ModelRuleChoice): string[] {
  const effort = choice.used.effort ? `${choice.used.effort} (${claudeReasoningEffort(choice.used.effort)})` : "the provider default";
  return [
    "",
    `Model and effort (${MODEL_RULE_LABEL}):`,
    `Model: ${choice.used.model}. Effort: ${effort}.`,
    `Rule: Opus high for source work (src/, scripts/ or apps/, or four or more acceptance criteria) and every review repair; Sonnet medium for test, docs and config work. Applied here because ${choice.reason}.`,
    ...(choice.departure ? [`Departure from the rule: the rule selects ${choice.selected.model} at ${choice.selected.effort}, but ${choice.departure}`] : [])
  ];
}
