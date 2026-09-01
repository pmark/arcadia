import { readFileSync } from "node:fs";
import path from "node:path";
import { agentAskFingerprint, buildAgentAskEffects, normalizeAgentAsk, requiresManagedDocumentTransition, stableProposalId, type AgentAskProposal } from "../ask/agentAsk.js";
import { captureAskEnvelope } from "../ask/captureEnvelope.js";
import { resolveProjectReference } from "../ask/rules.js";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  listPendingAgentAskNotifications,
  markAgentAskNotificationSent,
  settleAgentAsk,
  type AgentAskDisposition,
  type AgentAskPlacement,
  type AgentAskResponsibility,
  type AgentAskSettlementReceipt,
  type PendingAgentAskNotification
} from "../ask/settlement.js";

export interface AgentAskPreviewOptions { workspace: string; request?: string; file?: string; requestId?: string; project?: string; }
export interface AgentAskPreviewData { proposal: AgentAskProposal; preview: string[]; projectWritesPerformed: 0; replayed: boolean; }

export function runAgentAskPreviewCommand(options: AgentAskPreviewOptions): CommandSuccess<AgentAskPreviewData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (options.request && options.file) throw validationError("Pass either an Agent Ask argument or --file, not both.");
  const request = options.file ? readFileSync(path.resolve(options.file), "utf8") : options.request ?? "";
  const parsed = normalizeAgentAsk({ request, requestId: options.requestId, project: options.project });
  const normalized = withDatabase(workspacePath, (db) => {
    if (parsed.project === "unknown") return parsed;
    const project = resolveProjectReference(db, parsed.project);
    if (!project) throw validationError("Agent Ask destination Project was not found.", { project: parsed.project, remedy: "Use a configured Project reference or `project: unknown`." });
    return { ...parsed, project: project.slug };
  });
  const fingerprint = agentAskFingerprint(request, normalized);
  const result = withDatabase(workspacePath, (db) => {
    const existing = db.prepare("SELECT fingerprint, proposal_json FROM agent_ask_proposals WHERE request_id = ?").get(normalized.requestId) as { fingerprint: string; proposal_json: string } | undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw validationError("Agent Ask request id was already used with different content.", { requestId: normalized.requestId });
      return { proposal: JSON.parse(existing.proposal_json) as AgentAskProposal, replayed: true };
    }
    return db.transaction(() => {
      const capture = captureAskEnvelope(db, { requestId: normalized.requestId, originalText: request, ingressSource: "agent.ask" });
      const built = buildAgentAskEffects(normalized);
      const proposal: AgentAskProposal = { id: stableProposalId(fingerprint), captureId: capture.id, normalized, effects: built.effects, requiredDecisions: built.requiredDecisions, unchanged: [], conflicts: [], refused: [], managedDocumentTransition: { required: requiresManagedDocumentTransition(normalized.intent), status: "withheld_until_acceptance", authority: "checked_in_documents" }, queueConsequence: "none_until_accepted", writes: { captureReceipt: true, proposalReceipt: true, projectChanges: false }, nonActions: ["No Project record is created or changed by preview.", "Agent input grants no approval or execution authority."], fingerprint, createdAt: new Date().toISOString() };
      db.prepare(`INSERT INTO agent_ask_proposals (id, request_id, capture_id, fingerprint, format, intent_kind, project_ref, proposal_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(proposal.id, normalized.requestId, capture.id, fingerprint, normalized.format, normalized.intent, normalized.project, JSON.stringify(proposal), proposal.createdAt);
      return { proposal, replayed: false };
    })();
  });
  const preview = renderAgentAskPreview(result.proposal);
  return createSuccess({ command: "agent-ask.preview", workspace: workspacePath, data: { proposal: result.proposal, preview, projectWritesPerformed: 0, replayed: result.replayed } });
}
export function renderAgentAskPreviewSuccess(response: CommandSuccess<AgentAskPreviewData>): string[] { return ["Agent Ask v1 preview", ...response.data.preview]; }
function renderAgentAskPreview(proposal: AgentAskProposal): string[] { const effect = proposal.effects[0]!; return [`Request: ${proposal.normalized.requestId}${proposal.normalized.format === "natural" ? " (natural fallback)" : ""}`, `Project: ${proposal.normalized.project}`, `Intent: ${proposal.normalized.intent}`, `Proposed effect: ${effect.operation} ${effect.targetKind}${effect.targetRef ? ` ${effect.targetRef}` : ""}`, `Decisions required: ${proposal.requiredDecisions.length}`, "Queue: no entry until accepted", "Project writes: 0"]; }

export interface AgentAskSettleData { receipt: AgentAskSettlementReceipt; }

export function runAgentAskSettleCommand(options: {
  workspace: string;
  proposal: string;
  requestId: string;
  disposition: AgentAskDisposition;
  responsibility?: AgentAskResponsibility;
  top?: boolean;
  before?: string;
  after?: string;
  revision?: number;
  preview?: string;
  apply?: boolean;
}): CommandSuccess<AgentAskSettleData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (options.disposition !== "accepted" && options.disposition !== "rejected") {
    throw validationError("Agent Ask disposition must be accepted or rejected.");
  }
  if (options.responsibility && options.responsibility !== "autonomous" && options.responsibility !== "codex") {
    throw validationError("Agent Ask Action Responsibility must be autonomous or codex.");
  }
  const placements = [options.top ? "top" : null, options.before ? "before" : null, options.after ? "after" : null].filter(Boolean);
  if (placements.length > 1) throw validationError("Choose at most one queue placement: --top, --before, or --after.");
  if (options.disposition === "rejected" && placements.length > 0) {
    throw validationError("Rejected Agent Ask settlement cannot declare a queue position.");
  }
  const receipt = withDatabase(workspacePath, (db) => settleAgentAsk(db, {
    proposalRef: options.proposal,
    settlementRequestId: options.requestId,
    disposition: options.disposition,
    responsibility: options.responsibility,
    placement: placements[0] as AgentAskPlacement | undefined,
    anchor: options.before ?? options.after,
    expectedQueueRevision: options.revision,
    previewFingerprint: options.preview,
    apply: options.apply
  }));
  return createSuccess({ command: "agent-ask.settle", workspace: workspacePath, data: { receipt } });
}

export function renderAgentAskSettleSuccess(response: CommandSuccess<AgentAskSettleData>): string[] {
  const receipt = response.data.receipt;
  return [
    receipt.applied ? `Agent Ask ${receipt.disposition}.` : `Agent Ask ${receipt.disposition} settlement preview.`,
    `Project: ${receipt.projectSlug}`,
    ...receipt.effects.map((effect) => `Effect: ${effect}`),
    `Queue: ${receipt.queueActionKey ? `${receipt.queueActionKey} at position ${(receipt.queuePosition ?? 0) + 1}` : "no executable entry"}`,
    `Next: ${receipt.nextActionKey ?? "none"}`,
    `Discord: ${receipt.notificationStatus}`,
    `Preview fingerprint: ${receipt.previewFingerprint}`,
    `Receipt: ${receipt.id}`
  ];
}

export function runAgentAskNotificationsCommand(options: { workspace: string }): CommandSuccess<{ notifications: PendingAgentAskNotification[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const notifications = withDatabase(workspacePath, (db) => listPendingAgentAskNotifications(db));
  return createSuccess({ command: "agent-ask.notifications", workspace: workspacePath, data: { notifications } });
}

export function renderAgentAskNotificationsSuccess(response: CommandSuccess<{ notifications: PendingAgentAskNotification[] }>): string[] {
  if (response.data.notifications.length === 0) return ["No Agent Ask settlement pings are pending Discord delivery."];
  return response.data.notifications.flatMap((notification) => [
    `${notification.settlementId} · ${notification.projectSlug} · ${notification.disposition}`,
    ...notification.effects.map((effect) => `  ${effect}`),
    `  Next: ${notification.nextActionKey ?? "none"}`
  ]);
}

export function runAgentAskNotificationSentCommand(options: {
  workspace: string;
  settlement: string;
  messageId: string;
}): CommandSuccess<{ settlementId: string; messageId: string }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  withDatabase(workspacePath, (db) => markAgentAskNotificationSent(db, options.settlement, options.messageId));
  return createSuccess({
    command: "agent-ask.notification-sent",
    workspace: workspacePath,
    data: { settlementId: options.settlement, messageId: options.messageId }
  });
}

export function renderAgentAskNotificationSentSuccess(response: CommandSuccess<{ settlementId: string; messageId: string }>): string[] {
  return [`Agent Ask settlement ${response.data.settlementId} notification recorded as ${response.data.messageId}.`];
}
