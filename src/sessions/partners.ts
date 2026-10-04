import type Database from "better-sqlite3";
import { renderSessionIdentityBlock, resolveSessionAgentIdentity, type AgentPartner } from "../codingAgents/agentIdentity.js";
import { TIER_AGENTS, resolveHandoffModel, type ModelTierRegistry, type TierAgent } from "../codingAgents/modelTiers.js";
import { canonicalPath, hasWorktreeReservationTable, sessionAgentForProvider } from "./index.js";

export interface ProjectPartnersInput {
  projectSlug: string;
  /** The briefed session itself, never its own partner. */
  excludeSessionId?: string | null;
  excludeWorktree?: string | null;
  registry?: ModelTierRegistry;
  now?: Date;
}

/**
 * The other agents working on one Project right now, read only from rows that
 * already exist: live (prepared or running) Sessions, which record their
 * platform and model, and unexpired Action claims, which record neither. A
 * claim's worktree path or branch prefix is never read as its platform, since
 * any agent may hold any candidate. Null when neither table can be read, so
 * the caller omits the partners sentence instead of reporting "none".
 */
export function readProjectPartners(db: Database.Database, input: ProjectPartnersInput): AgentPartner[] | null {
  try {
    const hasSessions = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'").get());
    const hasClaims = hasWorktreeReservationTable(db);
    if (!hasSessions && !hasClaims) return null;
    const exclude = input.excludeWorktree ? canonicalPath(input.excludeWorktree) : null;
    const partners: AgentPartner[] = [];
    const sessionWorktrees = new Set<string>();

    if (hasSessions) {
      const rows = db.prepare(`SELECT id, provider, model, effort, action_id, worktree_path FROM agent_sessions
        WHERE project_slug = ? AND status IN ('prepared', 'running') ORDER BY prepared_at, id`).all(input.projectSlug) as Array<{
        id: string; provider: string; model: string; effort: string | null; action_id: string; worktree_path: string;
      }>;
      for (const row of rows) {
        const worktree = canonicalPath(row.worktree_path);
        if (row.id === input.excludeSessionId || worktree === exclude) continue;
        sessionWorktrees.add(worktree);
        const launchAgent = sessionAgentForProvider(row.provider);
        const agent = launchAgent && (TIER_AGENTS as readonly string[]).includes(launchAgent) ? (launchAgent as TierAgent) : null;
        let identity = null;
        if (agent) {
          try {
            identity = resolveSessionAgentIdentity({ agent, model: row.model, effort: row.effort, registry: input.registry });
          } catch {
            identity = null;
          }
        }
        partners.push({ source: "session", actionId: row.action_id, agent, identity });
      }
    }

    if (hasClaims) {
      const rows = db.prepare(`SELECT worktree_path, action_id FROM agent_worktree_reservations
        WHERE project = ? AND action_id IS NOT NULL AND expires_at > ? ORDER BY created_at, id`)
        .all(input.projectSlug, (input.now ?? new Date()).toISOString()) as Array<{ worktree_path: string; action_id: string }>;
      for (const row of rows) {
        const worktree = canonicalPath(row.worktree_path);
        if (worktree === exclude || sessionWorktrees.has(worktree)) continue;
        partners.push({ source: "claim", actionId: row.action_id, agent: null, identity: null });
      }
    }
    return partners;
  } catch {
    return null;
  }
}

export interface DispatchIdentityInput {
  agent: string;
  /** The session's concrete model, when the caller already selected one. */
  model?: string | null;
  effort?: string | null;
  /** Otherwise the Plan's recommendation, resolved for this agent exactly as `go` resolves it. */
  recommendedModel?: string | null;
  recommendedEffort?: string | null;
  registry?: ModelTierRegistry;
  partners: AgentPartner[] | null;
}

/**
 * The Identity block for a dispatch brief whose session has not launched yet:
 * the model is the one the caller selected, or else the Plan's recommendation
 * resolved for this agent. Either way the block says the resolved tier is
 * authoritative and tells an agent running a different model to resolve its
 * own identity.
 */
export function renderDispatchIdentityBlock(input: DispatchIdentityInput): string[] {
  let model = input.model ?? null;
  let effort = input.effort ?? null;
  if (!model && input.recommendedModel && (TIER_AGENTS as readonly string[]).includes(input.agent)) {
    try {
      const resolved = resolveHandoffModel({
        agent: input.agent as TierAgent,
        recommendedModel: input.recommendedModel,
        explicitEffort: null,
        planEffort: input.recommendedEffort ?? null,
        registry: input.registry
      });
      model = resolved.model;
      effort = resolved.effort;
    } catch {
      model = null;
    }
  }
  return renderSessionIdentityBlock({ agent: input.agent, model, effort, registry: input.registry, partners: input.partners });
}
