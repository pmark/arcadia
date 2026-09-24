import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import {
  resolveAgentIdentity,
  resolveSessionAgentIdentity,
  type AgentGitIdentity
} from "../codingAgents/agentIdentity.js";
import { TIER_AGENTS } from "../codingAgents/modelTiers.js";

export interface IdentityResolveOptions {
  agent: string;
  tier?: string | null;
  model?: string | null;
  effort?: string | null;
}

export interface IdentityResolveData extends AgentGitIdentity {
  gitConfigArgs: string[];
}

/**
 * `arcadia identity resolve` — the semantic Git identity one agent commits
 * under, for a session Arcadia did not launch itself.
 *
 * A launched Session gets `GIT_AUTHOR_*`/`GIT_COMMITTER_*` set on its own
 * process tree by `buildSessionLaunch` (see `src/sessions/index.ts`), so it
 * never has to look this up. An interactive session — this CLI invoked
 * directly inside a terminal, a Claude Code or Codex desktop session, or
 * anything else outside the launcher — has no such environment, so its
 * commits fall back to whatever `git config` says: the operator's own
 * identity. This command is that lookup, so an interactive agent can prefix
 * its own `git commit`/`git -c` invocations with the same name every
 * launched Session would have used, instead of committing as the operator.
 *
 * A noun: it reads the tier registry and prints an identity. It never writes
 * Git configuration itself.
 */
export function runIdentityResolveCommand(options: IdentityResolveOptions): CommandSuccess<IdentityResolveData> {
  const identity = options.tier
    ? resolveAgentIdentity(options.agent, options.tier)
    : resolveSessionAgentIdentity({
        agent: requireTierAgent(options.agent),
        model: requireModel(options.model),
        effort: options.effort ?? null
      });

  const gitConfigArgs = [`user.name=${identity.name}`, `user.email=${identity.email}`].flatMap((entry) => [
    "-c",
    entry
  ]);

  return createSuccess({
    command: "identity resolve",
    data: { ...identity, gitConfigArgs }
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
  const { name, email } = response.data;
  return [`${name} <${email}>`, `git -c user.name=${JSON.stringify(name)} -c user.email=${JSON.stringify(email)} commit ...`];
}
