import type Database from "better-sqlite3";
import { resolveOperatorGate } from "../ask/operatorGate.js";
import { listUnsettledAgentAskProposals } from "../ask/settlement.js";

export interface ChainAskState {
  /** Every pending proposal or open Decision that would gate one of the chain's Actions. */
  blocking: Array<{ action: string; kind: string; id: string; requestId: string | null; title: string; settle: string | null }>;
  /** Every pending (unsettled) proposal for the fixture Project. */
  fixturePending: Array<{ id: string; requestId: string; intent: string; targetRef: string | null }>;
  /** Which of the asked request ids are already recorded as proposals anywhere in the workspace. */
  usedRequestIds: string[];
  /** Every fixture proposal with its disposition (pending when unsettled), for the receipt only. */
  fixtureProposals: Array<{ requestId: string; intent: string | null; targetRef: string | null; disposition: string }>;
}

/**
 * Read-only observation for the rehearsal-chain reset: the dispatch gate for
 * each chain Action (the same resolveOperatorGate the tick uses), the pending
 * fixture proposals, the fixture's proposal history and whether the fresh
 * completion ids are unused. It reads a database handle the caller opened
 * read-only and never settles, previews or writes anything.
 */
export function readChainAskState(db: Database.Database, input: { repoRoot: string; projectSlug: string; actionIds: string[]; requestIds: string[] }): ChainAskState {
  const slug = input.projectSlug.toLowerCase();
  const unsettled = listUnsettledAgentAskProposals(db);
  const requestOf = new Map(unsettled.map((row) => [row.id, row.requestId]));
  const blocking: ChainAskState["blocking"] = [];
  for (const action of input.actionIds) {
    const gate = resolveOperatorGate({ db, repoRoot: input.repoRoot, projectSlug: input.projectSlug, selectedActionId: action });
    for (const item of gate.blocking) {
      blocking.push({ action, kind: item.kind, id: item.id, requestId: requestOf.get(item.id) ?? null, title: item.title, settle: item.settleCommand ?? null });
    }
  }
  const fixturePending = unsettled
    .filter((row) => String(row.proposal.normalized.project).toLowerCase() === slug)
    .map((row) => ({ id: row.id, requestId: row.requestId, intent: row.proposal.normalized.intent, targetRef: row.proposal.normalized.targetRef ?? null }));
  const used = db.prepare("SELECT 1 FROM agent_ask_proposals WHERE request_id = ?");
  const usedRequestIds = input.requestIds.filter((id) => Boolean(used.get(id)));
  const fixtureProposals = (db.prepare("SELECT p.request_id, p.proposal_json, s.disposition FROM agent_ask_proposals p LEFT JOIN agent_ask_settlements s ON s.proposal_id = p.id ORDER BY p.rowid").all() as Array<{ request_id: string; proposal_json: string; disposition: string | null }>)
    .map((row) => {
      let normalized: { project?: unknown; intent?: string; targetRef?: string | null } = {};
      try { normalized = JSON.parse(row.proposal_json).normalized ?? {}; } catch { /* an unreadable row is reported as having no project */ }
      return { row, normalized };
    })
    .filter(({ normalized }) => String(normalized.project).toLowerCase() === slug)
    .map(({ row, normalized }) => ({ requestId: row.request_id, intent: normalized.intent ?? null, targetRef: normalized.targetRef ?? null, disposition: row.disposition ?? "pending" }));
  return { blocking, fixturePending, usedRequestIds, fixtureProposals };
}
