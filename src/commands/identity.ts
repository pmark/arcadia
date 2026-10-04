import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import {
  agentIdentityEnvironment,
  agentIdentitySignature,
  agentRoster,
  agentTeammates,
  renderIdentityBlock,
  resolveAgentIdentity,
  resolveSessionAgentIdentity,
  type AgentGitIdentity,
  type AgentRoster,
  type AgentTeammates
} from "../codingAgents/agentIdentity.js";
import { TIER_AGENTS } from "../codingAgents/modelTiers.js";

export interface IdentityResolveOptions {
  agent: string;
  tier?: string | null;
  model?: string | null;
  effort?: string | null;
  /** builder (default) or critic -- see agentIdentity.ts's AgentRole. */
  role?: string | null;
}

export interface IdentityResolveData extends AgentGitIdentity {
  /** GIT_AUTHOR_ and GIT_COMMITTER_ variables to prefix onto one `git` invocation. */
  gitEnv: Record<string, string>;
  /** `<name> <<email>>`, to sign a posted GitHub PR comment with this identity. */
  signature: string;
  /** The other platforms, the operator principal and the authority rule. */
  teammates: Omit<AgentTeammates, "self" | "signature">;
}

/**
 * `arcadia identity resolve` — the semantic identity one agent commits or
 * posts comments under, for a session Arcadia did not launch itself.
 *
 * A launched Session gets `GIT_AUTHOR_*`/`GIT_COMMITTER_*` set on its own
 * process tree by `buildSessionLaunch` (see `src/sessions/index.ts`), so it
 * never has to look this up. An interactive session — this CLI invoked
 * directly inside a terminal, a Claude Code or Codex desktop session, or
 * anything else outside the launcher — has no such environment, so its
 * commits fall back to whatever `git config` says: the operator's own
 * identity. This command is that lookup, so an interactive agent can prefix
 * its own `git commit` with the same identity every launched Session would
 * have used, instead of committing as the operator.
 *
 * `--role` picks the capacity: `builder` (the default) for ordinary work, or
 * `critic` when the agent is providing adversarial feedback -- a code review
 * finding or a plan critique/refinement -- rather than building. Use the
 * critic identity to commit a critique artifact the agent writes itself (a
 * plan-refinement document, a Decision capturing the critique) and to sign a
 * posted comment (a GitHub PR review reply) with the printed `signature` --
 * never to author a fix to the work under critique, which stays a builder
 * commit regardless of who raised the finding. See AGENTS.md's "Agent Git
 * Identity" section.
 *
 * The prefix is `GIT_AUTHOR_*`/`GIT_COMMITTER_*` environment variables, not
 * `git -c user.*`: Git resolves `author.*`/`committer.*` config (if the
 * repository sets those more specific keys) and any already-exported
 * `GIT_AUTHOR_*`/`GIT_COMMITTER_*` — e.g. left over from an Arcadia launch
 * whose tier no longer matches a since-switched model — ahead of `user.*`,
 * so a `-c user.*` override can silently lose. Re-exporting the same four
 * environment variables on the commit itself outranks all of that.
 *
 * A noun: it reads the tier registry and prints an identity. It never writes
 * Git configuration itself.
 */
export function runIdentityResolveCommand(options: IdentityResolveOptions): CommandSuccess<IdentityResolveData> {
  const role = options.role ?? "builder";
  const identity = options.tier
    ? resolveAgentIdentity(options.agent, options.tier, role)
    : resolveSessionAgentIdentity({
        agent: requireTierAgent(options.agent),
        model: requireModel(options.model),
        effort: options.effort ?? null,
        role
      });

  return createSuccess({
    command: "identity resolve",
    data: {
      ...identity,
      gitEnv: agentIdentityEnvironment(identity),
      signature: agentIdentitySignature(identity),
      teammates: (({ self: _self, signature: _signature, ...rest }) => rest)(agentTeammates(identity))
    }
  });
}

function requireTierAgent(agent: string): (typeof TIER_AGENTS)[number] {
  if ((TIER_AGENTS as readonly string[]).includes(agent)) {
    return agent as (typeof TIER_AGENTS)[number];
  }
  throw validationError(`"${agent}" is not a coding agent Arcadia has an identity for.`, {
    agent,
    knownAgents: [...TIER_AGENTS],
    remedy: "Pass --agent codex, --agent claude, or --agent opencode."
  });
}

function requireModel(model: string | null | undefined): string {
  if (model && model.trim().length > 0) return model.trim();
  throw validationError("`arcadia identity resolve` needs either --tier or --model to resolve an identity.", {
    remedy: "Pass --tier light/standard/heavy directly, or --model (with --effort) to resolve one."
  });
}

export function renderIdentityResolveSuccess(response: CommandSuccess<IdentityResolveData>): string[] {
  const { name, email, gitEnv, signature } = response.data;
  const prefix = Object.entries(gitEnv)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  return [
    `${name} <${email}>`,
    `${prefix} git commit`,
    `Comment signature: — ${signature}`,
    "",
    ...renderIdentityBlock(response.data)
  ];
}

/**
 * `arcadia identity roster` — every identity any agent can sign as, from the
 * same tables `identity resolve` uses. A noun: it reads and prints.
 */
export function runIdentityRosterCommand(): CommandSuccess<AgentRoster> {
  return createSuccess({ command: "identity roster", data: agentRoster() });
}

export function renderIdentityRosterSuccess(response: CommandSuccess<AgentRoster>): string[] {
  const roster = response.data;
  const lines = [
    `Tier surnames: ${Object.entries(roster.tierSurnames).map(([tier, surname]) => `${tier} ${surname}`).join(", ")}; ` +
      `critic title "${roster.criticTitle}"; addresses @${roster.emailDomain}.`
  ];
  for (const platform of roster.platforms) {
    lines.push(`${platform.givenName} (${platform.agent}):`);
    for (const identity of platform.identities) {
      lines.push(`  ${identity.tier} ${identity.role}: ${identity.name} <${identity.email}>`);
    }
  }
  lines.push(roster.operator.rule, roster.rule);
  return lines;
}
