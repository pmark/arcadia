import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import {
  acknowledgeMailMessage,
  mailStatus,
  disposeMailMessage,
  sendMailMessage,
  listMailInbox,
  verifyMailEffect,
  reportMailResult,
  consumeDirectionCheckpoint,
  recordDirectionRecipientState,
  type MailMessageKind,
  type MailMessageRow,
  type MailReceiptRow,
  type MailStatusView
} from "../nativeMail/store.js";
import { observeDirectionQa } from "../ask/directionVerification.js";
import {
  ATTENTION_DEFAULT_ACK_WITHIN_MS,
  attentionTiming,
  listOverdueAttention,
  relayAttention,
  type AttentionTiming,
  type OverdueAttention,
  type RelayAttentionResult
} from "../nativeMail/attention.js";

function parseJsonOption(label: string, raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw validationError(`${label} must be a JSON object.`, { raw });
  }
}

export interface NativeMailSendOptions {
  workspace: string;
  requestId: string;
  kind: string;
  repository: string;
  projectSlug: string;
  planSlug: string;
  senderIncarnation: string;
  senderGeneration: string;
  recipientIncarnation: string;
  recipientGeneration: string;
  assignmentEvidence: string;
  receiverCheckpointCapability: string;
  canonicalSessionRef?: string;
  replyToId?: string;
  resourceRefs?: string[];
  expiresAt?: string;
  bodyJson?: string;
  actor: string;
  directionRequestId?: string;
  directionFingerprint?: string;
}

const MESSAGE_KINDS: MailMessageKind[] = ["status", "report", "request", "reply"];

function assertKind(kind: string): MailMessageKind {
  if (!MESSAGE_KINDS.includes(kind as MailMessageKind)) {
    throw validationError(`Unknown coordination message kind "${kind}".`, { allowed: MESSAGE_KINDS });
  }
  return kind as MailMessageKind;
}

export function runNativeMailSendCommand(options: NativeMailSendOptions): CommandSuccess<{
  message: MailMessageRow;
  receipt: MailReceiptRow;
}> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db: Database.Database) =>
    sendMailMessage(db, {
      requestId: options.requestId,
      kind: assertKind(options.kind),
      sender: {
        repository: options.repository,
        projectSlug: options.projectSlug,
        planSlug: options.planSlug,
        sessionIncarnation: options.senderIncarnation,
        generation: options.senderGeneration
      },
      recipient: { sessionIncarnation: options.recipientIncarnation, generation: options.recipientGeneration },
      assignmentEvidence: options.assignmentEvidence,
      canonicalSessionRef: options.canonicalSessionRef ?? null,
      receiverCheckpointCapability: options.receiverCheckpointCapability,
      body: parseJsonOption("--body-json", options.bodyJson),
      replyToId: options.replyToId ?? null,
      resourceRefs: options.resourceRefs ?? [],
      expiresAt: options.expiresAt ?? null,
      actor: options.actor
      , ...(options.directionRequestId || options.directionFingerprint ? { direction: {
        requestId: options.directionRequestId ?? "", fingerprint: options.directionFingerprint ?? ""
      } } : {})
    })
  );
  return createSuccess({ command: "native-mail.send", workspace: workspacePath, data });
}

export interface NativeMailInboxOptions {
  workspace: string;
  projectSlug: string;
  planSlug: string;
  recipientIncarnation: string;
  recipientGeneration: string;
  actor: string;
}

export function runNativeMailInboxCommand(options: NativeMailInboxOptions): CommandSuccess<{ messages: MailMessageRow[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const messages = withDatabase(workspacePath, (db: Database.Database) =>
    listMailInbox(db, {
      projectSlug: options.projectSlug,
      planSlug: options.planSlug,
      recipientSessionIncarnation: options.recipientIncarnation,
      recipientGeneration: options.recipientGeneration,
      actor: options.actor
    })
  );
  return createSuccess({ command: "native-mail.inbox", workspace: workspacePath, data: { messages } });
}

export interface NativeMailAckOptions {
  workspace: string;
  messageId: string;
  projectSlug: string;
  planSlug: string;
  recipientIncarnation: string;
  recipientGeneration: string;
  actor: string;
  compactAcknowledgment?: string;
}

export function runNativeMailAckCommand(options: NativeMailAckOptions): CommandSuccess<{ receipt: MailReceiptRow }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, (db: Database.Database) =>
    acknowledgeMailMessage(db, {
      messageId: options.messageId,
      projectSlug: options.projectSlug,
      planSlug: options.planSlug,
      recipientSessionIncarnation: options.recipientIncarnation,
      recipientGeneration: options.recipientGeneration,
      actor: options.actor
      , compactAcknowledgment: options.compactAcknowledgment
    })
  );
  return createSuccess({ command: "native-mail.ack", workspace: workspacePath, data: { receipt } });
}

export interface NativeMailReportOptions {
  workspace: string;
  messageId: string;
  requestId: string;
  actor: string;
  projectSlug: string;
  planSlug: string;
  recipientIncarnation: string;
  recipientGeneration: string;
  resultJson?: string;
}

export function runNativeMailReportCommand(options: NativeMailReportOptions): CommandSuccess<{ receipt: MailReceiptRow }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, (db: Database.Database) =>
    reportMailResult(db, {
      messageId: options.messageId,
      requestId: options.requestId,
      actor: options.actor,
      projectSlug: options.projectSlug,
      planSlug: options.planSlug,
      recipientSessionIncarnation: options.recipientIncarnation,
      recipientGeneration: options.recipientGeneration,
      result: parseJsonOption("--result-json", options.resultJson)
    })
  );
  return createSuccess({ command: "native-mail.report", workspace: workspacePath, data: { receipt } });
}

export interface NativeMailVerifyOptions {
  workspace: string;
  messageId: string;
  requestId: string;
  actor: string;
  projectSlug: string;
  planSlug: string;
  recipientIncarnation: string;
  recipientGeneration: string;
  qaDecisionId?: string;
}

/**
 * Canonical applied-effect verification is not yet supported (see
 * `verifyMailEffect`); this command always refuses rather
 * than recording an unverified observation as independently checked.
 */
export function runNativeMailVerifyCommand(options: NativeMailVerifyOptions): CommandSuccess<{ receipt: MailReceiptRow }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, (db: Database.Database) =>
    options.qaDecisionId ? observeDirectionQa(db, workspacePath, {
      messageId: options.messageId, requestId: options.requestId, decisionId: options.qaDecisionId, actor: options.actor,
      projectSlug: options.projectSlug, planSlug: options.planSlug,
      recipientSessionIncarnation: options.recipientIncarnation, recipientGeneration: options.recipientGeneration
    }) : verifyMailEffect(db, {
      messageId: options.messageId,
      requestId: options.requestId,
      actor: options.actor,
      projectSlug: options.projectSlug,
      planSlug: options.planSlug,
      recipientSessionIncarnation: options.recipientIncarnation,
      recipientGeneration: options.recipientGeneration
    })
  );
  return createSuccess({ command: "native-mail.verify", workspace: workspacePath, data: { receipt } });
}

export interface NativeMailConsumeOptions extends NativeMailInboxOptions { messageId: string; requestId: string; fingerprint: string }
export function runNativeMailConsumeCommand(options: NativeMailConsumeOptions) {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, db => consumeDirectionCheckpoint(db, { ...options,
    recipientSessionIncarnation: options.recipientIncarnation, recipientGeneration: options.recipientGeneration }));
  return createSuccess({ command: "native-mail.consume", workspace: workspacePath, data: { receipt } });
}

export interface NativeMailRecipientStateOptions extends NativeMailInboxOptions {
  messageId: string; requestId: string; state: "paused" | "stopped" | "running"; evidenceReference: string;
}
export function runNativeMailRecipientStateCommand(options: NativeMailRecipientStateOptions) {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, db => recordDirectionRecipientState(db, { ...options,
    recipientSessionIncarnation: options.recipientIncarnation, recipientGeneration: options.recipientGeneration }));
  return createSuccess({ command: "native-mail.record-recipient-state", workspace: workspacePath, data: { receipt } });
}

export interface NativeMailDisposeOptions {
  workspace: string;
  messageId: string;
  requestId: string;
  actor: string;
  projectSlug: string;
  planSlug: string;
  recipientIncarnation: string;
  recipientGeneration: string;
}

export function runNativeMailDisposeCommand(options: NativeMailDisposeOptions): CommandSuccess<{ receipt: MailReceiptRow }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, (db: Database.Database) =>
    disposeMailMessage(db, {
      messageId: options.messageId,
      requestId: options.requestId,
      actor: options.actor,
      projectSlug: options.projectSlug,
      planSlug: options.planSlug,
      recipientSessionIncarnation: options.recipientIncarnation,
      recipientGeneration: options.recipientGeneration
    })
  );
  return createSuccess({ command: "native-mail.dispose", workspace: workspacePath, data: { receipt } });
}

export interface NativeMailStatusOptions {
  workspace: string;
  messageId: string;
}

export function runNativeMailStatusCommand(options: NativeMailStatusOptions): CommandSuccess<MailStatusView> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db: Database.Database) => mailStatus(db, options.messageId));
  return createSuccess({ command: "native-mail.status", workspace: workspacePath, data });
}

export function renderNativeMailStatusSuccess(response: CommandSuccess<MailStatusView>): string[] {
  const { message, exposedByInboxRead, explicitlyAcknowledged, selfReportedResult, independentlyCheckedEffect } = response.data;
  return [
    `Mail message ${message.id} (${message.kind}) — persisted: true`,
    `Status: ${message.status}`,
    `Exposed by inbox read: ${exposedByInboxRead}${message.exposedAt ? ` (${message.exposedAt})` : ""}`,
    `Explicitly acknowledged: ${explicitlyAcknowledged}${message.acknowledgedAt ? ` by ${message.acknowledgedBy} at ${message.acknowledgedAt}` : ""}`,
    `Self-reported result: ${selfReportedResult ? JSON.stringify(selfReportedResult) : "none"}`,
    `Independently checked effect receipt: ${independentlyCheckedEffect ? JSON.stringify(independentlyCheckedEffect) : "none"}`
  ];
}

export interface NativeMailOverdueOptions {
  workspace: string;
  projectSlug?: string;
  ackWithinSeconds?: string;
}

export function runNativeMailOverdueCommand(options: NativeMailOverdueOptions): CommandSuccess<{ ackWithinMs: number; overdue: OverdueAttention[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const seconds = options.ackWithinSeconds === undefined ? ATTENTION_DEFAULT_ACK_WITHIN_MS / 1000 : Number(options.ackWithinSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) throw validationError("--ack-within-seconds must be a non-negative number.");
  const ackWithinMs = Math.round(seconds * 1000);
  const overdue = withReadOnlyDatabase(workspacePath, (db: Database.Database) =>
    listOverdueAttention(db, { projectSlug: options.projectSlug, ackWithinMs }));
  return createSuccess({ command: "native-mail.overdue", workspace: workspacePath, data: { ackWithinMs, overdue } });
}

export function renderNativeMailOverdueSuccess(response: CommandSuccess<{ ackWithinMs: number; overdue: OverdueAttention[] }>): string[] {
  const { overdue, ackWithinMs } = response.data;
  if (overdue.length === 0) return [`No mail overdue past ${ackWithinMs / 1000}s.`];
  return [
    `${overdue.length} mail overdue past ${ackWithinMs / 1000}s:`,
    ...overdue.map((item) => `- ${item.messageId} · ${item.state} · ${item.significance ?? "unclassified"} · ${item.projectSlug} · ${item.sender} → ${item.recipient}/${item.recipientGeneration} · ${Math.round(item.ageMs / 1000)}s`)
  ];
}

export interface NativeMailRelayOptions {
  workspace: string;
  messageId: string;
  projectSlug: string;
  planSlug: string;
  recipientIncarnation: string;
  recipientGeneration: string;
  actor: string;
  channel?: string;
  link?: string;
}

export function runNativeMailRelayCommand(options: NativeMailRelayOptions): CommandSuccess<RelayAttentionResult> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db: Database.Database) => relayAttention(db, {
    messageId: options.messageId,
    projectSlug: options.projectSlug,
    planSlug: options.planSlug,
    recipientSessionIncarnation: options.recipientIncarnation,
    recipientGeneration: options.recipientGeneration,
    actor: options.actor,
    channel: options.channel ?? null,
    link: options.link ?? null
  }));
  return createSuccess({ command: "native-mail.relay", workspace: workspacePath, data });
}

export function renderNativeMailRelaySuccess(response: CommandSuccess<RelayAttentionResult>): string[] {
  const { outcome, significance, ping, timing } = response.data;
  const lead = outcome === "digest"
    ? `No ping: a ${significance} goes to the coordinator's digest, not the operator.`
    : outcome === "duplicate" ? `Already relayed as ${ping!.id}; nothing new queued.` : `Queued operator ping ${ping!.id}.`;
  return [lead, ...renderTiming(timing)];
}

export interface NativeMailTimingOptions {
  workspace: string;
  messageId: string;
}

export function runNativeMailTimingCommand(options: NativeMailTimingOptions): CommandSuccess<AttentionTiming> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db: Database.Database) => attentionTiming(db, options.messageId));
  return createSuccess({ command: "native-mail.timing", workspace: workspacePath, data });
}

export function renderNativeMailTimingSuccess(response: CommandSuccess<AttentionTiming>): string[] {
  return renderTiming(response.data);
}

function renderTiming(timing: AttentionTiming): string[] {
  const ms = (value: number | null) => (value === null ? "—" : `${(value / 1000).toFixed(1)}s`);
  return [
    `Emitted ${timing.emittedAt} · acknowledged ${timing.acknowledgedAt} (+${ms(timing.emittedToAcknowledgedMs)})`,
    `Queued ${timing.queuedAt ?? "—"} (+${ms(timing.emittedToQueuedMs)}) · presented ${timing.presentedAt ?? "not yet"} (+${ms(timing.emittedToPresentedMs)})`
  ];
}
