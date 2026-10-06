import {
  agentIdentityName,
  agentRoster,
  AGENT_GIT_EMAIL_DOMAIN,
  tierForAgentModel,
  tierForReasoningEffort
} from "../codingAgents/agentIdentity.js";
import type { TierAgent } from "../codingAgents/modelTiers.js";
import { parseActionRef, parseAgentRef, PEER_WATCH_TRAILERS } from "../agentWatch/contract.js";
import { UNKNOWN_ACTOR, type AgentTool, type Confidence, type TimelineActor } from "./schema.js";

/**
 * Recovering who did something from the evidence a source leaves behind.
 *
 * Each function returns the actor it can justify plus one provenance line; a
 * caller combines them with `strongestActor`. Nothing here infers an identity
 * the evidence does not carry: an unrecognised email stays `unknown`.
 */

export interface ActorClaim {
  actor: TimelineActor;
  provenance: string;
}

const TOOL_FOR_AGENT: Record<TierAgent, AgentTool> = {
  claude: "claude-code",
  codex: "codex",
  opencode: "opencode"
};

const TOOL_FOR_PROVIDER: Record<string, TierAgent> = {
  "claude-code-cli": "claude",
  "codex-cli": "codex",
  "opencode-cli": "opencode"
};

const CONFIDENCE_RANK: Record<Confidence, number> = { none: 0, low: 1, medium: 2, high: 3 };

interface RosterEntry {
  tool: AgentTool;
  name: string;
  tier: string;
  role: string;
}

let rosterByEmail: Map<string, RosterEntry> | null = null;
let rosterByName: Map<string, RosterEntry> | null = null;

function roster(): { byEmail: Map<string, RosterEntry>; byName: Map<string, RosterEntry> } {
  if (!rosterByEmail || !rosterByName) {
    rosterByEmail = new Map();
    rosterByName = new Map();
    for (const platform of agentRoster().platforms) {
      for (const identity of platform.identities) {
        const entry = { tool: TOOL_FOR_AGENT[platform.agent], name: identity.name, tier: identity.tier, role: identity.role };
        rosterByEmail.set(identity.email.toLowerCase(), entry);
        rosterByName.set(identity.name.toLowerCase(), entry);
      }
    }
  }
  return { byEmail: rosterByEmail, byName: rosterByName };
}

function actor(partial: Partial<TimelineActor> & { tool: AgentTool; confidence: Confidence }): TimelineActor {
  return { ...UNKNOWN_ACTOR, ...partial };
}

/** `~/.claude/worktrees/…` → claude-code. The tool that created the worktree, which is normally the one working in it. */
export function toolFromWorktreePath(worktreePath: string | null | undefined): ActorClaim | null {
  if (!worktreePath) return null;
  const match = /\/\.(claude|codex|opencode)\/worktrees\//.exec(worktreePath);
  if (!match) return null;
  const tool = TOOL_FOR_AGENT[match[1] as TierAgent];
  return {
    actor: actor({ tool, confidence: "medium" }),
    provenance: `tool from worktree path prefix .${match[1]}/worktrees (the tool that created the worktree)`
  };
}

/** `claude/…`, `codex/…`, `opencode/…` branch prefixes, as Arcadia's worktree preparation names them. */
export function toolFromBranch(branch: string | null | undefined): ActorClaim | null {
  if (!branch) return null;
  const short = branch.replace(/^refs\/heads\//, "").replace(/^(refs\/remotes\/)?origin\//, "");
  const match = /^(claude|codex|opencode)\//.exec(short);
  if (!match) return null;
  return {
    actor: actor({ tool: TOOL_FOR_AGENT[match[1] as TierAgent], confidence: "medium" }),
    provenance: `tool from branch prefix ${match[1]}/`
  };
}

/**
 * A Git author or committer email. Agent identities are `<given>.<surname>@agents.arcadia.local`
 * from the checked-in roster (src/codingAgents/agentIdentity.ts); the Arcadia controller is the
 * host worker; an address in `operatorEmails` (the repositories' configured user.email) is the
 * operator's local Git identity, which Arcadia's own settlement commits outside a Session also use.
 */
export function actorFromEmail(
  email: string | null | undefined,
  options: { operatorEmails?: ReadonlySet<string>; label?: string } = {}
): ActorClaim | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const label = options.label ?? "author";
  const entry = roster().byEmail.get(normalized);
  if (entry) {
    return {
      actor: actor({ tool: entry.tool, name: entry.name, tier: entry.tier, role: entry.role, confidence: "high" }),
      provenance: `actor from ${label} email ${normalized} (agent identity roster)`
    };
  }
  if (normalized.endsWith(`@${AGENT_GIT_EMAIL_DOMAIN}`)) {
    if (normalized === `controller@${AGENT_GIT_EMAIL_DOMAIN}`) return hostController(normalized, label);
    return {
      actor: actor({ tool: "unknown", confidence: "low" }),
      provenance: `${label} email ${normalized} uses the agent domain but is not in the roster`
    };
  }
  if (normalized === "controller@arcadia.local") return hostController(normalized, label);
  if (options.operatorEmails?.has(normalized)) {
    // The address itself is personal and never enters the stream; only its role does.
    return {
      actor: actor({ tool: "operator", account: "operator's local Git identity", confidence: "low" }),
      provenance:
        `${label} email is a repository's configured user.email (the operator's local Git identity); ` +
        "Arcadia settlement and pointer commits made outside a Session also use it, so the operator authorised it but may not have typed it"
    };
  }
  return null;
}

function hostController(email: string, label: string): ActorClaim {
  return {
    actor: actor({ tool: "host-worker", name: "Arcadia Controller", confidence: "high" }),
    provenance: `actor from ${label} email ${email} (Arcadia controller identity)`
  };
}

/** `Co-authored-by:` trailers. An agent-roster address is strong; a bare model trailer is weak (OpenCode can run Claude models too). */
export function actorFromCoAuthors(trailers: readonly string[]): ActorClaim | null {
  const agents: RosterEntry[] = [];
  let model: string | null = null;
  for (const trailer of trailers) {
    const email = /<([^>]+)>/.exec(trailer)?.[1]?.toLowerCase();
    const entry = email ? roster().byEmail.get(email) : undefined;
    if (entry) agents.push(entry);
    else if (email === "noreply@anthropic.com") model = trailer.replace(/<[^>]*>/, "").trim();
  }
  const distinct = [...new Map(agents.map((entry) => [entry.name, entry])).values()];
  if (distinct.length === 1) {
    const entry = distinct[0];
    return {
      actor: actor({ tool: entry.tool, name: entry.name, tier: entry.tier, role: entry.role, confidence: "medium" }),
      provenance: `actor from Co-authored-by trailer ${entry.name}`
    };
  }
  if (distinct.length > 1) {
    const tools = [...new Set(distinct.map((entry) => entry.tool))];
    return {
      actor: actor({ tool: tools.length === 1 ? tools[0] : "unknown", confidence: "low" }),
      provenance: `several agent Co-authored-by trailers (${distinct.map((entry) => entry.name).join(", ")})`
    };
  }
  if (model) {
    return {
      actor: actor({ tool: "claude-code", confidence: "low" }),
      provenance: `tool from model trailer "${model}" only (a Claude model; OpenCode can also run one)`
    };
  }
  return null;
}

/** A semantic name such as `Claudia Mason`, as an operator ping's `agent` column records it. */
export function actorFromName(name: string | null | undefined): ActorClaim | null {
  if (!name) return null;
  const entry = roster().byName.get(name.trim().toLowerCase());
  if (!entry) return null;
  return {
    actor: actor({ tool: entry.tool, name: entry.name, tier: entry.tier, role: entry.role, confidence: "medium" }),
    provenance: `actor from self-reported agent name "${entry.name}"`
  };
}

/** A Session row: provider names the tool exactly; the model (or effort) names the tier, and with it the semantic name. */
export function actorFromSession(session: { provider: string; model?: string | null; effort?: string | null }): ActorClaim | null {
  const agent = TOOL_FOR_PROVIDER[session.provider];
  if (!agent) return null;
  let tier: string | null;
  let tierSource = "";
  try {
    tier = session.model ? tierForAgentModel(agent, session.model) : null;
    if (tier) tierSource = `model ${session.model}`;
  } catch {
    tier = null;
  }
  if (!tier) {
    tier = tierForReasoningEffort(session.effort);
    if (tier) tierSource = `effort ${session.effort}`;
  }
  const name = tier ? agentIdentityName(agent, tier as Parameters<typeof agentIdentityName>[1]) : null;
  return {
    actor: actor({ tool: TOOL_FOR_AGENT[agent], name, tier, role: null, confidence: "high" }),
    provenance:
      `tool from Session.provider ${session.provider}` +
      (tier ? `; tier and name from ${tierSource}` : "; tier unknown (model not bound to a tier)")
  };
}

/** A provider id alone (an admission row). */
export function actorFromProvider(provider: string | null | undefined): ActorClaim | null {
  if (!provider) return null;
  const agent = TOOL_FOR_PROVIDER[provider];
  if (!agent) return null;
  return { actor: actor({ tool: TOOL_FOR_AGENT[agent], confidence: "medium" }), provenance: `tool from provider ${provider}` };
}

/**
 * A role attempt's `actor_id`: `host-planner:work-plan` and `host-critic:…` are Arcadia's own
 * deterministic roles; `qa-reviewer:codex-terra` names a reviewer profile whose prefix is the tool.
 */
export function actorFromRoleActorId(actorId: string, role: string): ActorClaim {
  if (actorId.startsWith("host-")) {
    return {
      actor: actor({ tool: "host-worker", role, confidence: "high" }),
      provenance: `actor_id ${actorId} is a host role (Arcadia machinery)`
    };
  }
  const profile = actorId.split(":")[1] ?? "";
  const match = /^(claude|codex|opencode)/.exec(profile);
  if (match) {
    return {
      actor: actor({ tool: TOOL_FOR_AGENT[match[1] as TierAgent], role, confidence: "medium" }),
      provenance: `tool from reviewer profile ${profile} in actor_id`
    };
  }
  return {
    actor: actor({ tool: "unknown", role, confidence: "low" }),
    provenance: `actor_id ${actorId} names no tool; role ${role} from the attempt row`
  };
}

export function operatorActor(provenance: string, account: string | null = null): ActorClaim {
  return { actor: actor({ tool: "operator", account, confidence: "medium" }), provenance };
}

export function hostWorkerActor(provenance: string): ActorClaim {
  return { actor: actor({ tool: "host-worker", confidence: "high" }), provenance };
}

/**
 * Combines claims: the most confident wins; a weaker claim that agrees on the
 * tool fills a missing name, tier or role; every claim is kept in provenance.
 */
export function strongestActor(claims: ReadonlyArray<ActorClaim | null | undefined>): ActorClaim {
  const present = claims.filter((claim): claim is ActorClaim => Boolean(claim));
  if (present.length === 0) return { actor: { ...UNKNOWN_ACTOR }, provenance: "no evidence names the actor" };
  const ranked = [...present].sort((a, b) => CONFIDENCE_RANK[b.actor.confidence] - CONFIDENCE_RANK[a.actor.confidence]);
  const best = { ...ranked[0].actor };
  for (const claim of ranked.slice(1)) {
    if (claim.actor.tool !== best.tool) continue;
    best.name ??= claim.actor.name;
    best.tier ??= claim.actor.tier;
    best.role ??= claim.actor.role;
    best.account ??= claim.actor.account;
  }
  const disagree = ranked.some((claim) => claim.actor.tool !== best.tool && claim.actor.tool !== "unknown");
  return {
    actor: best,
    provenance: ranked.map((claim) => claim.provenance).join("; ") + (disagree ? "; NOTE: weaker evidence names a different tool" : "")
  };
}

/** `codex/operator-timeline-phase-1-20261006T044735866Z` → `operator-timeline-phase-1`: the Action slug Arcadia's worktree preparation encodes. */
export function actionHintFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null;
  const short = branch.replace(/^refs\/heads\//, "").replace(/^(refs\/remotes\/)?origin\//, "");
  const match = /^(?:claude|codex|opencode)\/(.+?)-(\d{8}T\d{6,9}Z?)$/.exec(short);
  return match ? match[1] : null;
}

/**
 * The peer-watch contract's `Arcadia-Agent: <agent>/<tier>` commit trailer (src/agentWatch/contract.ts).
 * No launcher writes it yet, but a commit that carries it names its agent and tier exactly.
 */
export function actorFromPeerWatchTrailer(value: string | null | undefined): ActorClaim | null {
  const ref = value ? parseAgentRef(value.trim()) : null;
  if (!ref) return null;
  return {
    actor: actor({ tool: TOOL_FOR_AGENT[ref.agent], tier: ref.tier, name: agentIdentityName(ref.agent, ref.tier), confidence: "high" }),
    provenance: `actor from the ${PEER_WATCH_TRAILERS.agent} trailer ${ref.agent}/${ref.tier} (peer-watch contract)`
  };
}

/** The peer-watch contract's `Arcadia-Action: <project>/<action>` trailer. */
export function actionFromPeerWatchTrailer(value: string | null | undefined): { project: string; action: string } | null {
  const ref = value ? parseActionRef(value.trim()) : null;
  return ref ? { project: ref.project, action: ref.actionId } : null;
}
