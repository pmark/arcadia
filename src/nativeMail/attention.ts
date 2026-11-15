import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { queueOperatorPing, type OperatorPing } from "../ping/operatorPing.js";
import { assertRecipientScope, getMailMessage, type MailMessageRow, type RecipientScope } from "./store.js";

/**
 * The worker → Rowan → operator attention loop, built on native mail and the
 * operator-ping outbox. A worker sends a `request` mail whose body carries a
 * significance; Rowan acknowledges it with `native-mail ack`, then relays it
 * here. Only an acknowledged blocker with a ready action, consequence and
 * evidence becomes an operator ping; a significant result goes to Rowan's
 * digest, and routine progress never alerts. Replay is suppressed through the
 * ping episode key, so a duplicate relay, a retry after a lost receipt, or a
 * successor relaying the same message cannot page twice.
 *
 * Nothing here grants authority: a relay queues one outbox row through the
 * existing `arcadia ping` path, and the Discord adapter presents it.
 */

export const ATTENTION_DEFAULT_ACK_WITHIN_MS = 60_000;

export type AttentionSignificance = "blocker" | "result" | "progress";

export interface OverdueAttention {
  messageId: string;
  requestId: string;
  projectSlug: string;
  planSlug: string;
  sender: string;
  recipient: string;
  recipientGeneration: string;
  significance: AttentionSignificance | null;
  /** `undispatched`: never exposed to its recipient; `unacknowledged`: exposed, no ack; `stale`: expired without ack. */
  state: "undispatched" | "unacknowledged" | "stale";
  createdAt: string;
  ageMs: number;
}

export interface ListOverdueAttentionInput {
  projectSlug?: string;
  ackWithinMs?: number;
  now?: Date;
}

/**
 * Every unacknowledged, undisposed mail older than the ack window, across
 * recipients and generations, so a successor coordinator sees what a
 * predecessor left pending. Read-only: it marks nothing exposed.
 */
export function listOverdueAttention(db: Database.Database, input: ListOverdueAttentionInput = {}): OverdueAttention[] {
  const now = input.now ?? new Date();
  const ackWithinMs = input.ackWithinMs ?? ATTENTION_DEFAULT_ACK_WITHIN_MS;
  const cutoff = new Date(now.getTime() - ackWithinMs).toISOString();
  const rows = db.prepare(`SELECT id FROM native_mail_messages
    WHERE status IN ('offered', 'exposed') AND created_at <= ? AND (? IS NULL OR project_slug = ?)
    ORDER BY created_at, id`).all(cutoff, input.projectSlug ?? null, input.projectSlug ?? null) as Array<{ id: string }>;
  return rows.map(({ id }) => {
    const message = getMailMessage(db, id)!;
    const expired = message.expiresAt !== null && message.expiresAt <= now.toISOString();
    return {
      messageId: message.id,
      requestId: message.requestId,
      projectSlug: message.projectSlug,
      planSlug: message.planSlug,
      sender: message.senderSessionIncarnation,
      recipient: message.recipientSessionIncarnation,
      recipientGeneration: message.recipientGeneration,
      significance: significanceOf(message),
      state: expired ? "stale" : message.status === "offered" ? "undispatched" : "unacknowledged",
      createdAt: message.createdAt,
      ageMs: now.getTime() - Date.parse(message.createdAt)
    };
  });
}

export interface RelayAttentionInput extends RecipientScope {
  messageId: string;
  actor: string;
  channel?: string | null;
  link?: string | null;
  now?: Date;
}

export interface AttentionTiming {
  /** UTC instant the worker's mail was recorded. */
  emittedAt: string;
  acknowledgedAt: string;
  /** UTC instant the operator ping was queued; null when nothing was relayed. */
  queuedAt: string | null;
  /** UTC instant the Discord adapter presented it; null until delivered. */
  presentedAt: string | null;
  emittedToAcknowledgedMs: number;
  emittedToQueuedMs: number | null;
  emittedToPresentedMs: number | null;
}

export interface RelayAttentionResult {
  messageId: string;
  significance: AttentionSignificance;
  /** `relayed`: one new ping; `duplicate`: an earlier relay of this message is reused; `digest`: no ping by design. */
  outcome: "relayed" | "duplicate" | "digest";
  ping: OperatorPing | null;
  timing: AttentionTiming;
}

export function attentionEpisodeKey(messageId: string): string {
  return `[attn:${messageId}]`;
}

export function relayAttention(db: Database.Database, input: RelayAttentionInput): RelayAttentionResult {
  const message = getMailMessage(db, input.messageId);
  if (!message) throw validationError(`Mail message ${input.messageId} does not exist.`, { messageId: input.messageId });
  assertRecipientScope(message, input);
  if (message.kind !== "request") throw validationError("Only a worker `request` mail can be relayed to the operator.", { kind: message.kind });
  if (message.status !== "acknowledged" || !message.acknowledgedAt) {
    throw validationError("Acknowledge the mail with `native-mail ack` before relaying it.", { status: message.status });
  }
  const now = input.now ?? new Date();
  if (message.expiresAt !== null && message.expiresAt <= now.toISOString()) {
    throw validationError("This mail expired; a stale request is never relayed. Ask the worker for a fresh one.", { expiresAt: message.expiresAt });
  }
  const significance = significanceOf(message);
  if (!significance) throw validationError("The mail body needs `significance`: blocker, result or progress.");

  if (significance !== "blocker") {
    return { messageId: message.id, significance, outcome: "digest", ping: null, timing: timingFor(message, null) };
  }
  const readyAction = text(message.body.readyAction);
  const consequence = text(message.body.consequence);
  const evidence = text(message.body.evidence);
  if (!readyAction || !consequence || !evidence) {
    throw validationError("A blocker needs readyAction, consequence and evidence before it reaches the operator.");
  }
  const summary = text(message.body.summary) ?? "Worker blocker";
  const key = attentionEpisodeKey(message.id);
  // Worker text can never carry an episode key, so it cannot suppress another message's page.
  const body = `${summary} — do: ${readyAction}; consequence: ${consequence}; evidence: ${evidence}`.replaceAll("[attn:", "(attn:");
  const suffix = ` ${key}`;
  // Check and insert under one write lock, so two actors relaying at once still queue one ping.
  return writeTransaction(db, () => {
    const prior = relayedPing(db, message.id);
    if (prior) return { messageId: message.id, significance, outcome: "duplicate" as const, ping: prior, timing: timingFor(message, prior) };
    const queued = queueOperatorPing(db, {
      message: `${body.slice(0, 500 - suffix.length)}${suffix}`,
      kind: "attention",
      channel: input.channel ?? null,
      link: input.link ?? null,
      agent: input.actor,
      episodeKey: key,
      now
    });
    return {
      messageId: message.id,
      significance,
      outcome: queued.deduplicated ? ("duplicate" as const) : ("relayed" as const),
      ping: queued.ping,
      timing: timingFor(message, queued.ping)
    };
  });
}

/** The ping an earlier relay queued for this mail: its message ends with the episode key, which only the relay appends. */
function relayedPing(db: Database.Database, messageId: string): OperatorPing | null {
  const key = attentionEpisodeKey(messageId);
  const row = db.prepare("SELECT * FROM operator_pings WHERE substr(message, -length(?)) = ? ORDER BY created_at LIMIT 1")
    .get(key, key) as Record<string, string | null> | undefined;
  if (!row) return null;
  return {
    id: row.id!, message: row.message!, kind: row.kind as OperatorPing["kind"], channel: row.channel, link: row.link,
    todoKey: row.todo_key ?? null, agent: row.agent, status: row.status as OperatorPing["status"],
    discordMessageId: row.discord_message_id, createdAt: row.created_at!, sentAt: row.sent_at
  };
}

/** Timing for a relayed mail, re-read from the outbox so a later delivery shows its presentation time. */
export function attentionTiming(db: Database.Database, messageId: string): AttentionTiming {
  const message = getMailMessage(db, messageId);
  if (!message?.acknowledgedAt) throw validationError("No acknowledged mail with that id.", { messageId });
  return timingFor(message, relayedPing(db, messageId));
}

function timingFor(message: MailMessageRow, ping: Pick<OperatorPing, "createdAt" | "sentAt"> | null): AttentionTiming {
  const emitted = Date.parse(message.createdAt);
  const since = (iso: string | null) => (iso ? Date.parse(iso) - emitted : null);
  return {
    emittedAt: message.createdAt,
    acknowledgedAt: message.acknowledgedAt!,
    queuedAt: ping?.createdAt ?? null,
    presentedAt: ping?.sentAt ?? null,
    emittedToAcknowledgedMs: Date.parse(message.acknowledgedAt!) - emitted,
    emittedToQueuedMs: since(ping?.createdAt ?? null),
    emittedToPresentedMs: since(ping?.sentAt ?? null)
  };
}

function significanceOf(message: MailMessageRow): AttentionSignificance | null {
  const value = message.body.significance;
  return value === "blocker" || value === "result" || value === "progress" ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
