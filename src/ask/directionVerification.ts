import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { getArtifact, getReviewItem } from "../db/repositories.js";
import { getMailMessage, directionForMail, assertDirectionMailTarget, assertRecipientScope, listMailReceipts, type MailReceiptRow, type RecipientScope } from "../nativeMail/store.js";
import { parsePersistedQaContext, persistedQaAcceptancePassed, verifyPersistedQaContextEvidence } from "../qa/prReview.js";
import { createId } from "../utils/id.js";
import { getSessionRoleAttempt } from "../sessions/enrollment.js";
import { lineageBoundSessionForBranch, requirementIdFor } from "../sessions/roleLineage.js";
import { completionEvidenceForReview, settledCandidateForReview } from "../sessions/reconciliation.js";
import { completionExecutionPassed } from "../sessions/completionValidationEvidence.js";
import type { AgentAskProposal } from "./agentAsk.js";
import type { AgentAskSettlementReceipt } from "./settlement.js";
import { requireAcceptedDirection, type DirectionReceipt } from "./directions.js";

export interface DirectionEffect {
  id: string; revision: string; observedAt: string;
  messageId: string;
  project: string; plan: string; action: string;
  source: "agent-ask.settle";
}

/** Read a genuine applied canonical writer receipt, not a free-form result reference. */
export function directionEffects(db: Database.Database, direction: DirectionReceipt): DirectionEffect[] {
  if (!direction.target) return [];
  const rows = db.prepare(`SELECT s.id,s.receipt_json,p.proposal_json FROM agent_ask_settlements s
    JOIN agent_ask_proposals p ON p.id=s.proposal_id WHERE s.project_slug=? AND s.disposition='accepted' AND p.intent_kind='complete'
    AND CASE WHEN json_valid(p.proposal_json) THEN json_extract(p.proposal_json,'$.normalized.direction.requestId') END = ?
    AND CASE WHEN json_valid(p.proposal_json) THEN json_extract(p.proposal_json,'$.normalized.direction.fingerprint') END = ?
    ORDER BY s.created_at,s.rowid`).all(direction.target.projectSlug, direction.requestId, direction.fingerprint) as Array<{ id: string; receipt_json: string; proposal_json: string }>;
  return rows.flatMap(row => {
    try {
      const receipt = JSON.parse(row.receipt_json) as AgentAskSettlementReceipt;
      const proposal = JSON.parse(row.proposal_json) as AgentAskProposal;
      const effect = receipt.directionEffect;
      if (!receipt.applied || receipt.recovery || receipt.id !== row.id || receipt.intent !== "complete" || !effect ||
        effect.correlation.requestId !== direction.requestId || effect.correlation.fingerprint !== direction.fingerprint ||
        JSON.stringify(proposal.normalized.direction) !== JSON.stringify(effect.correlation) ||
        effect.project !== direction.target!.projectSlug || (direction.target!.plan && effect.plan !== direction.target!.plan) ||
        (direction.target!.action && effect.action !== direction.target!.action) || receipt.createdAt < direction.observedAt ||
        !receipt.documentsCommit || !/^[a-f0-9]{40}$/.test(receipt.documentsCommit)) return [];
      const message = getMailMessage(db, effect.correlation.messageId);
      if (!message || directionForMail(message)?.requestId !== direction.requestId || directionForMail(message)?.fingerprint !== direction.fingerprint) return [];
      assertDirectionMailTarget(message, direction.target!);
      return [{ id: receipt.id, revision: receipt.documentsCommit, project: effect.project, plan: effect.plan, action: effect.action,
        messageId: effect.correlation.messageId,
        observedAt: receipt.createdAt, source: "agent-ask.settle" as const }];
    } catch { return []; }
  });
}

export interface DirectionQaObservation {
  schema: "arcadia-direction-verification-v1";
  requestId: string; fingerprint: string; messageId: string;
  settlementId: string; revision: string; decisionId: string; artifactId: string; evidenceFingerprint: string;
  result: "passed"; source: "native-mail.verify-direction"; provenance: "canonical-independent-qa"; observedAt: string;
}

/** Integrity, positive acceptance, target and exact result are four separate checks. */
export function checkDirectionQa(db: Database.Database, workspace: string, direction: DirectionReceipt,
  effect: DirectionEffect, decisionId: string): { artifactId: string; evidenceFingerprint: string; observedAt: string } {
  if (!direction.target) throw validationError("Direction target was not accepted.");
  const decision = getReviewItem(db, decisionId);
  if (!decision || decision.project_id !== direction.target.projectId || decision.resolved_intent !== "IndependentPullRequestQa" ||
    decision.status !== "approved" || !decision.artifact_id || decision.created_at < effect.observedAt) {
    throw validationError("No separate positive canonical QA acceptance observation is bound to this direction result.");
  }
  const artifact = getArtifact(db, decision.artifact_id);
  const context = parsePersistedQaContext(decision.context_json, "qa");
  if (!artifact || artifact.project_id !== direction.target.projectId || artifact.artifact_type !== "qa_report" || artifact.status !== "ready" ||
    !context || context.candidate.projectId !== direction.target.projectId || context.candidate.headSha !== effect.revision ||
    context.reportPath !== decision.artifact_path || artifact.path !== context.reportPath || decision.source_input !== context.candidate.url ||
    !persistedQaAcceptancePassed(context) ||
    !verifyPersistedQaContextEvidence(workspace, context, { decisionId: decision.id, artifactId: artifact.id })) {
    throw validationError("QA acceptance evidence is missing, negative, altered or mismatched to the exact resulting revision/artifact.");
  }
  const session = lineageBoundSessionForBranch(db, { repositoryPath: direction.target.repository, branch: context.candidate.headBranch });
  const effectRow = db.prepare("SELECT receipt_json FROM agent_ask_settlements WHERE id=?").get(effect.id) as { receipt_json: string };
  const correlation = (JSON.parse(effectRow.receipt_json) as AgentAskSettlementReceipt).directionEffect!.correlation;
  const message = getMailMessage(db, correlation.messageId)!;
  if (session || context.lineageRequestId || message.canonicalSessionRef) {
    const attempt = context.lineageRequestId ? getSessionRoleAttempt(db, context.lineageRequestId) : null;
    const terminal = attempt?.terminal_receipt_json ? JSON.parse(attempt.terminal_receipt_json) as Record<string, unknown> : null;
    if (!session || session.project_id !== direction.target.projectId || session.project_slug !== effect.project ||
      session.plan_slug !== effect.plan || session.action_id !== effect.action ||
      (message.canonicalSessionRef && message.canonicalSessionRef !== session.id) ||
      !attempt || attempt.role !== "qa" || attempt.status !== "passed" || attempt.target_head !== effect.revision ||
      attempt.requirement_id !== requirementIdFor(effect.project, effect.plan, effect.action) ||
      terminal?.decisionId !== decision.id || terminal.artifactId !== artifact.id || terminal.headSha !== effect.revision ||
      terminal.evidenceFingerprint !== context.evidenceFingerprint || terminal.verdict !== "pass" ||
      !settledCandidateForReview(db, session, effect.revision)) {
      throw validationError("Managed QA is not bound to this exact direction Action, Session and terminal acceptance attempt.");
    }
    const completion = completionEvidenceForReview(db, workspace, session, effect.revision);
    if (completion.status !== "verified" || !completionExecutionPassed(completion, completion.record.commands, completion.record.namedTests)) {
      throw validationError("Managed acceptance lacks successful canonical completion evidence for this exact Session/packet/tree.");
    }
  }
  return { artifactId: artifact.id, evidenceFingerprint: context.evidenceFingerprint, observedAt: decision.created_at };
}

/** Explicit observation records provenance only. It never invokes QA or changes governed work. */
export function observeDirectionQa(db: Database.Database, workspace: string, input: RecipientScope & {
  messageId: string; requestId: string; decisionId: string; actor: string;
}): MailReceiptRow {
  return writeTransaction(db, () => {
    const message = getMailMessage(db, input.messageId);
    const ref = message && directionForMail(message);
    if (!message || !ref) throw validationError("No accepted direction is bound to this native message.");
    assertRecipientScope(message, input);
    const direction = requireAcceptedDirection(db, ref.requestId, ref.fingerprint);
    assertDirectionMailTarget(message, direction.target);
    const effect = directionEffects(db, direction).at(-1);
    if (!effect) throw validationError("No committed direction-correlated applied canonical writer receipt exists.");
    const proof = checkDirectionQa(db, workspace, direction, effect, input.decisionId);
    const prior = listMailReceipts(db, message.id).find(receipt => receipt.requestId === input.requestId);
    if (prior) {
      if (prior.kind !== "effect_receipt" || prior.effectEvidence?.schema !== "arcadia-direction-verification-v1" ||
        prior.effectEvidence.decisionId !== input.decisionId || prior.effectEvidence.settlementId !== effect.id) {
        throw validationError("Verification request ID replay changed the observed acceptance result.");
      }
      return prior;
    }
    const observedAt = new Date().toISOString();
    const evidence: DirectionQaObservation = { schema: "arcadia-direction-verification-v1", ...ref, messageId: message.id,
      settlementId: effect.id, revision: effect.revision, decisionId: input.decisionId,
      artifactId: proof.artifactId, evidenceFingerprint: proof.evidenceFingerprint, result: "passed",
      source: "native-mail.verify-direction", provenance: "canonical-independent-qa", observedAt };
    const id = createId("nativeMailReceipt");
    db.prepare("INSERT INTO native_mail_receipts (id,message_id,request_id,kind,actor,effect_evidence_json,created_at) VALUES (?,?,?,'effect_receipt',?,?,?)")
      .run(id, message.id, input.requestId, input.actor, JSON.stringify(evidence), observedAt);
    return listMailReceipts(db, message.id).find(receipt => receipt.id === id)!;
  });
}
