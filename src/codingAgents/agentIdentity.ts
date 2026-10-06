import { validationError } from "../cli/errors.js";
import {
  BUNDLED_MODEL_TIERS,
  MODEL_TIERS,
  TIER_AGENTS,
  type ModelTier,
  type ModelTierRegistry,
  type TierAgent
} from "./modelTiers.js";

/** Effort levels used to choose the semantic identity surname. */
export const AGENT_EFFORT_TIERS = ["light", "standard", "heavy"] as const;
export type AgentEffortTier = (typeof AGENT_EFFORT_TIERS)[number];

function isAgentEffortTier(value: string): value is AgentEffortTier {
  return (AGENT_EFFORT_TIERS as readonly string[]).includes(value);
}

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
  /** Reasoning-effort tier used for the semantic identity surname. */
  tier: AgentEffortTier;
  role: AgentRole;
  name: string;
  email: string;
  /** Concrete provider model selected for this session, independent of tier. */
  model?: string | null;
  /** Provider reasoning effort used to derive the identity tier. */
  effort?: string | null;
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

const TIER_SURNAMES: Record<AgentEffortTier, string> = {
  light: "Swift",
  standard: "Mason",
  heavy: "Atlas"
};

/**
 * A provider-native reasoning effort read back to the identity effort tier.
 * This is independent of the model-selection tier in modelTiers.ts.
 */
const EFFORT_TIERS: Record<string, AgentEffortTier> = {
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

export function agentIdentityName(agent: TierAgent, tier: AgentEffortTier, role: AgentRole = "builder"): string {
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
  if (!(TIER_AGENTS as readonly string[]).includes(agent) || !isAgentEffortTier(tier) || !isAgentRole(role)) {
    throw validationError(`No agent Git identity is defined for platform "${agent}" at the "${tier}" tier in the "${role}" role.`, {
      agent,
      tier,
      role,
      knownAgents: [...TIER_AGENTS],
      knownTiers: [...AGENT_EFFORT_TIERS],
      knownRoles: [...AGENT_ROLES],
      remedy:
        "Use a supported coding platform, reasoning-effort tier, and role. Arcadia will not fall back to the operator's Git identity."
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
 * The model-selection tier a concrete model belongs to for one agent, by
 * reverse lookup in the selection registry. This is not the session's effort
 * tier and must not determine its identity surname. Null when the model is not
 * bound to a selection tier; throwing when it is bound more than once.
 */
export function modelSelectionTierForAgentModel(
  agent: TierAgent,
  model: string,
  registry: ModelTierRegistry = BUNDLED_MODEL_TIERS
): ModelTier | null {
  const value = model.trim();
  const matches = MODEL_TIERS.filter((tier) => registry.tiers[tier][agent]?.model === value);
  if (matches.length > 1) {
    throw validationError(`The model "${value}" has an ambiguous binding across ${agent} model-selection tiers.`, {
      agent,
      model: value,
      tiers: matches,
      remedy: "Bind each model to exactly one model-selection tier in config/coding-agent-models.json."
    });
  }
  return matches[0] ?? null;
}

/** @deprecated Use modelSelectionTierForAgentModel to distinguish selection from effort. */
export const tierForAgentModel = modelSelectionTierForAgentModel;

export function tierForReasoningEffort(effort: string | null | undefined): AgentEffortTier | null {
  if (!effort) return null;
  return EFFORT_TIERS[effort.trim()] ?? null;
}

function defaultEffortForAgentModel(agent: TierAgent, model: string, registry: ModelTierRegistry): string | null {
  const selectionTier = modelSelectionTierForAgentModel(agent, model, registry);
  return selectionTier ? registry.tiers[selectionTier][agent]?.effort ?? null : null;
}

export interface SessionAgentIdentityInput {
  agent: TierAgent;
  model: string;
  effort?: string | null;
  role?: string | null;
  registry?: ModelTierRegistry;
}

/**
 * Resolve a launched session identity from its platform, selected model, and
 * reasoning effort. The effort determines the identity tier; the concrete
 * model is retained separately. If effort is omitted, use the selected model
 * binding's explicit default effort, never its model-selection tier.
 */
export function resolveSessionAgentIdentity(input: SessionAgentIdentityInput): AgentGitIdentity {
  const registry = input.registry ?? BUNDLED_MODEL_TIERS;
  const selectedModel = input.model.trim();
  const explicitEffort = input.effort?.trim() || null;
  const effort = explicitEffort ?? defaultEffortForAgentModel(input.agent, selectedModel, registry);
  const tier = tierForReasoningEffort(effort);
  if (!tier) {
    throw validationError(
      `Arcadia cannot determine the reasoning-effort tier for the ${input.agent} model "${selectedModel}".`,
      {
        agent: input.agent,
        model: selectedModel,
        effort,
        remedy:
          "Pass a recognized reasoning effort, or configure an explicit default effort for the selected model in config/coding-agent-models.json. Model-selection tier alone does not determine identity."
      }
    );
  }
  return {
    ...resolveAgentIdentity(input.agent, tier, input.role ?? "builder"),
    model: selectedModel,
    effort
  };
}

/**
 * The human the agents work for. Agents often post through the operator's
 * account (one GitHub login for everyone), so the signature line is the only
 * thing that says who is speaking; the operator is therefore a principal, not
 * a teammate, and has no agent identity to impersonate or be impersonated by.
 */
export const OPERATOR_PRINCIPAL = {
  role: "operator",
  kind: "human",
  rule: "The operator is the human principal, not an agent: never sign as the operator, and the operator never signs as an agent."
} as const;

/** The one rule that settles a disagreement between names. */
export const IDENTITY_AUTHORITY_RULE =
  "The identity resolved for this session's reasoning-effort tier and role is authoritative; selected model and effort are separate values, so resolve again if either changes instead of inventing or reusing a name.";

/**
 * How a session's own `arcadia` commands resolve a workspace, and the opt-in
 * mode that makes a forgotten inline workspace fail instead of reaching the
 * live default (src/workspace/resolve.ts). Arcadia's launcher pins no
 * workspace in a Session's environment, so it does not set the mode either.
 */
export const WORKSPACE_MODE_RULE =
  "Workspace: an arcadia command with no inline workspace resolves the user config default, the live workspace, and Arcadia's launcher does not change that. " +
  "With ARCADIA_REQUIRE_INLINE_WORKSPACE=1 in your own environment (export it in a persistent shell, or start the agent CLI with it; a launched Session never inherits it) such a command fails with INLINE_WORKSPACE_REQUIRED instead; " +
  "then name any workspace, including the live one, inline (ARCADIA_WORKSPACE=<path> arcadia ... or --workspace <path>), never exported.";

export interface RosterIdentity {
  tier: AgentEffortTier;
  role: AgentRole;
  name: string;
  email: string;
}

export interface RosterPlatform {
  agent: TierAgent;
  givenName: string;
  /** Every tier × role identity this platform can sign as, in tier then role order. */
  identities: RosterIdentity[];
}

export interface AgentRoster {
  platforms: RosterPlatform[];
  tierSurnames: Record<AgentEffortTier, string>;
  criticTitle: string;
  emailDomain: string;
  operator: typeof OPERATOR_PRINCIPAL;
  rule: string;
}

/**
 * The whole roster as data: every platform's given name, the tier surnames,
 * the critic title and the local address domain. Pure — derived from the same
 * tables `resolveAgentIdentity` uses, so the two can never disagree.
 */
export function agentRoster(): AgentRoster {
  return {
    platforms: TIER_AGENTS.map((agent) => ({
      agent,
      givenName: AGENT_GIVEN_NAMES[agent],
      identities: AGENT_EFFORT_TIERS.flatMap((tier) =>
        AGENT_ROLES.map((role) => {
          const { name, email } = resolveAgentIdentity(agent, tier, role);
          return { tier, role, name, email };
        })
      )
    })),
    tierSurnames: { ...TIER_SURNAMES },
    criticTitle: ROLE_TITLES.critic ?? "Critic",
    emailDomain: AGENT_GIT_EMAIL_DOMAIN,
    operator: OPERATOR_PRINCIPAL,
    rule: IDENTITY_AUTHORITY_RULE
  };
}

export interface AgentTeammates {
  self: AgentGitIdentity;
  signature: string;
  /** The other platforms, each with every identity (tier × role) it signs as. */
  teammates: RosterPlatform[];
  operator: typeof OPERATOR_PRINCIPAL;
  rule: string;
}

/** For one resolved identity: who it is, who its teammates are, and which name wins. */
export function agentTeammates(identity: AgentGitIdentity): AgentTeammates {
  const self = resolveAgentIdentity(identity.agent, identity.tier, identity.role);
  return {
    self,
    signature: agentIdentitySignature(self),
    teammates: agentRoster().platforms.filter((platform) => platform.agent !== self.agent),
    operator: OPERATOR_PRINCIPAL,
    rule: IDENTITY_AUTHORITY_RULE
  };
}

/**
 * Another agent working on the same Project now, read from existing Session
 * and claim rows. `identity` is null when the row does not say which
 * platform/tier holds it (a bare worktree claim, or a Session whose model no
 * tier binds): that partner is reported without a name rather than guessed.
 */
export interface AgentPartner {
  source: "session" | "claim";
  actionId: string | null;
  agent: TierAgent | null;
  identity: AgentGitIdentity | null;
}

const IDENTITY_HEADING = "Identity:";

function describeIdentity(identity: AgentGitIdentity): string {
  return `${agentIdentitySignature(identity)} (${identity.agent}, ${identity.tier}, ${identity.role})`;
}

function describeTeammate(platform: RosterPlatform): string {
  const surnames = AGENT_EFFORT_TIERS.map((tier) => TIER_SURNAMES[tier]).join("/");
  return `${platform.givenName} ${surnames} (${platform.agent})`;
}

/** An Action id as the Plan schema shapes it; anything else from a row is never echoed into a prompt. */
const SAFE_ACTION_ID = /^[A-Za-z0-9._:-]+$/;

function describePartner(partner: AgentPartner): string {
  if (partner.actionId !== null && !SAFE_ACTION_ID.test(partner.actionId)) return "an unattributed claim";
  const where = partner.actionId ? ` on Action ${partner.actionId}` : "";
  if (partner.identity) return `${describeIdentity(partner.identity)}${where}`;
  const who = partner.agent ? `${partner.agent} Session (tier unresolved)` : "an unattributed claim";
  return `${who}${where}`;
}

/**
 * The one compact Identity block every generated prompt and brief carries.
 * `partners` null means the Session and claim rows could not be read, so the
 * partners sentence is omitted rather than guessed; an empty list says so.
 */
export function renderIdentityBlock(identity: AgentGitIdentity, partners: AgentPartner[] | null = null): string[] {
  const { self, teammates } = agentTeammates(identity);
  const lines = [
    IDENTITY_HEADING,
    `You are ${describeIdentity(self)}; sign every comment and commit exactly so, never as another tier or name.`,
    ...(identity.model
      ? [`Selected model: ${identity.model}; reasoning effort: ${identity.effort ?? "unspecified"}. The identity tier reflects effort.`]
      : []),
    IDENTITY_AUTHORITY_RULE,
    `Your teammates are ${teammates.map(describeTeammate).join(" and ")}, by reasoning-effort tier ${AGENT_EFFORT_TIERS.join("/")}, ` +
      `titled "${ROLE_TITLES.critic}" when critiquing, at <name.in.dots>@${AGENT_GIT_EMAIL_DOMAIN}. ${OPERATOR_PRINCIPAL.rule}`,
    WORKSPACE_MODE_RULE
  ];
  if (partners) {
    lines.push(
      `Your current partners on this Project, from live claims and Sessions, are: ${
        partners.length > 0 ? partners.map(describePartner).join("; ") : "none"
      }.`
    );
  }
  return lines;
}

export interface SessionIdentityBlockInput {
  agent: string;
  /** An effort tier, when the caller already knows it; otherwise resolved from effort/default effort. */
  tier?: string | null;
  model?: string | null;
  effort?: string | null;
  role?: string | null;
  registry?: ModelTierRegistry;
  partners?: AgentPartner[] | null;
}

/**
 * The Identity block for a session that is about to be briefed, from whatever
 * the caller knows about its platform and model. When no identity can be
 * resolved the block still appears, but names nobody: it tells the agent to
 * resolve its own identity and never to fall back to the operator's.
 */
export function renderSessionIdentityBlock(input: SessionIdentityBlockInput): string[] {
  const role = input.role ?? "builder";
  let identity: AgentGitIdentity | null = null;
  try {
    if (input.tier) {
      identity = {
        ...resolveAgentIdentity(input.agent, input.tier, role),
        ...(input.model ? { model: input.model.trim(), effort: input.effort?.trim() || null } : {})
      };
    }
    else if ((TIER_AGENTS as readonly string[]).includes(input.agent) && input.model) {
      identity = resolveSessionAgentIdentity({
        agent: input.agent as TierAgent,
        model: input.model,
        effort: input.effort ?? null,
        role,
        registry: input.registry
      });
    }
  } catch {
    identity = null;
  }
  if (identity) return renderIdentityBlock(identity, input.partners ?? null);
  return [
    IDENTITY_HEADING,
    `Your identity is unresolved for platform "${input.agent}"${input.model ? ` and model "${input.model}"` : ""}: ` +
      `before any commit or comment run \`arcadia identity resolve --agent <platform> --tier <light|standard|heavy> --role ${role}\` ` +
      "for the model actually doing the work " +
      `and sign exactly as it prints; ${OPERATOR_PRINCIPAL.rule.charAt(0).toLowerCase()}${OPERATOR_PRINCIPAL.rule.slice(1)}`,
    WORKSPACE_MODE_RULE
  ];
}

/**
 * The reviewer's variant of the Identity block. A read-only reviewer runs no
 * commands, posts nothing and only returns a structured verdict, so it is told
 * only which critic identity the verdict is attributed to and that it is
 * independent of the developer: no signing instruction, no command, no
 * partners, and no developer named.
 */
export function renderReviewerIdentityBlock(input: Omit<SessionIdentityBlockInput, "role" | "partners">): string[] {
  let identity: AgentGitIdentity | null;
  try {
    identity = input.tier
      ? resolveAgentIdentity(input.agent, input.tier, "critic")
      : (TIER_AGENTS as readonly string[]).includes(input.agent) && input.model
        ? resolveSessionAgentIdentity({
            agent: input.agent as TierAgent,
            model: input.model,
            effort: input.effort ?? null,
            role: "critic",
            registry: input.registry
          })
        : null;
  } catch {
    identity = null;
  }
  const independence = "you are independent of the Candidate's developer and judge its work only from the evidence below.";
  return [
    IDENTITY_HEADING,
    identity
      ? `You are ${describeIdentity(identity)}; ${independence}`
      : `Your critic identity is unresolved for platform "${input.agent}"; ${independence}`
  ];
}
