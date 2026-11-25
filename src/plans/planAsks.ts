import type Database from "better-sqlite3";
import { buildAgentAskEffects, normalizeAgentAsk, type AgentAskEffect, type AgentAskProposal } from "../ask/agentAsk.js";
import { listUnsettledAgentAskProposals } from "../ask/settlement.js";

/**
 * The Asks that target one Plan: its annotations and change history. Read-only over the existing
 * `agent_ask_proposals` and `agent_ask_settlements` tables, so an annotation needs no store of its own.
 */

/**
 * `previewed`: an evidence-only Ask (a picker annotation or change request) that waits in the operator's pending Asks;
 * accepting it keeps it as evidence and changes no record. `pending`: awaits the operator's settlement to change
 * records. `settled`: has a terminal disposition.
 */
export type PlanAskState = "previewed" | "pending" | "settled";

export interface PlanAsk {
  proposalId: string;
  requestId: string;
  intent: string;
  targetRef: string | null;
  desiredResult: string;
  rationale: string | null;
  createdAt: string;
  state: PlanAskState;
  disposition: "accepted" | "rejected" | null;
  settledAt: string | null;
}

/** Whether a target ref names this Plan, or one of its Actions (`plan/<slug>#<action>`). */
export function targetsPlan(targetRef: string | null | undefined, planSlug: string): boolean {
  if (!targetRef) return false;
  const ref = targetRef.trim();
  return ref === `plan/${planSlug}` || ref.startsWith(`plan/${planSlug}#`);
}

/**
 * Every Ask whose Project is `projectSlug` and whose target is `plan/<planSlug>` (or an Action in it), newest first.
 * A Plan slug shared by two Projects never mixes them: the Project must match too.
 */
export function listPlanAsks(db: Database.Database, projectSlug: string, planSlug: string): PlanAsk[] {
  const rows = db.prepare(`SELECT p.id, p.request_id, p.proposal_json, p.created_at, s.disposition, s.created_at AS settled_at
      FROM agent_ask_proposals p
      LEFT JOIN agent_ask_settlements s ON s.proposal_id = p.id
      WHERE p.project_ref = ?
      ORDER BY p.created_at DESC, p.id DESC`)
    .all(projectSlug) as Array<{ id: string; request_id: string; proposal_json: string; created_at: string; disposition: "accepted" | "rejected" | null; settled_at: string | null }>;
  const matching = rows.map((row) => ({ row, proposal: JSON.parse(row.proposal_json) as AgentAskProposal }))
    .filter(({ proposal }) => proposal.normalized.project === projectSlug &&
      (targetsPlan(proposal.normalized.targetRef, planSlug) || (proposal.effects ?? []).some((effect) => targetsPlan(effect.targetRef, planSlug))));
  if (matching.length === 0) return [];
  // An unsettled row that the settlement reader no longer lists was settled through a derived copy (Issue #2102).
  const awaiting = new Set(listUnsettledAgentAskProposals(db).map((item) => item.id));
  return matching.map(({ row, proposal }) => {
    const settled = row.disposition !== null || !awaiting.has(row.id);
    return {
      proposalId: row.id,
      requestId: row.request_id,
      intent: proposal.normalized.intent,
      targetRef: proposal.normalized.targetRef ?? null,
      desiredResult: proposal.normalized.desiredResult,
      rationale: proposal.normalized.rationale ?? null,
      createdAt: row.created_at,
      state: settled ? "settled" : proposal.managedDocumentTransition?.required ? "pending" : "previewed",
      disposition: row.disposition,
      settledAt: row.settled_at
    };
  });
}

/** The two picker actions that have a governed Agent Ask today. */
export type PlanAskKind = "annotate" | "request-change";

export interface ComposedPlanAsk {
  ask: Record<string, unknown>;
  effects: AgentAskEffect[];
  requiredDecisions: string[];
}

/**
 * Compose the Agent Ask for a picker action and derive its effects exactly as preview will, without recording
 * anything. Both are evidence-only `proposal` Asks targeting `plan/<slug>` with `requested_authority: propose`.
 * Request change is deliberately never a plan-intent Ask. A targeted plan-intent Ask with no Actions settles by
 * replacing the Plan's Milestone with its desired result (`src/ask/settlement.ts`), so one Accept tap on the operator's words
 * would overwrite a governed record (review of #3039, B1). A `proposal` settles as preserved evidence only; the Lead
 * turns it into governed Plan changes.
 */
export function composePlanAsk(input: { kind: PlanAskKind; project: string; plan: string; text: string; requestId: string }): ComposedPlanAsk {
  const text = input.text.trim();
  if (!text) throw new Error(input.kind === "annotate" ? "Write the note first." : "Say what should change first.");
  const ask = {
    agent_ask: "v1",
    request_id: input.requestId,
    project: input.project,
    intent: "proposal",
    target_ref: `plan/${input.plan}`,
    requested_authority: "propose",
    desired_result: text,
    rationale: input.kind === "annotate"
      ? "Annotation recorded from the Workspace Plan picker. Evidence only; it asks for no change."
      : "Change requested from the Workspace Plan picker in the operator's words, for the Lead to turn into governed Plan changes. Evidence only; accepting it changes no Plan, Milestone, queue or status."
  };
  const normalized = normalizeAgentAsk({ request: JSON.stringify(ask) });
  const built = buildAgentAskEffects(normalized);
  return { ask, effects: built.effects, requiredDecisions: built.requiredDecisions };
}
