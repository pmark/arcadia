import { validationError } from "../cli/errors.js";
import {
  BUNDLED_MODEL_TIERS,
  MODEL_TIERS,
  TIER_AGENTS,
  isModelTier,
  type ModelTier,
  type ModelTierRegistry,
  type TierAgent
} from "./modelTiers.js";

/**
 * The Git identity an Arcadia-dispatched coding agent commits under.
 *
 * Git history is the one record every session leaves whether or not anyone
 * files a receipt, so the name on the commit should say which platform did the
 * work and how heavy a model it was, without ever being the operator's own
 * identity. Platform is the given name, tier the surname, and the email is a
 * matching local address that never leaves this machine.
 */
export interface AgentGitIdentity {
  agent: TierAgent;
  tier: ModelTier;
  name: string;
  email: string;
}

/** The domain every agent address uses. Local-only by construction. */
export const AGENT_GIT_EMAIL_DOMAIN = "agents.arcadia.local";

const AGENT_GIVEN_NAMES: Record<TierAgent, string> = {
  codex: "Cody",
  claude: "Claudia",
  opencode: "Owen"
};

const TIER_SURNAMES: Record<ModelTier, string> = {
  light: "Swift",
  standard: "Mason",
  heavy: "Atlas"
};

/**
 * A provider-native reasoning effort read back to a model tier. Used only when
 * a session's concrete model is not one the tier registry binds, so a custom or
 * explicit model still resolves to an identity instead of the operator's.
 */
const EFFORT_TIERS: Record<string, ModelTier> = {
  e1_brief: "light",
  e2_standard: "standard",
  e3_deep: "heavy",
  e4_rigorous: "heavy",
  minimal: "light",
  low: "light",
  medium: "standard",
  high: "heavy",
  xhigh: "heavy",
  max: "heavy"
};

export function agentIdentityName(agent: TierAgent, tier: ModelTier): string {
  return `${AGENT_GIVEN_NAMES[agent]} ${TIER_SURNAMES[tier]}`;
}

export function agentIdentityEmail(name: string): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, ".")}@${AGENT_GIT_EMAIL_DOMAIN}`;
}

/**
 * Resolve one identity, refusing any platform/tier pair the table does not
 * define. Refusing is the point: the alternative is a commit silently falling
 * back to the operator's configured Git identity, which is the defect this
 * module exists to remove.
 */
export function resolveAgentIdentity(agent: string, tier: string): AgentGitIdentity {
  if (!(TIER_AGENTS as readonly string[]).includes(agent) || !isModelTier(tier)) {
    throw validationError(`No agent Git identity is defined for platform "${agent}" at the "${tier}" tier.`, {
      agent,
      tier,
      knownAgents: [...TIER_AGENTS],
      knownTiers: [...MODEL_TIERS],
      remedy:
        "Use a supported coding platform and model tier. Arcadia will not fall back to the operator's Git identity."
    });
  }
  const name = agentIdentityName(agent as TierAgent, tier);
  return { agent: agent as TierAgent, tier, name, email: agentIdentityEmail(name) };
}

/**
 * The four Git variables that set both the author and the committer for a
 * process tree. Set on the launched session's environment, they scope the
 * identity to that execution and every child commit it makes — including the
 * ones Arcadia itself creates from inside the session — while leaving the
 * operator's global Git configuration untouched.
 */
export function agentIdentityEnvironment(identity: AgentGitIdentity): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email
  };
}

/** The same environment as `KEY=value` argv entries, for a spawned process. */
export function agentIdentityEnvironmentArgs(identity: AgentGitIdentity): string[] {
  return Object.entries(agentIdentityEnvironment(identity)).map(([key, value]) => `${key}=${value}`);
}

/**
 * The tier a concrete model belongs to for one agent, by reverse lookup in the
 * tier registry. Null when the model is not bound to any tier; throwing when a
 * model is bound to more than one, since guessing which tier did the work would
 * be worse than asking.
 */
export function tierForAgentModel(
  agent: TierAgent,
  model: string,
  registry: ModelTierRegistry = BUNDLED_MODEL_TIERS
): ModelTier | null {
  const value = model.trim();
  const matches = MODEL_TIERS.filter((tier) => registry.tiers[tier][agent]?.model === value);
  if (matches.length > 1) {
    throw validationError(`The model "${value}" is bound to more than one ${agent} tier, so its identity is ambiguous.`, {
      agent,
      model: value,
      tiers: matches,
      remedy: "Bind each model to exactly one tier in config/coding-agent-models.json."
    });
  }
  return matches[0] ?? null;
}

export function tierForReasoningEffort(effort: string | null | undefined): ModelTier | null {
  if (!effort) return null;
  return EFFORT_TIERS[effort.trim()] ?? null;
}

export interface SessionAgentIdentityInput {
  agent: TierAgent;
  model: string;
  effort?: string | null;
  registry?: ModelTierRegistry;
}

/**
 * Resolve the identity for one launched session from its platform and model.
 * The model is the primary signal; its reasoning effort is the fallback for a
 * model the registry does not bind. An unresolvable tier refuses the launch
 * rather than letting the commit use whichever identity Git finds next.
 */
export function resolveSessionAgentIdentity(input: SessionAgentIdentityInput): AgentGitIdentity {
  const registry = input.registry ?? BUNDLED_MODEL_TIERS;
  const tier =
    tierForAgentModel(input.agent, input.model, registry) ?? tierForReasoningEffort(input.effort);
  if (!tier) {
    throw validationError(
      `Arcadia cannot determine the model tier for the ${input.agent} model "${input.model}".`,
      {
        agent: input.agent,
        model: input.model,
        effort: input.effort ?? null,
        remedy:
          "Bind the model to a light/standard/heavy tier in config/coding-agent-models.json, or record a recognized reasoning effort for the session."
      }
    );
  }
  return resolveAgentIdentity(input.agent, tier);
}
