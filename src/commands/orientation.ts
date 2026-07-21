import type Database from "better-sqlite3";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import {
  orientationEntryNotFound,
  orientationInterpreterUnavailable,
  orientationPacketAlreadySent,
  orientationReplyAmbiguous,
  orientationReplyUnparseable
} from "../cli/errors.js";
import { openDatabase } from "../db/connection.js";
import { createId } from "../utils/id.js";
import { nowIso, localDateStamp } from "../utils/time.js";
import { selectDailyAdvantage } from "../dashboard/dailyAdvantage.js";
import { composePacket } from "../orientation/composer.js";
import {
  applyLedgerOps,
  interpretOrientationReply,
  OrientationInterpreterUnavailableError,
  OrientationOpTargetMissingError,
  OrientationReplyUnparseableError
} from "../orientation/interpreter.js";
import {
  completeOrientationEntry,
  confirmOrientationEntry,
  createOrientationEntry,
  createOrientationPacket,
  dropOrientationEntry,
  findOrientationEntry,
  findPacketForLocalDate,
  listAllOrientationEntries,
  listLiveOrientationEntries,
  listRecentPackets,
  markPacketSent,
  updateOrientationEntry
} from "../orientation/repository.js";
import { isStale } from "../orientation/staleness.js";
import {
  OrientationEntryNotFoundError,
  OrientationPacketAlreadySentError,
  type OrientationEntry,
  type OrientationEntryType,
  type OrientationHorizon,
  type OrientationPacket,
  type OrientationPriority,
  type OrientationSource
} from "../orientation/types.js";

function emitOrientationEvent(
  db: Database.Database,
  eventType: string,
  payload: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO events (id, event_type, source_module, project_id, work_item_id, artifact_id, review_item_id, payload_json, created_at)
     VALUES (@id, @event_type, 'orientation', NULL, NULL, NULL, NULL, @payload_json, @created_at)`
  ).run({
    id: createId("event"),
    event_type: eventType,
    payload_json: JSON.stringify(payload),
    created_at: nowIso()
  });
}

// ---------------------------------------------------------------------------
// Entry commands
// ---------------------------------------------------------------------------

export interface OrientationEntryAddOptions {
  workspace: string;
  entryType: OrientationEntryType;
  title: string;
  area?: string;
  priority?: OrientationPriority;
  horizon?: OrientationHorizon;
  dueAt?: string;
  detail?: string;
  source?: OrientationSource;
}

export function runOrientationEntryAddCommand(
  options: OrientationEntryAddOptions
): CommandSuccess<{ entry: OrientationEntry }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const entry = createOrientationEntry(db, {
      entryType: options.entryType,
      title: options.title,
      area: options.area ?? null,
      priority: options.priority,
      horizon: options.horizon,
      dueAt: options.dueAt ?? null,
      detail: options.detail ?? null,
      source: options.source ?? "cli"
    });
    emitOrientationEvent(db, "orientation.entry.added", { entryId: entry.id, source: entry.source });
    return createSuccess({ command: "orientation.entry.add", workspace: workspacePath, data: { entry } });
  } finally {
    db.close();
  }
}

export interface OrientationEntryListOptions {
  workspace: string;
  all?: boolean;
}

export function runOrientationEntryListCommand(
  options: OrientationEntryListOptions
): CommandSuccess<{ entries: Array<OrientationEntry & { stale: boolean }> }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const now = new Date();
    const entries = options.all ? listAllOrientationEntries(db) : listLiveOrientationEntries(db);
    return createSuccess({
      command: "orientation.entry.list",
      workspace: workspacePath,
      data: { entries: entries.map((entry) => ({ ...entry, stale: isStale(entry, now) })) }
    });
  } finally {
    db.close();
  }
}

export interface OrientationEntryMutateOptions {
  workspace: string;
  entryId: string;
}

function withEntryOrThrow<T>(db: Database.Database, entryId: string, fn: () => T): T {
  if (!findOrientationEntry(db, entryId)) {
    throw orientationEntryNotFound(entryId);
  }
  return fn();
}

export function runOrientationEntryConfirmCommand(
  options: OrientationEntryMutateOptions
): CommandSuccess<{ entry: OrientationEntry }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const entry = withEntryOrThrow(db, options.entryId, () => confirmOrientationEntry(db, options.entryId));
    emitOrientationEvent(db, "orientation.entry.confirmed", { entryId: options.entryId });
    return createSuccess({ command: "orientation.entry.confirm", workspace: workspacePath, data: { entry } });
  } finally {
    db.close();
  }
}

export function runOrientationEntryCompleteCommand(
  options: OrientationEntryMutateOptions
): CommandSuccess<{ entry: OrientationEntry }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const entry = withEntryOrThrow(db, options.entryId, () => completeOrientationEntry(db, options.entryId));
    emitOrientationEvent(db, "orientation.entry.completed", { entryId: options.entryId });
    return createSuccess({ command: "orientation.entry.complete", workspace: workspacePath, data: { entry } });
  } finally {
    db.close();
  }
}

export function runOrientationEntryDropCommand(
  options: OrientationEntryMutateOptions
): CommandSuccess<{ entry: OrientationEntry }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const entry = withEntryOrThrow(db, options.entryId, () => dropOrientationEntry(db, options.entryId));
    emitOrientationEvent(db, "orientation.entry.dropped", { entryId: options.entryId });
    return createSuccess({ command: "orientation.entry.drop", workspace: workspacePath, data: { entry } });
  } finally {
    db.close();
  }
}

export interface OrientationEntryUpdateOptions extends OrientationEntryMutateOptions {
  title?: string;
  detail?: string;
  area?: string;
  priority?: OrientationPriority;
  horizon?: OrientationHorizon;
  dueAt?: string;
}

export function runOrientationEntryUpdateCommand(
  options: OrientationEntryUpdateOptions
): CommandSuccess<{ entry: OrientationEntry }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const entry = withEntryOrThrow(db, options.entryId, () =>
      updateOrientationEntry(db, options.entryId, {
        title: options.title,
        detail: options.detail,
        area: options.area,
        priority: options.priority,
        horizon: options.horizon,
        dueAt: options.dueAt
      })
    );
    emitOrientationEvent(db, "orientation.entry.updated", { entryId: options.entryId });
    return createSuccess({ command: "orientation.entry.update", workspace: workspacePath, data: { entry } });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Packet commands
// ---------------------------------------------------------------------------

export interface OrientationPacketComposeOptions {
  workspace: string;
  ifDue?: boolean;
  includeDailyAdvantage?: boolean;
}

export function runOrientationPacketComposeCommand(
  options: OrientationPacketComposeOptions
): CommandSuccess<{ packet: OrientationPacket | null; alreadySent: boolean }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const now = new Date();
    const localDate = localDateStamp(now);

    const entries = listLiveOrientationEntries(db);
    let dailyAdvantageLine: string | undefined;
    if (options.includeDailyAdvantage !== false) {
      const advantage = selectDailyAdvantage(db);
      if (advantage) {
        dailyAdvantageLine = `${advantage.actionTitle} (${advantage.projectName})`;
      }
    }

    const composed = composePacket(entries, now, { dailyAdvantageLine });

    try {
      const packet = createOrientationPacket(db, {
        localDate,
        body: composed.body,
        entrySnapshot: composed.entrySnapshot
      });
      emitOrientationEvent(db, "orientation.packet.composed", { packetId: packet.id, localDate });
      return createSuccess({
        command: "orientation.packet.compose",
        workspace: workspacePath,
        data: { packet, alreadySent: false }
      });
    } catch (error) {
      if (error instanceof OrientationPacketAlreadySentError) {
        if (options.ifDue) {
          // A row for today already exists. If it was never actually pushed
          // to Discord (e.g. the process died between compose and send),
          // return it again so the caller can retry the send rather than
          // silently losing today's packet forever behind the once-per-day
          // guard.
          const existing = findPacketForLocalDate(db, localDate);
          const alreadySent = Boolean(existing?.discordMessageId);
          return createSuccess({
            command: "orientation.packet.compose",
            workspace: workspacePath,
            data: { packet: alreadySent ? null : existing, alreadySent },
            warnings: [
              alreadySent
                ? `Already sent today's packet for ${localDate}.`
                : `Retrying send of today's already-composed packet for ${localDate}.`
            ]
          });
        }
        throw orientationPacketAlreadySent(localDate);
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

export interface OrientationPacketMarkSentOptions {
  workspace: string;
  packetId: string;
  messageId: string;
}

export function runOrientationPacketMarkSentCommand(
  options: OrientationPacketMarkSentOptions
): CommandSuccess<{ packet: OrientationPacket }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const packet = markPacketSent(db, options.packetId, options.messageId);
    emitOrientationEvent(db, "orientation.packet.sent", { packetId: packet.id, discordMessageId: options.messageId });
    return createSuccess({ command: "orientation.packet.mark-sent", workspace: workspacePath, data: { packet } });
  } finally {
    db.close();
  }
}

export interface OrientationPacketListOptions {
  workspace: string;
  limit?: number;
}

export function runOrientationPacketListCommand(
  options: OrientationPacketListOptions
): CommandSuccess<{ packets: OrientationPacket[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    return createSuccess({
      command: "orientation.packet.list",
      workspace: workspacePath,
      data: { packets: listRecentPackets(db, options.limit ?? 10) }
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Reply / correction loop
// ---------------------------------------------------------------------------

export interface OrientationReplyOptions {
  workspace: string;
  text: string;
  source?: "cli" | "discord" | "admin";
}

export interface OrientationReplyData {
  echo: string;
  confidence: number;
  applied: boolean;
  ambiguousQuestion?: string;
  touchedEntries: OrientationEntry[];
}

export async function runOrientationReplyCommand(
  options: OrientationReplyOptions
): Promise<CommandSuccess<OrientationReplyData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  const source = options.source ?? "cli";
  try {
    const liveEntries = listLiveOrientationEntries(db);

    let interpretation;
    try {
      interpretation = await interpretOrientationReply(db, workspacePath, options.text, liveEntries);
    } catch (error) {
      if (error instanceof OrientationInterpreterUnavailableError) {
        throw orientationInterpreterUnavailable(error.message);
      }
      if (error instanceof OrientationReplyUnparseableError) {
        throw orientationReplyUnparseable(error.message);
      }
      throw error;
    }

    if (interpretation.ops.length === 0 && interpretation.ambiguousQuestion) {
      emitOrientationEvent(db, "orientation.reply.ambiguous", { question: interpretation.ambiguousQuestion });
      throw orientationReplyAmbiguous(interpretation.ambiguousQuestion);
    }

    let touchedEntries: OrientationEntry[] = [];
    try {
      touchedEntries = applyLedgerOps(db, interpretation.ops, source);
    } catch (error) {
      if (error instanceof OrientationOpTargetMissingError) {
        throw orientationEntryNotFound(error.entryId);
      }
      throw error;
    }

    for (const op of interpretation.ops) {
      emitOrientationEvent(db, `orientation.reply.op.${op.op}`, { op });
    }

    return createSuccess({
      command: "orientation.reply",
      workspace: workspacePath,
      data: {
        echo: interpretation.echo,
        confidence: interpretation.confidence,
        applied: true,
        touchedEntries
      }
    });
  } finally {
    db.close();
  }
}

export function renderOrientationEntrySuccess(response: CommandSuccess<{ entry: OrientationEntry }>): string[] {
  const { entry } = response.data;
  return [`Entry ${entry.id}: ${entry.title} [${entry.status}]`];
}

export function renderOrientationEntryListSuccess(
  response: CommandSuccess<{ entries: Array<OrientationEntry & { stale: boolean }> }>
): string[] {
  if (response.data.entries.length === 0) {
    return ["No live orientation entries."];
  }
  return response.data.entries.map(
    (entry) => `${entry.id}  [${entry.priority}/${entry.horizon}]${entry.stale ? " (stale)" : ""}  ${entry.title}`
  );
}

export function renderOrientationPacketComposeSuccess(
  response: CommandSuccess<{ packet: OrientationPacket | null; alreadySent: boolean }>
): string[] {
  if (response.data.alreadySent || !response.data.packet) {
    return ["Already composed today's packet."];
  }
  return response.data.packet.body.split("\n");
}

export function renderOrientationPacketMarkSentSuccess(response: CommandSuccess<{ packet: OrientationPacket }>): string[] {
  return [`Packet ${response.data.packet.id} marked sent (message ${response.data.packet.discordMessageId}).`];
}

export function renderOrientationPacketListSuccess(response: CommandSuccess<{ packets: OrientationPacket[] }>): string[] {
  return response.data.packets.map((packet) => `${packet.localDate}  ${packet.id}`);
}

export function renderOrientationReplySuccess(response: CommandSuccess<OrientationReplyData>): string[] {
  return [response.data.echo, `Touched ${response.data.touchedEntries.length} entr${response.data.touchedEntries.length === 1 ? "y" : "ies"}.`];
}
