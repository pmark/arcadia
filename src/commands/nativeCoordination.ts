import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import {
  acknowledgeCoordinationMessage,
  coordinationStatus,
  disposeCoordinationMessage,
  offerCoordinationMessage,
  pollCoordinationMessages,
  recordCoordinationEffectReceipt,
  reportCoordinationResult,
  type CoordinationMessageKind,
  type CoordinationMessageRow,
  type CoordinationReceiptRow,
  type CoordinationStatusView
} from "../nativeCoordination/store.js";

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

export interface NativeCoordinationOfferOptions {
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
}

const MESSAGE_KINDS: CoordinationMessageKind[] = ["status", "report", "request", "reply"];

function assertKind(kind: string): CoordinationMessageKind {
  if (!MESSAGE_KINDS.includes(kind as CoordinationMessageKind)) {
    throw validationError(`Unknown coordination message kind "${kind}".`, { allowed: MESSAGE_KINDS });
  }
  return kind as CoordinationMessageKind;
}

export function runNativeCoordinationOfferCommand(options: NativeCoordinationOfferOptions): CommandSuccess<{
  message: CoordinationMessageRow;
  receipt: CoordinationReceiptRow;
}> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db: Database.Database) =>
    offerCoordinationMessage(db, {
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
    })
  );
  return createSuccess({ command: "native-rm.offer", workspace: workspacePath, data });
}

export interface NativeCoordinationPollOptions {
  workspace: string;
  projectSlug: string;
  planSlug: string;
  recipientIncarnation: string;
  recipientGeneration: string;
  actor: string;
}

export function runNativeCoordinationPollCommand(options: NativeCoordinationPollOptions): CommandSuccess<{ messages: CoordinationMessageRow[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const messages = withDatabase(workspacePath, (db: Database.Database) =>
    pollCoordinationMessages(db, {
      projectSlug: options.projectSlug,
      planSlug: options.planSlug,
      recipientSessionIncarnation: options.recipientIncarnation,
      recipientGeneration: options.recipientGeneration,
      actor: options.actor
    })
  );
  return createSuccess({ command: "native-rm.poll", workspace: workspacePath, data: { messages } });
}

export interface NativeCoordinationAckOptions {
  workspace: string;
  messageId: string;
  projectSlug: string;
  planSlug: string;
  recipientIncarnation: string;
  recipientGeneration: string;
  actor: string;
}

export function runNativeCoordinationAckCommand(options: NativeCoordinationAckOptions): CommandSuccess<{ receipt: CoordinationReceiptRow }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, (db: Database.Database) =>
    acknowledgeCoordinationMessage(db, {
      messageId: options.messageId,
      projectSlug: options.projectSlug,
      planSlug: options.planSlug,
      recipientSessionIncarnation: options.recipientIncarnation,
      recipientGeneration: options.recipientGeneration,
      actor: options.actor
    })
  );
  return createSuccess({ command: "native-rm.ack", workspace: workspacePath, data: { receipt } });
}

export interface NativeCoordinationReportOptions {
  workspace: string;
  messageId: string;
  requestId: string;
  actor: string;
  resultJson?: string;
}

export function runNativeCoordinationReportCommand(options: NativeCoordinationReportOptions): CommandSuccess<{ receipt: CoordinationReceiptRow }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, (db: Database.Database) =>
    reportCoordinationResult(db, {
      messageId: options.messageId,
      requestId: options.requestId,
      actor: options.actor,
      result: parseJsonOption("--result-json", options.resultJson)
    })
  );
  return createSuccess({ command: "native-rm.report", workspace: workspacePath, data: { receipt } });
}

export interface NativeCoordinationEffectOptions {
  workspace: string;
  messageId: string;
  requestId: string;
  actor: string;
  effectEvidenceJson?: string;
}

export function runNativeCoordinationEffectCommand(options: NativeCoordinationEffectOptions): CommandSuccess<{ receipt: CoordinationReceiptRow }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, (db: Database.Database) =>
    recordCoordinationEffectReceipt(db, {
      messageId: options.messageId,
      requestId: options.requestId,
      actor: options.actor,
      effectEvidence: parseJsonOption("--effect-evidence-json", options.effectEvidenceJson)
    })
  );
  return createSuccess({ command: "native-rm.effect", workspace: workspacePath, data: { receipt } });
}

export interface NativeCoordinationDisposeOptions {
  workspace: string;
  messageId: string;
  requestId: string;
  actor: string;
}

export function runNativeCoordinationDisposeCommand(options: NativeCoordinationDisposeOptions): CommandSuccess<{ receipt: CoordinationReceiptRow }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const receipt = withDatabase(workspacePath, (db: Database.Database) =>
    disposeCoordinationMessage(db, { messageId: options.messageId, requestId: options.requestId, actor: options.actor })
  );
  return createSuccess({ command: "native-rm.dispose", workspace: workspacePath, data: { receipt } });
}

export interface NativeCoordinationStatusOptions {
  workspace: string;
  messageId: string;
}

export function runNativeCoordinationStatusCommand(options: NativeCoordinationStatusOptions): CommandSuccess<CoordinationStatusView> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db: Database.Database) => coordinationStatus(db, options.messageId));
  return createSuccess({ command: "native-rm.status", workspace: workspacePath, data });
}

export function renderNativeCoordinationStatusSuccess(response: CommandSuccess<CoordinationStatusView>): string[] {
  const { message, exposedByPoll, explicitlyAcknowledged, selfReportedResult, independentlyCheckedEffect } = response.data;
  return [
    `Coordination message ${message.id} (${message.kind}) — persisted: true`,
    `Status: ${message.status}`,
    `Exposed by poll: ${exposedByPoll}${message.exposedAt ? ` (${message.exposedAt})` : ""}`,
    `Explicitly acknowledged: ${explicitlyAcknowledged}${message.acknowledgedAt ? ` by ${message.acknowledgedBy} at ${message.acknowledgedAt}` : ""}`,
    `Self-reported result: ${selfReportedResult ? JSON.stringify(selfReportedResult) : "none"}`,
    `Independently checked effect receipt: ${independentlyCheckedEffect ? JSON.stringify(independentlyCheckedEffect) : "none"}`
  ];
}
