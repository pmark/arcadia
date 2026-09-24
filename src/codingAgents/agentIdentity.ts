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
 * work, how heavy a model it was, and — when it wasn't building — what kind of
 * judgment it was exercising, without ever being the operator's own identity.
 * Platform is the given name, tier the surname, an optional role is a title
 * prefixed onto that (silent for the default `builder` role), and the email is
 * a matching local address that never leaves this machine.
 */
export interface AgentGitIdentity {
  agent: TierAgent;
  tier: ModelTier;
  role: AgentRole;
  name: string;
  email: string;
}

/**
 * The capacity an agent commits or comments under. `builder` (the default,
 * silent in the name) is doing the work; `critic` is judging someone else's —
 * a code review finding, or a plan critique/refinement — so it never leaves
 * that adversarial capacity looking like ordinary build output. One role
 * covers both critique surfaces: the distinction that matters for the name is
 * builder vs. critic, not which artifact the critique lands on.
 */
export const AGENT_ROLES = ["builder", "critic"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

/** The title prefixed onto the platform+tier name for a non-default role. */
const ROLE_TITLES: Record<AgentRole, string | null> = {
  builder: null,
  critic: "Critic"
};

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

export function agentIdentityName(agent: TierAgent, tier: ModelTier, role: AgentRole = "builder"): string {
  const base = `${AGENT_GIVEN_NAMES[agent]} ${TIER_SURNAMES[tier]}`;
  const title = ROLE_TITLES[role];
  return title ? `${title} ${base}` : base;
}

export function agentIdentityEmail(name: string): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, ".")}@${AGENT_GIT_EMAIL_DOMAIN}`;
}

/** `<name> <<email>>`, ready to sign a posted comment the way a commit trailer signs a commit. */
export function agentIdentitySignature(identity: AgentGitIdentity): string {
  return `${identity.name} <${identity.email}>`;
}

/**
 * Resolve one identity, refusing any platform/tier/role combination the table
 * does not define. Refusing is the point: the alternative is a commit or
 * comment silently falling back to the operator's own identity, which is the
 * defect this module exists to remove.
 */
export function resolveAgentIdentity(agent: string, tier: string, role: string = "builder"): AgentGitIdentity {
  if (!(TIER_AGENTS as readonly string[]).includes(agent) || !isModelTier(tier) || !isAgentRole(role)) {
    throw validationError(`No agent Git identity is defined for platform "${agent}" at the "${tier}" tier in the "${role}" role.`, {
      agent,
      tier,
      role,
      knownAgents: [...TIER_AGENTS],
      knownTiers: [...MODEL_TIERS],
      knownRoles: [...AGENT_ROLES],
      remedy:
        "Use a supported coding platform, model tier, and role. Arcadia will not fall back to the operator's Git identity."
    });
  }
  const name = agentIdentityName(agent as TierAgent, tier, role);
  return { agent: agent as TierAgent, tier, role, name, email: agentIdentityEmail(name) };
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
  role?: string | null;
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
  return resolveAgentIdentity(input.agent, tier, input.role ?? "builder");
}
