import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "../execution/profiles.js";
import { isPlausibleClaudeModel } from "../sessions/worktreePreparation.js";
import { getWorkspacePaths } from "../workspace/paths.js";

/**
 * Plans name a logical model tier, not a vendor model, so one governed plan can
 * hand off to any coding agent. The tier resolves to a concrete model here,
 * which is the only place a vendor model string is written for the handoff
 * path; a plan that still names a concrete model keeps working (see
 * `resolveHandoffModel`).
 */
export const MODEL_TIERS = ["light", "standard", "heavy"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** The handoff agents a tier can resolve for, matching the Session registry. */
export const TIER_AGENTS = ["codex", "claude", "opencode"] as const;
export type TierAgent = (typeof TIER_AGENTS)[number];

export interface TierModelBinding {
  model: string;
  /** The effort used when neither the invocation nor the plan states one. */
  effort: ReasoningEffort | null;
}

export interface ModelTierRegistry {
  version: number;
  /** Each tier binds one concrete model per agent. */
  tiers: Record<ModelTier, Record<TierAgent, TierModelBinding | null>>;
}

export const MODEL_TIER_REGISTRY_VERSION = 1;

/**
 * Bundled defaults, compiled into the release rather than read from a file so
 * the protected broker stays self-contained. A workspace
 * `config/coding-agent-models.json` may override individual bindings without a
 * code change.
 */
export const BUNDLED_MODEL_TIERS: ModelTierRegistry = {
  version: MODEL_TIER_REGISTRY_VERSION,
  tiers: {
    light: {
      codex: { model: "gpt-5.6-luna", effort: "e1_brief" },
      claude: { model: "haiku", effort: "e1_brief" },
      opencode: { model: "opencode-go/glm-5.3-flash", effort: "e1_brief" }
    },
    standard: {
      codex: { model: "gpt-5.6-terra", effort: "e2_standard" },
      claude: { model: "sonnet", effort: "e2_standard" },
      opencode: { model: "opencode-go/deepseek-v4.1-flash", effort: "e2_standard" }
    },
    heavy: {
      codex: { model: "gpt-5.6-sol", effort: "e3_deep" },
      claude: { model: "opus", effort: "e3_deep" },
      opencode: { model: "opencode-go/gpt-5.6-luna", effort: "e3_deep" }
    }
  }
};

export function isModelTier(value: string): value is ModelTier {
  return (MODEL_TIERS as readonly string[]).includes(value);
}

/**
 * Whether a concrete model string is plausibly intended for one agent. These
 * are deliberately coarse provider-shape checks, not model registries: they
 * exist so a plan pinned for one provider does not reach another provider's CLI
 * unvalidated (the failure GitHub Issue #282 records).
 */
export function isPlausibleAgentModel(model: string, agent: TierAgent): boolean {
  const value = model.trim();
  if (agent === "claude") return isPlausibleClaudeModel(value);
  if (agent === "opencode") return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(value);
  return /^gpt-/i.test(value);
}

export function plausibleAgents(model: string): TierAgent[] {
  return TIER_AGENTS.filter((agent) => isPlausibleAgentModel(model, agent));
}

export interface HandoffModelInput {
  agent: TierAgent;
  /** The plan's `recommended_model`, or null when the plan declares none. */
  recommendedModel: string | null;
  /** An explicit `--model`, trusted as-is and never re-resolved. */
  explicitModel?: string | null;
  explicitEffort?: string | null;
  planEffort?: string | null;
  registry?: ModelTierRegistry;
}

export interface HandoffModelResolution {
  model: string;
  effort: string | null;
  tier: ModelTier | null;
  source: "explicit" | "tier" | "concrete" | "fallback";
  /** Operator-facing explanation, present whenever the plan was reinterpreted. */
  note: string | null;
}

/**
 * Resolve the launch model for one agent from a plan's `recommended_model`:
 *
 * - a known tier resolves to that agent's tier binding;
 * - a concrete model the agent could plausibly own is used as-is;
 * - a concrete model that plausibly belongs to a *different* agent resolves the
 *   target agent's standard tier, with a visible note rather than a silent
 *   substitution;
 * - anything recognizable as neither is refused, so an unknown tier or a typo
 *   is not quietly treated as a model.
 *
 * Effort is independent of the tier: an explicit `--effort` wins, then the
 * plan's `recommended_reasoning_effort`, then the tier's own default.
 */
export function resolveHandoffModel(input: HandoffModelInput): HandoffModelResolution {
  const registry = input.registry ?? BUNDLED_MODEL_TIERS;
  if (input.explicitModel) {
    return {
      model: input.explicitModel,
      effort: input.explicitEffort ?? input.planEffort ?? null,
      tier: null,
      source: "explicit",
      note: null
    };
  }
  if (!input.recommendedModel) {
    throw validationError("No model is resolved for the next agent session, and Arcadia will not launch one unpinned.", {
      agent: input.agent,
      remedy: "Add `recommended_model` (a tier such as standard, or a concrete model) to the plan, or pass --model explicitly."
    });
  }

  const recommended = input.recommendedModel.trim();
  if (isModelTier(recommended)) {
    const binding = registry.tiers[recommended][input.agent];
    if (!binding) {
      throw validationError(`No ${recommended} tier model is registered for ${input.agent}.`, {
        tier: recommended,
        agent: input.agent,
        remedy: "Add the tier/agent binding to the workspace coding-agent-models override, or choose another tier."
      });
    }
    return {
      model: binding.model,
      effort: input.explicitEffort ?? input.planEffort ?? binding.effort ?? null,
      tier: recommended,
      source: "tier",
      note: null
    };
  }

  if (isPlausibleAgentModel(recommended, input.agent)) {
    return {
      model: recommended,
      effort: input.explicitEffort ?? input.planEffort ?? null,
      tier: null,
      source: "concrete",
      note: null
    };
  }

  const owners = plausibleAgents(recommended);
  if (owners.length === 0) {
    throw validationError(
      "The plan's recommended_model is neither a known tier nor a model recognized for any coding agent.",
      {
        recommendedModel: recommended,
        knownTiers: [...MODEL_TIERS],
        agent: input.agent,
        remedy: "Use a tier (light, standard, heavy) in the plan, or a concrete model for the chosen agent."
      }
    );
  }

  const fallback = registry.tiers.standard[input.agent];
  if (!fallback) {
    throw validationError(`No standard tier model is registered for ${input.agent} to fall back to.`, {
      agent: input.agent,
      recommendedModel: recommended,
      remedy: "Add the standard tier binding to the workspace coding-agent-models override."
    });
  }
  return {
    model: fallback.model,
    effort: input.explicitEffort ?? input.planEffort ?? fallback.effort ?? null,
    tier: "standard",
    source: "fallback",
    note:
      `Plan names ${recommended}, which is not a ${input.agent} model` +
      `${owners.length ? ` (it reads as ${owners.join("/")})` : ""}; ` +
      `resolved the standard tier instead.`
  };
}

/** The workspace override file, when the workspace has one. */
export function modelTierOverridePath(workspace: string): string {
  return path.join(getWorkspacePaths(path.resolve(workspace)).config, "coding-agent-models.json");
}

/**
 * The bundled defaults, with any workspace `config/coding-agent-models.json`
 * merged over them. A workspace override replaces only the bindings it names,
 * so one changed model never drops the rest of the table.
 */
export function loadModelTierRegistry(workspace: string | null | undefined): ModelTierRegistry {
  if (!workspace) return BUNDLED_MODEL_TIERS;
  const overridePath = modelTierOverridePath(workspace);
  if (!existsSync(overridePath)) return BUNDLED_MODEL_TIERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(overridePath, "utf8"));
  } catch (error) {
    throw validationError("The coding-agent-models override is not valid JSON.", {
      file: overridePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  return mergeModelTiers(BUNDLED_MODEL_TIERS, parsed, overridePath);
}

export function mergeModelTiers(
  base: ModelTierRegistry,
  override: unknown,
  source = "coding-agent-models override"
): ModelTierRegistry {
  if (override === null || typeof override !== "object" || Array.isArray(override)) {
    throw validationError("The coding-agent-models override must be a JSON object.", { source });
  }
  const tiers = (override as { tiers?: unknown }).tiers;
  if (tiers === undefined) return base;
  if (tiers === null || typeof tiers !== "object" || Array.isArray(tiers)) {
    throw validationError("The coding-agent-models override `tiers` must be an object.", { source });
  }
  const merged: ModelTierRegistry = {
    version: base.version,
    tiers: {
      light: { ...base.tiers.light },
      standard: { ...base.tiers.standard },
      heavy: { ...base.tiers.heavy }
    }
  };
  for (const [tier, bindings] of Object.entries(tiers as Record<string, unknown>)) {
    if (!isModelTier(tier)) {
      throw validationError("The coding-agent-models override names an unknown tier.", {
        tier,
        knownTiers: [...MODEL_TIERS],
        source
      });
    }
    if (bindings === null || typeof bindings !== "object" || Array.isArray(bindings)) {
      throw validationError("A coding-agent-models override tier must map agents to bindings.", { tier, source });
    }
    for (const [agent, binding] of Object.entries(bindings as Record<string, unknown>)) {
      if (!(TIER_AGENTS as readonly string[]).includes(agent)) {
        throw validationError("The coding-agent-models override names an unknown agent.", {
          tier,
          agent,
          knownAgents: [...TIER_AGENTS],
          source
        });
      }
      merged.tiers[tier][agent as TierAgent] = normalizeBinding(binding, { tier, agent, source });
    }
  }
  return merged;
}

function normalizeBinding(
  binding: unknown,
  context: { tier: string; agent: string; source: string }
): TierModelBinding | null {
  if (binding === null) return null;
  if (typeof binding === "string") {
    return { model: requireModel(binding, context), effort: null };
  }
  if (typeof binding !== "object" || Array.isArray(binding)) {
    throw validationError("A coding-agent-models binding must be a model string or { model, effort }.", context);
  }
  const record = binding as { model?: unknown; effort?: unknown };
  const effort = record.effort ?? null;
  if (effort !== null && !(REASONING_EFFORTS as readonly string[]).includes(String(effort))) {
    throw validationError("A coding-agent-models binding effort must be a known reasoning effort.", {
      ...context,
      effort,
      knownEfforts: [...REASONING_EFFORTS]
    });
  }
  return { model: requireModel(record.model, context), effort: (effort as ReasoningEffort | null) ?? null };
}

function requireModel(value: unknown, context: { tier: string; agent: string; source: string }): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("A coding-agent-models binding requires a nonblank model.", context);
  }
  return value.trim();
}
