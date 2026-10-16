import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

/**
 * Local, addressed coordination messages between native coding-agent sessions
 * (a candidate implementer and a bounded native Release Manager role) on the
 * same OS user's machine. Every row is a relationship/provenance record only:
 * it never grants ownership, admission, or permission, and nothing here reads
 * message content as a command. See docs/plans/
 * enable-bounded-local-native-release-manager-coordination-with-durable-addressed.md.
 */

export type CoordinationMessageKind = "status" | "report" | "request" | "reply";
export type CoordinationMessageStatus = "offered" | "exposed" | "acknowledged" | "disposed";
export type CoordinationReceiptKind =
  | "offer"
  | "exposure"
  | "acknowledgment"
  | "self_report"
  | "effect_receipt"
  | "disposal";

export interface CoordinationParticipant {
  /** Repository path or identifier this coordination is scoped to. */
  repository: string;
  projectSlug: string;
  planSlug: string;
  /** Native session incarnation id (a process lifetime), never a managed Session claim. */
  sessionIncarnation: string;
  /** Monotonic generation fencing a stale predecessor out of addressed consumption. */
  generation: string;
}

export interface OfferCoordinationMessageInput {
  requestId: string;
  kind: CoordinationMessageKind;
  sender: CoordinationParticipant;
  recipient: Pick<CoordinationParticipant, "sessionIncarnation" | "generation">;
  /** Non-binding evidence that the sender is actually assigned this Action (an Action id, Ask id). */
  assignmentEvidence: string;
  /** Optional canonical Session row reference; relationship/provenance only. */
  canonicalSessionRef?: string | null;
  /** Explicit receiver capability label this message requires, e.g. "checkpoint-roundtrip". */
  receiverCheckpointCapability: string;
  /** Untrusted body. Never executed or interpreted as a command by any reader. */
  body: Record<string, unknown>;
  /** Correlates a reply to the message it answers. */
  replyToId?: string | null;
  resourceRefs?: string[];
  /** ISO instant after which the message is inert. */
  expiresAt?: string | null;
  actor: string;
}

export interface CoordinationMessageRow {
  id: string;
  requestId: string;
  contentFingerprint: string;
  kind: CoordinationMessageKind;
  repository: string;
  projectSlug: string;
  planSlug: string;
  senderSessionIncarnation: string;
  senderGeneration: string;
  assignmentEvidence: string;
  canonicalSessionRef: string | null;
  recipientSessionIncarnation: string;
  recipientGeneration: string;
  receiverCheckpointCapability: string;
  replyToId: string | null;
  resourceRefs: string[];
  body: Record<string, unknown>;
  expiresAt: string | null;
  status: CoordinationMessageStatus;
  exposedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  disposedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoordinationReceiptRow {
  id: string;
  messageId: string;
  requestId: string;
  kind: CoordinationReceiptKind;
  actor: string;
  selfReportedResult: Record<string, unknown> | null;
  effectEvidence: Record<string, unknown> | null;
  createdAt: string;
}

export function ensureNativeCoordinationTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS native_coordination_messages (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      content_fingerprint TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('status', 'report', 'request', 'reply')),
      repository TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      plan_slug TEXT NOT NULL,
      sender_session_incarnation TEXT NOT NULL,
      sender_generation TEXT NOT NULL,
      assignment_evidence TEXT NOT NULL,
      canonical_session_ref TEXT,
      recipient_session_incarnation TEXT NOT NULL,
      recipient_generation TEXT NOT NULL,
      receiver_checkpoint_capability TEXT NOT NULL,
      reply_to_id TEXT REFERENCES native_coordination_messages(id) ON DELETE SET NULL,
      resource_refs_json TEXT NOT NULL DEFAULT '[]',
      body_json TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('offered', 'exposed', 'acknowledged', 'disposed')) DEFAULT 'offered',
      exposed_at TEXT,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      disposed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_native_coordination_messages_recipient
      ON native_coordination_messages(project_slug, plan_slug, recipient_session_incarnation, recipient_generation, status);

    CREATE TABLE IF NOT EXISTS native_coordination_receipts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES native_coordination_messages(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('offer', 'exposure', 'acknowledgment', 'self_report', 'effect_receipt', 'disposal')),
      actor TEXT NOT NULL,
      self_reported_result_json TEXT,
      effect_evidence_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_native_coordination_receipts_message
      ON native_coordination_receipts(message_id, created_at);
  `);
}

function fingerprintOf(input: OfferCoordinationMessageInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: input.kind,
        sender: input.sender,
        recipient: input.recipient,
        assignmentEvidence: input.assignmentEvidence,
        canonicalSessionRef: input.canonicalSessionRef ?? null,
        receiverCheckpointCapability: input.receiverCheckpointCapability,
        body: input.body,
        replyToId: input.replyToId ?? null,
        resourceRefs: input.resourceRefs ?? [],
        expiresAt: input.expiresAt ?? null
      })
    )
    .digest("hex");
}

function toMessageRow(row: RawMessageRow): CoordinationMessageRow {
  return {
    id: row.id,
    requestId: row.request_id,
    contentFingerprint: row.content_fingerprint,
    kind: row.kind as CoordinationMessageKind,
    repository: row.repository,
    projectSlug: row.project_slug,
    planSlug: row.plan_slug,
    senderSessionIncarnation: row.sender_session_incarnation,
    senderGeneration: row.sender_generation,
    assignmentEvidence: row.assignment_evidence,
    canonicalSessionRef: row.canonical_session_ref,
    recipientSessionIncarnation: row.recipient_session_incarnation,
    recipientGeneration: row.recipient_generation,
    receiverCheckpointCapability: row.receiver_checkpoint_capability,
    replyToId: row.reply_to_id,
    resourceRefs: JSON.parse(row.resource_refs_json) as string[],
    body: JSON.parse(row.body_json) as Record<string, unknown>,
    expiresAt: row.expires_at,
    status: row.status as CoordinationMessageStatus,
    exposedAt: row.exposed_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    disposedAt: row.disposed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

interface RawMessageRow {
  id: string;
  request_id: string;
  content_fingerprint: string;
  kind: string;
  repository: string;
  project_slug: string;
  plan_slug: string;
  sender_session_incarnation: string;
  sender_generation: string;
  assignment_evidence: string;
  canonical_session_ref: string | null;
  recipient_session_incarnation: string;
  recipient_generation: string;
  receiver_checkpoint_capability: string;
  reply_to_id: string | null;
  resource_refs_json: string;
  body_json: string;
  expires_at: string | null;
  status: string;
  exposed_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  disposed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toReceiptRow(row: RawReceiptRow): CoordinationReceiptRow {
  return {
    id: row.id,
    messageId: row.message_id,
    requestId: row.request_id,
    kind: row.kind as CoordinationReceiptKind,
    actor: row.actor,
    selfReportedResult: row.self_reported_result_json ? (JSON.parse(row.self_reported_result_json) as Record<string, unknown>) : null,
    effectEvidence: row.effect_evidence_json ? (JSON.parse(row.effect_evidence_json) as Record<string, unknown>) : null,
    createdAt: row.created_at
  };
}

interface RawReceiptRow {
  id: string;
  message_id: string;
  request_id: string;
  kind: string;
  actor: string;
  self_reported_result_json: string | null;
  effect_evidence_json: string | null;
  created_at: string;
}

function getMessageByRequestId(db: Database.Database, requestId: string): CoordinationMessageRow | undefined {
  const row = db.prepare("SELECT * FROM native_coordination_messages WHERE request_id = ?").get(requestId) as RawMessageRow | undefined;
  return row ? toMessageRow(row) : undefined;
}

export function getCoordinationMessage(db: Database.Database, id: string): CoordinationMessageRow | undefined {
  const row = db.prepare("SELECT * FROM native_coordination_messages WHERE id = ?").get(id) as RawMessageRow | undefined;
  return row ? toMessageRow(row) : undefined;
}

export function listReceiptsForMessage(db: Database.Database, messageId: string): CoordinationReceiptRow[] {
  return (db.prepare("SELECT * FROM native_coordination_receipts WHERE message_id = ? ORDER BY created_at").all(messageId) as RawReceiptRow[]).map(toReceiptRow);
}

/**
 * Persist an immutable addressed message. Exact `requestId` replay (even
 * concurrent) returns the same message and offer receipt; a replay with
 * different content refuses. A disposed message's `requestId` can never be
 * reoffered — explicit disposal is terminal for that identity.
 */
export function offerCoordinationMessage(
  db: Database.Database,
  input: OfferCoordinationMessageInput
): { message: CoordinationMessageRow; receipt: CoordinationReceiptRow } {
  const fingerprint = fingerprintOf(input);
  return writeTransaction(db, () => {
    const existing = getMessageByRequestId(db, input.requestId);
    if (existing) {
      if (existing.contentFingerprint !== fingerprint) {
        throw validationError(`Coordination message ${input.requestId} was already offered with different content.`, {
          requestId: input.requestId
        });
      }
      if (existing.status === "disposed") {
        throw validationError(`Coordination message ${input.requestId} was disposed and cannot be reoffered under the same request id.`, {
          requestId: input.requestId,
          messageId: existing.id
        });
      }
      const receipt = db.prepare("SELECT * FROM native_coordination_receipts WHERE message_id = ? AND kind = 'offer'").get(existing.id) as RawReceiptRow;
      return { message: existing, receipt: toReceiptRow(receipt) };
    }

    if (!input.sender.sessionIncarnation.trim() || !input.sender.generation.trim()) {
      throw validationError("Coordination message sender must carry a non-empty session incarnation and generation.");
    }
    if (!input.recipient.sessionIncarnation.trim() || !input.recipient.generation.trim()) {
      throw validationError("Coordination message recipient must carry a non-empty session incarnation and generation.");
    }

    if (input.replyToId) {
      const parent = getCoordinationMessage(db, input.replyToId);
      if (!parent) throw validationError(`Reply correlates to unknown message ${input.replyToId}.`, { replyToId: input.replyToId });
      if (parent.projectSlug !== input.sender.projectSlug || parent.planSlug !== input.sender.planSlug) {
        throw validationError("Reply must stay within the same Project/Plan scope as the message it answers.", {
          replyToId: input.replyToId
        });
      }
    }

    const now = nowIso();
    const resolvedId = createId("nativeCoordinationMessage");
    db.prepare(
      `INSERT INTO native_coordination_messages
        (id, request_id, content_fingerprint, kind, repository, project_slug, plan_slug,
         sender_session_incarnation, sender_generation, assignment_evidence, canonical_session_ref,
         recipient_session_incarnation, recipient_generation, receiver_checkpoint_capability,
         reply_to_id, resource_refs_json, body_json, expires_at, status, created_at, updated_at)
       VALUES (@id, @request_id, @content_fingerprint, @kind, @repository, @project_slug, @plan_slug,
         @sender_session_incarnation, @sender_generation, @assignment_evidence, @canonical_session_ref,
         @recipient_session_incarnation, @recipient_generation, @receiver_checkpoint_capability,
         @reply_to_id, @resource_refs_json, @body_json, @expires_at, 'offered', @created_at, @updated_at)`
    ).run({
      id: resolvedId,
      request_id: input.requestId,
      content_fingerprint: fingerprint,
      kind: input.kind,
      repository: input.sender.repository,
      project_slug: input.sender.projectSlug,
      plan_slug: input.sender.planSlug,
      sender_session_incarnation: input.sender.sessionIncarnation,
      sender_generation: input.sender.generation,
      assignment_evidence: input.assignmentEvidence,
      canonical_session_ref: input.canonicalSessionRef ?? null,
      recipient_session_incarnation: input.recipient.sessionIncarnation,
      recipient_generation: input.recipient.generation,
      receiver_checkpoint_capability: input.receiverCheckpointCapability,
      reply_to_id: input.replyToId ?? null,
      resource_refs_json: JSON.stringify(input.resourceRefs ?? []),
      body_json: JSON.stringify(input.body ?? {}),
      expires_at: input.expiresAt ?? null,
      created_at: now,
      updated_at: now
    });

    const resolvedReceiptId = createId("nativeCoordinationReceipt");
    db.prepare(
      `INSERT INTO native_coordination_receipts (id, message_id, request_id, kind, actor, created_at)
       VALUES (?, ?, ?, 'offer', ?, ?)`
    ).run(resolvedReceiptId, resolvedId, `${input.requestId}:offer`, input.actor, now);

    const message = getCoordinationMessage(db, resolvedId)!;
    const receipt = listReceiptsForMessage(db, resolvedId)[0];
    return { message, receipt };
  });
}

export interface PollCoordinationMessagesInput {
  projectSlug: string;
  planSlug: string;
  recipientSessionIncarnation: string;
  recipientGeneration: string;
  actor: string;
}

/**
 * Read-only exposure. Returns messages addressed to this exact recipient
 * generation within this exact Plan scope, excluding disposed and expired
 * messages (expiry makes a message inert, never an error). The first poll to
 * see a given message marks `exposedAt`; later polls never re-mark it, so
 * poll/heartbeat freshness never implies acknowledgment, model read, or
 * applied effect.
 */
export function pollCoordinationMessages(db: Database.Database, input: PollCoordinationMessagesInput): CoordinationMessageRow[] {
  return writeTransaction(db, () => {
    const now = nowIso();
    const rows = db
      .prepare(
        `SELECT * FROM native_coordination_messages
         WHERE project_slug = ? AND plan_slug = ? AND recipient_session_incarnation = ? AND recipient_generation = ?
           AND status != 'disposed'
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at`
      )
      .all(input.projectSlug, input.planSlug, input.recipientSessionIncarnation, input.recipientGeneration, now) as RawMessageRow[];

    for (const row of rows) {
      if (row.status === "offered") {
        db.prepare("UPDATE native_coordination_messages SET status = 'exposed', exposed_at = ?, updated_at = ? WHERE id = ? AND status = 'offered'")
          .run(now, now, row.id);
        const resolvedReceiptId = createId("nativeCoordinationReceipt");
        db.prepare(`INSERT OR IGNORE INTO native_coordination_receipts (id, message_id, request_id, kind, actor, created_at) VALUES (?, ?, ?, 'exposure', ?, ?)`)
          .run(resolvedReceiptId, row.id, `${row.id}:exposure`, input.actor, now);
      }
    }

    return (
      db
        .prepare(
          `SELECT * FROM native_coordination_messages
           WHERE project_slug = ? AND plan_slug = ? AND recipient_session_incarnation = ? AND recipient_generation = ?
             AND status != 'disposed'
             AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY created_at`
        )
        .all(input.projectSlug, input.planSlug, input.recipientSessionIncarnation, input.recipientGeneration, now) as RawMessageRow[]
    ).map(toMessageRow);
  });
}

export interface RecipientScope {
  projectSlug: string;
  planSlug: string;
  recipientSessionIncarnation: string;
  recipientGeneration: string;
}

/**
 * The fencing invariant every receiver-side mutation shares (acknowledgment,
 * self-report, effect receipt, disposal): wrong Plan, wrong recipient, stale
 * generation, a disposed message, and an expired (inert) message are all
 * refused the same way. `allowDisposed` lets disposal itself report a
 * clearer "already disposed" error instead of this generic one.
 */
function assertRecipientScope(message: CoordinationMessageRow, scope: RecipientScope, options: { allowDisposed?: boolean } = {}): void {
  if (message.projectSlug !== scope.projectSlug || message.planSlug !== scope.planSlug) {
    throw validationError("Refused: wrong Project/Plan scope.", {
      messageId: message.id,
      expected: { projectSlug: message.projectSlug, planSlug: message.planSlug },
      got: { projectSlug: scope.projectSlug, planSlug: scope.planSlug }
    });
  }
  if (message.recipientSessionIncarnation !== scope.recipientSessionIncarnation) {
    throw validationError("Refused: wrong recipient.", { messageId: message.id });
  }
  if (message.recipientGeneration !== scope.recipientGeneration) {
    throw validationError("Refused: stale recipient generation.", {
      messageId: message.id,
      expectedGeneration: message.recipientGeneration,
      gotGeneration: scope.recipientGeneration
    });
  }
  if (!options.allowDisposed && message.status === "disposed") {
    throw validationError("Refused: message was disposed.", { messageId: message.id });
  }
  if (message.expiresAt && message.expiresAt <= nowIso()) {
    throw validationError("Refused: message expired and is inert.", { messageId: message.id });
  }
}

export interface AcknowledgeCoordinationMessageInput extends RecipientScope {
  messageId: string;
  actor: string;
}

/**
 * Explicit receiver acknowledgment. Refuses wrong Plan, wrong recipient
 * incarnation, stale generation, a disposed message, and an expired (inert)
 * message. Idempotent: an already-acknowledged message returns its existing
 * acknowledgment receipt rather than creating a second one.
 */
export function acknowledgeCoordinationMessage(db: Database.Database, input: AcknowledgeCoordinationMessageInput): CoordinationReceiptRow {
  return writeTransaction(db, () => {
    const message = getCoordinationMessage(db, input.messageId);
    if (!message) throw validationError(`Coordination message ${input.messageId} does not exist.`, { messageId: input.messageId });
    assertRecipientScope(message, input);

    const existing = db.prepare("SELECT * FROM native_coordination_receipts WHERE message_id = ? AND kind = 'acknowledgment'").get(message.id) as
      | RawReceiptRow
      | undefined;
    if (existing) return toReceiptRow(existing);

    const now = nowIso();
    db.prepare("UPDATE native_coordination_messages SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, updated_at = ? WHERE id = ?")
      .run(now, input.actor, now, message.id);
    const resolvedReceiptId = createId("nativeCoordinationReceipt");
    db.prepare("INSERT INTO native_coordination_receipts (id, message_id, request_id, kind, actor, created_at) VALUES (?, ?, ?, 'acknowledgment', ?, ?)")
      .run(resolvedReceiptId, message.id, `${message.id}:acknowledgment`, input.actor, now);
    return toReceiptRow(db.prepare("SELECT * FROM native_coordination_receipts WHERE id = ?").get(resolvedReceiptId) as RawReceiptRow);
  });
}

export interface ReportCoordinationResultInput extends RecipientScope {
  messageId: string;
  requestId: string;
  actor: string;
  /** Self-reported only. Never treated as proof of an applied canonical effect. */
  result: Record<string, unknown>;
}

/**
 * A receiver's self-reported outcome. Visibly self-reported: distinct from,
 * and never a substitute for, `recordCoordinationEffectReceipt`'s
 * independently checked correlated effect receipt. Requires the message to
 * already be acknowledged, fences the same Plan/recipient/generation scope
 * as acknowledgment, and refuses a replayed request id that now names a
 * different message or carries different reported content.
 */
export function reportCoordinationResult(db: Database.Database, input: ReportCoordinationResultInput): CoordinationReceiptRow {
  return writeTransaction(db, () => {
    const message = getCoordinationMessage(db, input.messageId);
    if (!message) throw validationError(`Coordination message ${input.messageId} does not exist.`, { messageId: input.messageId });
    assertRecipientScope(message, input);
    if (message.status !== "acknowledged") {
      throw validationError("A result can only be self-reported after explicit acknowledgment.", {
        messageId: input.messageId,
        status: message.status
      });
    }

    const newResult = { selfReported: true, ...input.result };
    const existing = db.prepare("SELECT * FROM native_coordination_receipts WHERE request_id = ?").get(input.requestId) as RawReceiptRow | undefined;
    if (existing) {
      if (existing.message_id !== message.id) {
        throw validationError(`Self-report request id ${input.requestId} was already recorded for a different message.`, { requestId: input.requestId });
      }
      const existingResult = existing.self_reported_result_json ? (JSON.parse(existing.self_reported_result_json) as Record<string, unknown>) : {};
      if (JSON.stringify(existingResult) !== JSON.stringify(newResult)) {
        throw validationError(`Self-report request id ${input.requestId} was already recorded with different content.`, { requestId: input.requestId });
      }
      return toReceiptRow(existing);
    }

    const now = nowIso();
    const resolvedReceiptId = createId("nativeCoordinationReceipt");
    db.prepare(
      `INSERT INTO native_coordination_receipts (id, message_id, request_id, kind, actor, self_reported_result_json, created_at)
       VALUES (?, ?, ?, 'self_report', ?, ?, ?)`
    ).run(resolvedReceiptId, message.id, input.requestId, input.actor, JSON.stringify(newResult), now);
    return toReceiptRow(db.prepare("SELECT * FROM native_coordination_receipts WHERE id = ?").get(resolvedReceiptId) as RawReceiptRow);
  });
}

/**
 * The only canonical sources this bounded capability knows how to re-derive
 * and compare against. Deliberately a closed allowlist, never a
 * caller-supplied table/column: widening it means adding a case here, not
 * trusting new caller input.
 */
export type CanonicalEffectCheck = {
  table: "work_items";
  id: string;
  field: "status";
  expected: string;
};

function reDeriveCanonicalValue(db: Database.Database, check: CanonicalEffectCheck): string | null {
  if (check.table === "work_items" && check.field === "status") {
    const row = db.prepare("SELECT status FROM work_items WHERE id = ?").get(check.id) as { status: string } | undefined;
    return row?.status ?? null;
  }
  throw validationError(`Unsupported canonical effect check: ${check.table}.${check.field}.`, { table: check.table, field: check.field });
}

export interface RecordCoordinationEffectReceiptInput extends RecipientScope {
  messageId: string;
  requestId: string;
  actor: string;
  /**
   * What canonical value to re-read from the configured store and compare
   * against. This is the only route to an effect receipt: the claim is
   * independently re-derived here, never trusted verbatim from the caller,
   * and a mismatch fails closed rather than recording an unverified effect
   * as checked.
   */
  canonicalCheck: CanonicalEffectCheck;
}

/**
 * An independently checked correlated effect receipt — the only thing that
 * may stand for an applied canonical effect. Fences the same Plan/recipient/
 * generation/expiry/disposal scope as acknowledgment, re-derives the claimed
 * value from the live database itself (never from caller-supplied evidence),
 * and refuses a replayed request id that now names a different message or a
 * different canonical check.
 */
export function recordCoordinationEffectReceipt(db: Database.Database, input: RecordCoordinationEffectReceiptInput): CoordinationReceiptRow {
  return writeTransaction(db, () => {
    const message = getCoordinationMessage(db, input.messageId);
    if (!message) throw validationError(`Coordination message ${input.messageId} does not exist.`, { messageId: input.messageId });
    assertRecipientScope(message, input);

    const claim = {
      table: input.canonicalCheck.table,
      id: input.canonicalCheck.id,
      field: input.canonicalCheck.field,
      expected: input.canonicalCheck.expected
    };
    const existing = db.prepare("SELECT * FROM native_coordination_receipts WHERE request_id = ?").get(input.requestId) as RawReceiptRow | undefined;
    if (existing) {
      if (existing.message_id !== message.id) {
        throw validationError(`Effect receipt request id ${input.requestId} was already recorded for a different message.`, { requestId: input.requestId });
      }
      const existingEvidence = existing.effect_evidence_json ? (JSON.parse(existing.effect_evidence_json) as Record<string, unknown>) : {};
      const existingClaim = { table: existingEvidence.table, id: existingEvidence.id, field: existingEvidence.field, expected: existingEvidence.expected };
      if (JSON.stringify(existingClaim) !== JSON.stringify(claim)) {
        throw validationError(`Effect receipt request id ${input.requestId} was already recorded with a different canonical check.`, {
          requestId: input.requestId
        });
      }
      return toReceiptRow(existing);
    }

    const observed = reDeriveCanonicalValue(db, input.canonicalCheck);
    if (observed === null || observed !== input.canonicalCheck.expected) {
      throw validationError(
        "Canonical effect check failed: the value re-derived from the configured store does not match the claimed effect; refusing to record an unverified effect as independently checked.",
        { ...claim, observed }
      );
    }

    const now = nowIso();
    const resolvedReceiptId = createId("nativeCoordinationReceipt");
    const effectEvidence = { ...claim, verifiedValue: observed, verifiedAt: now };
    db.prepare(
      `INSERT INTO native_coordination_receipts (id, message_id, request_id, kind, actor, effect_evidence_json, created_at)
       VALUES (?, ?, ?, 'effect_receipt', ?, ?, ?)`
    ).run(resolvedReceiptId, message.id, input.requestId, input.actor, JSON.stringify(effectEvidence), now);
    return toReceiptRow(db.prepare("SELECT * FROM native_coordination_receipts WHERE id = ?").get(resolvedReceiptId) as RawReceiptRow);
  });
}

export interface DisposeCoordinationMessageInput extends RecipientScope {
  messageId: string;
  requestId: string;
  actor: string;
}

/**
 * Explicitly dispose a message. Before this, a crash between offer and
 * acknowledgment leaves the message sitting in `offered`/`exposed`, still
 * returned by poll and still eligible for its original `requestId` to be
 * replayed safely; only disposal ends that eligibility. Fences the same
 * Plan/recipient/generation scope as acknowledgment (expiry does not block
 * disposal — an expired message may still be disposed); a disposal replay
 * under a request id that now names a different message refuses, and a
 * second disposal attempt under a new request id on an already-disposed
 * message refuses rather than silently no-opping.
 */
export function disposeCoordinationMessage(db: Database.Database, input: DisposeCoordinationMessageInput): CoordinationReceiptRow {
  return writeTransaction(db, () => {
    const message = getCoordinationMessage(db, input.messageId);
    if (!message) throw validationError(`Coordination message ${input.messageId} does not exist.`, { messageId: input.messageId });
    assertRecipientScope(message, input, { allowDisposed: true });

    const existing = db.prepare("SELECT * FROM native_coordination_receipts WHERE request_id = ?").get(input.requestId) as RawReceiptRow | undefined;
    if (existing) {
      if (existing.message_id !== message.id) {
        throw validationError(`Disposal request id ${input.requestId} was already recorded for a different message.`, { requestId: input.requestId });
      }
      return toReceiptRow(existing);
    }
    if (message.status === "disposed") {
      throw validationError("Message was already disposed under a different request id.", { messageId: message.id });
    }

    const now = nowIso();
    db.prepare("UPDATE native_coordination_messages SET status = 'disposed', disposed_at = ?, updated_at = ? WHERE id = ?").run(now, now, message.id);
    const resolvedReceiptId = createId("nativeCoordinationReceipt");
    db.prepare("INSERT INTO native_coordination_receipts (id, message_id, request_id, kind, actor, created_at) VALUES (?, ?, ?, 'disposal', ?, ?)")
      .run(resolvedReceiptId, message.id, input.requestId, input.actor, now);
    return toReceiptRow(db.prepare("SELECT * FROM native_coordination_receipts WHERE id = ?").get(resolvedReceiptId) as RawReceiptRow);
  });
}

export interface CoordinationStatusView {
  message: CoordinationMessageRow;
  receipts: CoordinationReceiptRow[];
  persisted: true;
  exposedByPoll: boolean;
  explicitlyAcknowledged: boolean;
  selfReportedResult: Record<string, unknown> | null;
  independentlyCheckedEffect: Record<string, unknown> | null;
}

/**
 * Status distinguishes four things that must never be collapsed into one
 * another: the message is durably persisted; it has been exposed by a poll;
 * it has been explicitly acknowledged by its receiver; and any reported
 * result is labelled by whether it is self-reported or an independently
 * checked effect receipt.
 */
export function coordinationStatus(db: Database.Database, messageId: string): CoordinationStatusView {
  const message = getCoordinationMessage(db, messageId);
  if (!message) throw validationError(`Coordination message ${messageId} does not exist.`, { messageId });
  const receipts = listReceiptsForMessage(db, messageId);
  const selfReport = receipts.filter((receipt) => receipt.kind === "self_report").at(-1) ?? null;
  const effectReceipt = receipts.filter((receipt) => receipt.kind === "effect_receipt").at(-1) ?? null;
  return {
    message,
    receipts,
    persisted: true,
    exposedByPoll: message.exposedAt !== null,
    explicitlyAcknowledged: message.acknowledgedAt !== null,
    selfReportedResult: selfReport?.selfReportedResult ?? null,
    independentlyCheckedEffect: effectReceipt?.effectEvidence ?? null
  };
}
