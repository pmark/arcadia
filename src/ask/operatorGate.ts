import type Database from "better-sqlite3";
import type { NormalizedAgentAsk } from "./agentAsk.js";
import { listUnsettledAgentAskProposals } from "./settlement.js";
import { listOpenDecisions, type ReadySetCandidate } from "../docs/dispatch.js";
import {
  classifyOperatorItems,
  type OperatorGateResolution,
  type PendingAgentAskGateInput,
  type PendingDecisionGateInput
} from "../docs/operatorGate.js";

/**
 * One Action id reference, from `action/<id>`, `plan/<slug>#<id>`, or a bare
 * id. Returns null for a reference this Ask uses for something other than an
 * Action (`outcome`, `milestone`, a bare Plan slug) — the same grammar
 * `resolveManagedTargetRef`/`splitPlanScopedActionRef` in `settlement.ts`
 * parse to settle an Ask, kept in sync by hand since neither is exported.
 */
function parseActionRef(ref: string | null): string | null {
  if (!ref) return null;
  const hashIndex = ref.indexOf("#");
  if (hashIndex >= 0) return ref.slice(hashIndex + 1).trim() || null;
  const parts = ref.split("/").filter(Boolean);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 && parts[0] === "action") return parts[1];
  return null;
}

/** Every Action id a normalized Agent Ask names, across its `actions[]` and (for `complete`/`split`) its own `target_ref`. */
function extractActionIds(normalized: NormalizedAgentAsk): string[] {
  const ids = new Set<string>();
  for (const action of normalized.actions) {
    if (action.id) ids.add(action.id);
    const fromTarget = parseActionRef(action.targetRef);
    if (fromTarget) ids.add(fromTarget);
  }
  if (normalized.intent === "complete" || normalized.intent === "split") {
    const fromTarget = parseActionRef(normalized.targetRef);
    if (fromTarget) ids.add(fromTarget);
  }
  return [...ids];
}

/**
 * Gather every pending operator item (unsettled Agent Ask proposals, open
 * Decisions) and classify them against the dispatch resolution this call
 * would otherwise hand off.
 *
 * The single gatherer behind the operator gate: `resolveProjectTransition`
 * (the shared launch chokepoint for `go`, `advance`, and the production
 * scheduler), `next`, and any future caller all read the same pending items
 * through this one function, so none of them re-derives the surface
 * `surface-terminal-operator-approvals-in-runs` already built
 * (`listUnsettledAgentAskProposals`, open Decisions) or drifts from another's
 * classification.
 */
export function resolveOperatorGate(input: {
  db: Database.Database;
  repoRoot: string;
  projectSlug: string;
  /** The Action id the current dispatch resolution would select, or null. */
  selectedActionId: string | null;
  /** Every unfinished Action's readiness in the active plan's queue segment, when already computed. */
  readySetCandidates?: ReadySetCandidate[];
}): OperatorGateResolution {
  const agentAsks: PendingAgentAskGateInput[] = listUnsettledAgentAskProposals(input.db).map((row) => ({
    proposalId: row.id,
    requestId: row.requestId,
    projectSlug: row.proposal.normalized.project,
    desiredResult: row.proposal.normalized.desiredResult,
    actionIds: extractActionIds(row.proposal.normalized),
    options: row.proposal.normalized.options ?? [],
    createdAt: row.createdAt
  }));

  const decisions: PendingDecisionGateInput[] = listOpenDecisions(input.repoRoot, input.projectSlug).map((doc) => ({
    id: doc.id,
    projectSlug: doc.project,
    question: doc.question,
    actionId: doc.action,
    options: doc.options,
    updated: doc.updated,
    relativePath: doc.relativePath
  }));

  const blockingDecisionIds = (input.readySetCandidates ?? [])
    .flatMap((candidate) => [candidate.deferringDecisionId, candidate.requiredDecisionId])
    .filter((id): id is string => id !== null);

  return classifyOperatorItems({
    projectSlug: input.projectSlug,
    selectedActionId: input.selectedActionId,
    blockingDecisionIds,
    decisions,
    agentAsks
  });
}
