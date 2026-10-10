import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";

/**
 * A read-only nudge from an agent to the operator: "take a look at this".
 *
 * Unlike an Agent Ask `intent: log` settlement it is not a durable governed
 * event. It writes no Project document, opens no Decision and approves
 * nothing; it is a row in a delivery outbox that the Discord bot drains, and
 * nothing more. Its flexibility is the point, so its limits are about volume
 * and shape, never about subject matter.
 */

export const OPERATOR_PING_KINDS = ["look", "fyi", "attention"] as const;
export type OperatorPingKind = (typeof OPERATOR_PING_KINDS)[number];

export const OPERATOR_PING_MESSAGE_MAX = 500;
/** A channel alias the bot's `DISCORD_PING_CHANNELS` maps, or a channel id from that map. */
export const OPERATOR_PING_CHANNEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$|^\d{17,20}$/;
/** The same message to the same channel inside this window is one ping, not two. */
export const OPERATOR_PING_DEDUP_WINDOW_MS = 10 * 60 * 1000;
/** A looping agent must not be able to flood the operator's phone. */
export const OPERATOR_PING_HOURLY_CAP = 30;

export interface OperatorPingInput {
  message: string;
  kind?: string;
  channel?: string | null;
  link?: string | null;
  /** `<kind>:<project>/<id>`: the /todo item this ping is about; the bot turns it into a dashboard deep link. */
  todo?: string | null;
  agent?: string | null;
  now?: Date;
}

export interface OperatorPing {
  id: string;
  message: string;
  kind: OperatorPingKind;
  channel: string | null;
  link: string | null;
  todoKey: string | null;
  agent: string | null;
  status: "pending" | "sent";
  discordMessageId: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface QueuedOperatorPing {
  ping: OperatorPing;
  /** Set when an attention ping names neither --todo nor --link, so the bot can only point at /todo. */
  warnings?: string[];
  /** True when an identical recent ping already existed and was reused rather than queued again. */
  deduplicated: boolean;
}

export function ensureOperatorPingTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS operator_pings (
    id TEXT PRIMARY KEY, message TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('look', 'fyi', 'attention')),
    channel TEXT, link TEXT, agent TEXT, todo_key TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sent')) DEFAULT 'pending',
    discord_message_id TEXT, created_at TEXT NOT NULL, sent_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_operator_pings_status ON operator_pings(status, created_at);`);
  const columns = db.prepare("PRAGMA table_info(operator_pings)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "todo_key")) {
    db.exec("ALTER TABLE operator_pings ADD COLUMN todo_key TEXT");
  }
}

export function queueOperatorPing(db: Database.Database, input: OperatorPingInput): QueuedOperatorPing {
  const fields = normalizeOperatorPing(input);
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  return writeTransaction(db, () => {
    const duplicate = db.prepare(`SELECT * FROM operator_pings
      WHERE message = ? AND COALESCE(channel, '') = ? AND created_at >= ?
      ORDER BY created_at DESC LIMIT 1`)
      .get(fields.message, fields.channel ?? "", new Date(now.getTime() - OPERATOR_PING_DEDUP_WINDOW_MS).toISOString());
    if (duplicate) return { ping: toPing(duplicate as PingRow), deduplicated: true, warnings: linkWarnings(fields) };

    const recent = db.prepare("SELECT COUNT(*) AS n FROM operator_pings WHERE created_at >= ?")
      .get(new Date(now.getTime() - 60 * 60 * 1000).toISOString()) as { n: number };
    if (recent.n >= OPERATOR_PING_HOURLY_CAP) {
      throw validationError(
        `Ping not sent: ${OPERATOR_PING_HOURLY_CAP} pings already queued in the last hour. Batch what you have into one message, or record it in the PR handoff.`,
        { hourlyCap: OPERATOR_PING_HOURLY_CAP }
      );
    }

    const id = `ping_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
    db.prepare(`INSERT INTO operator_pings (id, message, kind, channel, link, todo_key, agent, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, fields.message, fields.kind, fields.channel, fields.link, fields.todoKey, fields.agent, createdAt);
    return {
      ping: { id, ...fields, status: "pending", discordMessageId: null, createdAt, sentAt: null },
      deduplicated: false,
      warnings: linkWarnings(fields)
    };
  });
}

export function listPendingOperatorPings(db: Database.Database): OperatorPing[] {
  return db.prepare("SELECT * FROM operator_pings WHERE status = 'pending' ORDER BY created_at, id")
    .all()
    .map((row) => toPing(row as PingRow));
}

export function markOperatorPingSent(db: Database.Database, pingId: string, messageId: string, now = new Date()): void {
  const result = db.prepare(`UPDATE operator_pings SET status = 'sent', discord_message_id = ?, sent_at = ?
    WHERE id = ? AND status = 'pending'`).run(messageId, now.toISOString(), pingId);
  if (result.changes > 0) return;
  const existing = db.prepare("SELECT status, discord_message_id FROM operator_pings WHERE id = ?")
    .get(pingId) as { status: string; discord_message_id: string | null } | undefined;
  if (!existing) throw validationError("Operator ping was not found.", { pingId });
  if (existing.status === "sent" && existing.discord_message_id === messageId) return;
  throw validationError("Operator ping is already resolved with different evidence.", { pingId });
}

type NormalizedFields = Omit<OperatorPing, "id" | "status" | "discordMessageId" | "createdAt" | "sentAt">;

export function normalizeOperatorPing(input: OperatorPingInput): NormalizedFields {
  const message = (input.message ?? "").replace(/\s+/g, " ").trim();
  if (!message) throw validationError("A ping needs a message.");
  if (message.length > OPERATOR_PING_MESSAGE_MAX) {
    throw validationError(
      `A ping message is at most ${OPERATOR_PING_MESSAGE_MAX} characters (got ${message.length}); it is a nudge, not a report. Put detail in the PR and link it.`
    );
  }
  const kind = (input.kind?.trim().toLowerCase() || "fyi") as OperatorPingKind;
  if (!OPERATOR_PING_KINDS.includes(kind)) {
    throw validationError(`--kind must be one of ${OPERATOR_PING_KINDS.join(", ")}.`, { kind: input.kind });
  }
  const channel = input.channel?.trim().toLowerCase() || null;
  if (channel !== null && !OPERATOR_PING_CHANNEL_PATTERN.test(channel)) {
    throw validationError("--channel must be a configured channel alias (lowercase letters, digits, - or _) or a channel id.", { channel });
  }
  return { message, kind, channel, link: normalizeLink(input.link), todoKey: normalizeTodoKey(input.todo), agent: input.agent?.trim().slice(0, 64) || null };
}

/** `<kind>:<project>/<id>`; kind may carry one `:sub` part (escalation:<kind>), id may carry `#` (plan actions). */
export const OPERATOR_PING_TODO_KEY_PATTERN =
  /^[a-z][a-z0-9_]{0,31}(?::[a-z0-9][a-z0-9_-]{0,31})?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._#:-]{0,127}$/;

function normalizeTodoKey(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!OPERATOR_PING_TODO_KEY_PATTERN.test(value)) {
    throw validationError(
      "--todo must look like <kind>:<project>/<id>, the key `arcadia todo` prints (for example decision:arcadia/0119).",
      { todo: value }
    );
  }
  return value;
}

function linkWarnings(fields: NormalizedFields): string[] {
  if (fields.kind !== "attention" || fields.link || fields.todoKey) return [];
  return ["An attention ping with neither --todo nor --link can only link to the /todo list. Pass --todo <kind>:<project>/<id> (or --link <PR url>) so the operator lands on the exact item."];
}

function normalizeLink(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw validationError("--link must be an absolute http(s) URL.", { link: value });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw validationError("--link must be an absolute http(s) URL.", { link: value });
  }
  return parsed.toString();
}

interface PingRow {
  id: string; message: string; kind: string; channel: string | null; link: string | null; todo_key: string | null; agent: string | null;
  status: string; discord_message_id: string | null; created_at: string; sent_at: string | null;
}

function toPing(row: PingRow): OperatorPing {
  return {
    id: row.id,
    message: row.message,
    kind: row.kind as OperatorPingKind,
    channel: row.channel,
    link: row.link,
    todoKey: row.todo_key ?? null,
    agent: row.agent,
    status: row.status as OperatorPing["status"],
    discordMessageId: row.discord_message_id,
    createdAt: row.created_at,
    sentAt: row.sent_at
  };
}
