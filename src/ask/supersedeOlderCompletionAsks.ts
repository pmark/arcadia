import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { insertSettlementRow, listUnsettledAgentAskProposals, type AgentAskSettlementReceipt } from "./settlement.js";

export interface SupersededCompletionAsk {
  requestId: string;
  settlementId: string;
}

/**
 * Issue #2786. A later `complete` Ask for an Action settled (auto-settle ran its
 * evidence clean), so an older still-pending `complete` Ask for the same Action
 * is obsolete: it would otherwise hold the Action at `operator_gate_pending`
 * forever, because nothing settles a proposal whose evidence failed.
 *
 * Each such Ask gets a `rejected` settlement row (its receipt names the Ask that
 * superseded it), which is exactly what takes a proposal out of
 * `listUnsettledAgentAskProposals`. No document is written and no notification
 * is queued. Only `complete` Asks for the same Project and Action, created no
 * later than the settled Ask, that carry no options or gate question, are
 * touched: every other intent, and anything that opens or carries a Decision,
 * stays pending for the operator.
 */
export function supersedeOlderPendingCompletionAsks(db: Database.Database, input: {
  projectSlug: string;
  planSlug: string;
  actionId: string;
  /** The request id of the Ask whose evidence settled (the drafted Ask, not its derived auto-settle copy). */
  settledRequestId: string;
  /** The settlement that landed, named in each receipt. */
  settledReceiptId: string;
  /** The settled Ask's own creation time; Asks created after it are never superseded. */
  settledAskCreatedAt: string;
}): SupersededCompletionAsk[] {
  const targetRefs = new Set([`action/${input.actionId}`, `plan/${input.planSlug}#${input.actionId}`]);
  const superseded: SupersededCompletionAsk[] = [];
  const now = new Date().toISOString();
  for (const row of listUnsettledAgentAskProposals(db)) {
    const ask = row.proposal.normalized;
    if (row.requestId === input.settledRequestId) continue;
    if (ask.intent !== "complete" || ask.project !== input.projectSlug) continue;
    if (!ask.targetRef || !targetRefs.has(ask.targetRef)) continue;
    if ((ask.options?.length ?? 0) > 0 || ask.gateQuestion) continue;
    if (row.createdAt > input.settledAskCreatedAt) continue;
    const settlementRequestId = `superseded-${row.requestId}`.slice(0, 120);
    const receipt: AgentAskSettlementReceipt = {
      id: `asksettle_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      proposalId: row.id,
      proposalRequestId: row.requestId,
      settlementRequestId,
      disposition: "rejected",
      projectSlug: input.projectSlug,
      intent: ask.intent,
      effects: [`Superseded by completion Ask ${input.settledRequestId} (settlement ${input.settledReceiptId}) for the same Action; created no Project or queue changes (#2786).`],
      queueActionKey: null,
      queueActionKeys: [],
      queuePosition: null,
      nextActionKey: null,
      previewFingerprint: row.proposal.fingerprint,
      applied: true,
      authority: { kind: "deterministic_proof", requestedAuthority: ask.requestedAuthority, boundedPolicyDecision: null },
      notificationStatus: "sent",
      createdAt: now
    };
    db.transaction(() => {
      insertSettlementRow(db, receipt, {
        proposalId: row.id,
        settlementRequestId,
        operation: { supersededBy: input.settledRequestId },
        previewFingerprint: row.proposal.fingerprint,
        effects: receipt.effects,
        queueActionKey: null,
        projectSlug: input.projectSlug,
        now
      });
      db.prepare("UPDATE agent_ask_settlements SET notification_status = 'sent', notified_at = ? WHERE id = ?").run(now, receipt.id);
    })();
    superseded.push({ requestId: row.requestId, settlementId: receipt.id });
  }
  return superseded;
}
