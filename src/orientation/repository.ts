import type Database from "better-sqlite3";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import {
  OrientationEntryNotFoundError,
  OrientationPacketAlreadySentError,
  type CreateOrientationEntryInput,
  type DailyCapacity,
  type OrientationEntry,
  type OrientationPacket,
  type SetDailyCapacityInput,
  type UpdateOrientationEntryInput
} from "./types.js";

interface OrientationEntryRow {
  id: string;
  entry_type: string;
  title: string;
  detail: string | null;
  area: string | null;
  project_id: string | null;
  priority: string;
  horizon: string;
  due_at: string | null;
  effort: string | null;
  status: string;
  last_confirmed_at: string;
  asserted_at: string;
  source: string;
  created_at: string;
  updated_at: string;
}

interface OrientationPacketRow {
  id: string;
  local_date: string;
  body: string;
  entry_snapshot_json: string;
  discord_message_id: string | null;
  created_at: string;
}

function toEntry(row: OrientationEntryRow): OrientationEntry {
  return {
    id: row.id,
    entryType: row.entry_type as OrientationEntry["entryType"],
    title: row.title,
    detail: row.detail,
    area: row.area,
    projectId: row.project_id,
    priority: row.priority as OrientationEntry["priority"],
    horizon: row.horizon as OrientationEntry["horizon"],
    dueAt: row.due_at,
    effort: (row.effort as OrientationEntry["effort"]) ?? null,
    status: row.status as OrientationEntry["status"],
    lastConfirmedAt: row.last_confirmed_at,
    assertedAt: row.asserted_at,
    source: row.source as OrientationEntry["source"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toPacket(row: OrientationPacketRow): OrientationPacket {
  return {
    id: row.id,
    localDate: row.local_date,
    body: row.body,
    entrySnapshot: JSON.parse(row.entry_snapshot_json) as OrientationPacket["entrySnapshot"],
    discordMessageId: row.discord_message_id,
    createdAt: row.created_at
  };
}

export function createOrientationEntry(db: Database.Database, input: CreateOrientationEntryInput): OrientationEntry {
  const now = nowIso();
  const id = createId("orientationEntry");
  db.prepare(
    `INSERT INTO orientation_entries (
      id, entry_type, title, detail, area, project_id, priority, horizon, due_at, effort,
      status, last_confirmed_at, asserted_at, source, created_at, updated_at
    ) VALUES (
      @id, @entry_type, @title, @detail, @area, @project_id, @priority, @horizon, @due_at, @effort,
      'active', @now, @now, @source, @now, @now
    )`
  ).run({
    id,
    entry_type: input.entryType,
    title: input.title,
    detail: input.detail ?? null,
    area: input.area ?? null,
    project_id: input.projectId ?? null,
    priority: input.priority ?? "normal",
    horizon: input.horizon ?? "soon",
    due_at: input.dueAt ?? null,
    effort: input.effort ?? null,
    source: input.source,
    now
  });
  return getOrientationEntry(db, id);
}

export function getOrientationEntry(db: Database.Database, entryId: string): OrientationEntry {
  const row = db.prepare("SELECT * FROM orientation_entries WHERE id = ?").get(entryId) as
    | OrientationEntryRow
    | undefined;
  if (!row) {
    throw new OrientationEntryNotFoundError(entryId);
  }
  return toEntry(row);
}

export function findOrientationEntry(db: Database.Database, entryId: string): OrientationEntry | null {
  const row = db.prepare("SELECT * FROM orientation_entries WHERE id = ?").get(entryId) as
    | OrientationEntryRow
    | undefined;
  return row ? toEntry(row) : null;
}

/** Live entries: those still in scope for packet composition and reply targeting. */
export function listLiveOrientationEntries(db: Database.Database): OrientationEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM orientation_entries
       WHERE status IN ('active', 'confirmed')
       ORDER BY
         CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         COALESCE(due_at, '9999-99-99'),
         created_at ASC`
    )
    .all() as OrientationEntryRow[];
  return rows.map(toEntry);
}

export function listAllOrientationEntries(db: Database.Database): OrientationEntry[] {
  const rows = db.prepare(`SELECT * FROM orientation_entries ORDER BY created_at DESC`).all() as OrientationEntryRow[];
  return rows.map(toEntry);
}

function touch(db: Database.Database, entryId: string, fields: Record<string, unknown>): OrientationEntry {
  const existing = getOrientationEntry(db, entryId);
  const now = nowIso();
  const merged = { ...fields, updated_at: now };
  const setClause = Object.keys(merged)
    .map((key) => `${key} = @${key}`)
    .join(", ");
  db.prepare(`UPDATE orientation_entries SET ${setClause} WHERE id = @id`).run({ ...merged, id: existing.id });
  return getOrientationEntry(db, entryId);
}

export function updateOrientationEntry(
  db: Database.Database,
  entryId: string,
  fields: UpdateOrientationEntryInput
): OrientationEntry {
  getOrientationEntry(db, entryId);
  const now = nowIso();
  const patch: Record<string, unknown> = { last_confirmed_at: now };
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.detail !== undefined) patch.detail = fields.detail;
  if (fields.area !== undefined) patch.area = fields.area;
  if (fields.priority !== undefined) patch.priority = fields.priority;
  if (fields.horizon !== undefined) patch.horizon = fields.horizon;
  if (fields.dueAt !== undefined) patch.due_at = fields.dueAt;
  if (fields.effort !== undefined) patch.effort = fields.effort;
  return touch(db, entryId, patch);
}

export function confirmOrientationEntry(db: Database.Database, entryId: string): OrientationEntry {
  getOrientationEntry(db, entryId);
  const now = nowIso();
  return touch(db, entryId, { status: "confirmed", last_confirmed_at: now });
}

export function reprioritizeOrientationEntry(
  db: Database.Database,
  entryId: string,
  priority: OrientationEntry["priority"]
): OrientationEntry {
  getOrientationEntry(db, entryId);
  const now = nowIso();
  return touch(db, entryId, { priority, last_confirmed_at: now });
}

export function completeOrientationEntry(db: Database.Database, entryId: string): OrientationEntry {
  getOrientationEntry(db, entryId);
  const now = nowIso();
  return touch(db, entryId, { status: "completed", last_confirmed_at: now });
}

export function dropOrientationEntry(db: Database.Database, entryId: string): OrientationEntry {
  getOrientationEntry(db, entryId);
  const now = nowIso();
  return touch(db, entryId, { status: "dropped", last_confirmed_at: now });
}

export function findPacketForLocalDate(db: Database.Database, localDate: string): OrientationPacket | null {
  const row = db.prepare("SELECT * FROM orientation_packets WHERE local_date = ?").get(localDate) as
    | OrientationPacketRow
    | undefined;
  return row ? toPacket(row) : null;
}

export function createOrientationPacket(
  db: Database.Database,
  input: { localDate: string; body: string; entrySnapshot: OrientationPacket["entrySnapshot"] }
): OrientationPacket {
  const existing = findPacketForLocalDate(db, input.localDate);
  if (existing) {
    throw new OrientationPacketAlreadySentError(input.localDate);
  }
  const id = createId("orientationPacket");
  const now = nowIso();
  db.prepare(
    `INSERT INTO orientation_packets (id, local_date, body, entry_snapshot_json, discord_message_id, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`
  ).run(id, input.localDate, input.body, JSON.stringify(input.entrySnapshot), now);
  return findPacketForLocalDate(db, input.localDate) as OrientationPacket;
}

export function markPacketSent(db: Database.Database, packetId: string, discordMessageId: string): OrientationPacket {
  db.prepare("UPDATE orientation_packets SET discord_message_id = ? WHERE id = ?").run(discordMessageId, packetId);
  const row = db.prepare("SELECT * FROM orientation_packets WHERE id = ?").get(packetId) as
    | OrientationPacketRow
    | undefined;
  if (!row) {
    throw new Error(`Orientation packet not found after mark-sent: ${packetId}`);
  }
  return toPacket(row);
}

// ---------------------------------------------------------------------------
// Daily capacity — one row per local day, amendable all day long
// ---------------------------------------------------------------------------

interface DailyCapacityRow {
  local_date: string;
  note: string;
  session_blocks: number | null;
  fragment_minutes: number | null;
  source: string;
  created_at: string;
  updated_at: string;
}

function toCapacity(row: DailyCapacityRow): DailyCapacity {
  return {
    localDate: row.local_date,
    note: row.note,
    sessionBlocks: row.session_blocks,
    fragmentMinutes: row.fragment_minutes,
    source: row.source as DailyCapacity["source"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function findDailyCapacity(db: Database.Database, localDate: string): DailyCapacity | null {
  const row = db.prepare("SELECT * FROM orientation_daily_capacity WHERE local_date = ?").get(localDate) as
    | DailyCapacityRow
    | undefined;
  return row ? toCapacity(row) : null;
}

/**
 * Upsert for the day. Amending is the normal case ("actually the client
 * session got cancelled"), so an omitted number keeps whatever was already
 * stated rather than resetting it to unknown — only an explicit null clears.
 */
export function setDailyCapacity(db: Database.Database, input: SetDailyCapacityInput): DailyCapacity {
  const now = nowIso();
  const existing = findDailyCapacity(db, input.localDate);
  const sessionBlocks = input.sessionBlocks === undefined ? existing?.sessionBlocks ?? null : input.sessionBlocks;
  const fragmentMinutes =
    input.fragmentMinutes === undefined ? existing?.fragmentMinutes ?? null : input.fragmentMinutes;

  db.prepare(
    `INSERT INTO orientation_daily_capacity (local_date, note, session_blocks, fragment_minutes, source, created_at, updated_at)
     VALUES (@local_date, @note, @session_blocks, @fragment_minutes, @source, @created_at, @updated_at)
     ON CONFLICT(local_date) DO UPDATE SET
       note = excluded.note,
       session_blocks = excluded.session_blocks,
       fragment_minutes = excluded.fragment_minutes,
       source = excluded.source,
       updated_at = excluded.updated_at`
  ).run({
    local_date: input.localDate,
    note: input.note,
    session_blocks: sessionBlocks,
    fragment_minutes: fragmentMinutes,
    source: input.source,
    created_at: existing?.createdAt ?? now,
    updated_at: now
  });

  return findDailyCapacity(db, input.localDate) as DailyCapacity;
}

export function clearDailyCapacity(db: Database.Database, localDate: string): boolean {
  const result = db.prepare("DELETE FROM orientation_daily_capacity WHERE local_date = ?").run(localDate);
  return result.changes > 0;
}

export function listRecentPackets(db: Database.Database, limit = 10): OrientationPacket[] {
  const rows = db
    .prepare("SELECT * FROM orientation_packets ORDER BY created_at DESC LIMIT ?")
    .all(limit) as OrientationPacketRow[];
  return rows.map(toPacket);
}
