import type Database from "better-sqlite3";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import {
  orientationEntryNotFound,
  orientationInterpreterUnavailable,
  orientationPacketAlreadySent,
  orientationReplyAmbiguous,
  orientationReplyUnparseable,
  validationError
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
  clearDailyCapacity,
  completeOrientationEntry,
  confirmOrientationEntry,
  createOrientationEntry,
  createOrientationPacket,
  dropOrientationEntry,
  findDailyCapacity,
  findOrientationEntry,
  findOrientationPacket,
  findPacketForLocalDate,
  listAllOrientationEntries,
  listLiveOrientationEntries,
  listRecentPackets,
  markPacketSent,
  setDailyCapacity,
  updateOrientationEntry
} from "../orientation/repository.js";
import { composeMorningNarrative, gatherMorningNarrativeSnapshot } from "../orientation/morningNarrative.js";
import {
  createIntelligenceMorningAiSummarizer,
  type MorningAiSummarizer,
  type MorningAiSummary
} from "../orientation/morningAiSummary.js";
import { exportOrientationPacket, type MemorySyncEntry } from "../memory/obsidian.js";
import { isStale } from "../orientation/staleness.js";
import { formatFitResult, parseAvailableMinutesRequest, selectFittingEntries, type FitToGapResult } from "../orientation/fit.js";
import { buildTimeline, renderTimelineAscii, type Timeline } from "../orientation/timeline.js";
import { listMonitoredProjects } from "./workMonitor.js";
import { formatWorkingCopySafetyLines, scanProjectWorkingCopies } from "../workMonitoring/scanner.js";
import {
  OrientationEntryNotFoundError,
  OrientationPacketAlreadySentError,
  type DailyCapacity,
  type OrientationEffort,
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
  effort?: OrientationEffort;
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
      effort: options.effort ?? null,
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
  /** `null` clears the size back to un-sized (`--effort none`). */
  effort?: OrientationEffort | null;
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
        dueAt: options.dueAt,
        effort: options.effort
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
  summarizer?: MorningAiSummarizer;
  now?: Date;
}

export interface OrientationPacketComposeData {
  packet: OrientationPacket | null;
  alreadySent: boolean;
  aiSummary: MorningAiSummary | null;
  memory: MemorySyncEntry | null;
}

export async function runOrientationPacketComposeCommand(
  options: OrientationPacketComposeOptions
): Promise<CommandSuccess<OrientationPacketComposeData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const now = options.now ?? new Date();
    const localDate = localDateStamp(now);

    const existing = findPacketForLocalDate(db, localDate);
    if (existing) {
      if (!options.ifDue) throw orientationPacketAlreadySent(localDate);
      const alreadySent = Boolean(existing.discordMessageId);
      return createSuccess({
        command: "orientation.packet.compose",
        workspace: workspacePath,
        data: { packet: alreadySent ? null : existing, alreadySent, aiSummary: null, memory: null },
        warnings: [
          alreadySent
            ? `Already sent today's packet for ${localDate}.`
            : `Retrying send of today's already-composed packet for ${localDate}.`
        ]
      });
    }

    const entries = listLiveOrientationEntries(db);
    let dailyAdvantageLine: string | undefined;
    if (options.includeDailyAdvantage !== false) {
      const advantage = selectDailyAdvantage(db);
      if (advantage) {
        dailyAdvantageLine = `${advantage.actionTitle} (${advantage.projectName})`;
      }
    }

    // One new input: what today actually holds. Absent -> the packet composes
    // exactly as it did before capacity existed.
    const capacity = findDailyCapacity(db, localDate);
    let workSafetyLines: string[];
    try {
      const workSnapshot = scanProjectWorkingCopies(listMonitoredProjects(db));
      workSafetyLines = formatWorkingCopySafetyLines(workSnapshot);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      workSafetyLines = [`Working-copy safety scan could not complete: ${detail}`];
    }
    const morningSnapshot = gatherMorningNarrativeSnapshot(db, now);
    const morningNarrative = composeMorningNarrative(morningSnapshot);
    let aiSummary: MorningAiSummary | null = null;
    let aiWarning: string | null = null;
    try {
      aiSummary = await (options.summarizer ?? createIntelligenceMorningAiSummarizer(db, workspacePath))({
        localDate,
        sourceNarrative: morningNarrative,
        projectNames: [...new Set(morningSnapshot.recentLogs.map((log) => log.project_name || "Unassigned"))]
      });
    } catch (error) {
      aiWarning = `AI perspective unavailable; deterministic packet retained: ${error instanceof Error ? error.message : String(error)}`;
    }
    const composed = composePacket(entries, now, {
      dailyAdvantageLine,
      capacity,
      workSafetyLines,
      morningNarrative,
      aiSummary: aiSummary ?? undefined
    });

    try {
      const packet = createOrientationPacket(db, {
        localDate,
        body: composed.body,
        entrySnapshot: composed.entrySnapshot
      });
      emitOrientationEvent(db, "orientation.packet.composed", { packetId: packet.id, localDate });
      let memory: MemorySyncEntry | null = null;
      let memoryWarning: string | null = null;
      try {
        memory = exportOrientationPacket(workspacePath, { packet });
      } catch (error) {
        memoryWarning = `Obsidian export failed; Discord delivery retained: ${error instanceof Error ? error.message : String(error)}`;
      }
      return createSuccess({
        command: "orientation.packet.compose",
        workspace: workspacePath,
        data: { packet, alreadySent: false, aiSummary, memory },
        warnings: [aiWarning, memoryWarning].filter((warning): warning is string => Boolean(warning))
      });
    } catch (error) {
      if (error instanceof OrientationPacketAlreadySentError) {
        if (options.ifDue) {
          // A row for today already exists. If it was never actually pushed
          // to Discord (e.g. the process died between compose and send),
          // return it again so the caller can retry the send rather than
          // silently losing today's packet forever behind the once-per-day
          // guard.
          const conflicting = findPacketForLocalDate(db, localDate);
          const alreadySent = Boolean(conflicting?.discordMessageId);
          return createSuccess({
            command: "orientation.packet.compose",
            workspace: workspacePath,
            data: { packet: alreadySent ? null : conflicting, alreadySent, aiSummary: null, memory: null },
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

export interface OrientationPacketExportOptions {
  workspace: string;
  packetId: string;
  summarizer?: MorningAiSummarizer;
}

export interface OrientationPacketExportData {
  packet: OrientationPacket;
  aiSummary: MorningAiSummary | null;
  memory: MemorySyncEntry | null;
}

export async function runOrientationPacketExportCommand(
  options: OrientationPacketExportOptions
): Promise<CommandSuccess<OrientationPacketExportData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const packet = findOrientationPacket(db, options.packetId);
    if (!packet) throw validationError("Orientation packet was not found.", { packetId: options.packetId });
    let aiSummary: MorningAiSummary | null = null;
    let aiWarning: string | null = null;
    if (!/^\*\*AI perspective\b/m.test(packet.body)) {
      try {
        const sourceNarrative = extractMorningNarrative(packet.body);
        aiSummary = await (options.summarizer ?? createIntelligenceMorningAiSummarizer(db, workspacePath))({
          localDate: packet.localDate,
          sourceNarrative,
          projectNames: extractProjectNames(sourceNarrative)
        });
      } catch (error) {
        aiWarning = `AI perspective unavailable; exported deterministic packet: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const memory = exportOrientationPacket(workspacePath, { packet, supplementalAiSummary: aiSummary });
    return createSuccess({
      command: "orientation.packet.export",
      workspace: workspacePath,
      data: { packet, aiSummary, memory },
      warnings: aiWarning ? [aiWarning] : []
    });
  } finally {
    db.close();
  }
}

function extractMorningNarrative(packetBody: string): string {
  const match = packetBody.match(/\*\*Morning narrative\*\*\n([\s\S]*?)(?=\n\n\*\*[^\n]+\*\*|$)/);
  return match?.[1]?.trim() || packetBody;
}

function extractProjectNames(sourceNarrative: string): string[] {
  const recentChanges = sourceNarrative.match(/Recent changes:\s*([^\n]+)/)?.[1] ?? "";
  const names = [...recentChanges.matchAll(/(?:^|[.!?]\s+)([^:.\n]{1,80}):\s/g)]
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)];
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
// Fit-to-gap and daily capacity
// ---------------------------------------------------------------------------

export interface OrientationFitsOptions {
  workspace: string;
  minutes: number;
  limit?: number;
}

export interface OrientationFitsData {
  availableMinutes: number;
  fits: Array<{
    id: string;
    title: string;
    effort: OrientationEffort;
    urgencyScore: number;
    dueAt: string | null;
    area: string | null;
    stale: boolean;
  }>;
  tooBig: Array<{ id: string; title: string; effort: OrientationEffort; reason: string }>;
  unsizedCount: number;
}

function toFitsData(result: FitToGapResult): OrientationFitsData {
  return {
    availableMinutes: result.availableMinutes,
    fits: result.fits.map((item) => ({
      id: item.entry.id,
      title: item.entry.title,
      effort: item.effort,
      urgencyScore: item.urgencyScore,
      dueAt: item.entry.dueAt,
      area: item.entry.area,
      stale: item.stale
    })),
    tooBig: result.tooBig.map((item) => ({
      id: item.entry.id,
      title: item.entry.title,
      effort: item.effort,
      reason: item.reason
    })),
    unsizedCount: result.unsizedCount
  };
}

/**
 * "I have N minutes — what fits?" Entirely deterministic: a filter over the
 * effort column and a sort by the existing urgency score. No model call.
 */
export function runOrientationFitsCommand(options: OrientationFitsOptions): CommandSuccess<OrientationFitsData> {
  if (!Number.isFinite(options.minutes) || options.minutes <= 0) {
    throw validationError("Available minutes must be a positive number.", { minutes: options.minutes });
  }
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const result = selectFittingEntries(listLiveOrientationEntries(db), options.minutes, new Date(), {
      limit: options.limit
    });
    return createSuccess({ command: "orientation.fits", workspace: workspacePath, data: toFitsData(result) });
  } finally {
    db.close();
  }
}

export interface OrientationTimelineData {
  timeline: Timeline;
  /** Pre-rendered text so every surface shows the same picture. */
  lines: string[];
}

/**
 * The scale-of-time picture. Deterministic arithmetic over stored effort —
 * this is a proportion, not a schedule.
 */
export function runOrientationTimelineCommand(options: {
  workspace: string;
  localDate?: string;
}): CommandSuccess<OrientationTimelineData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const now = new Date();
    const capacity = findDailyCapacity(db, options.localDate ?? localDateStamp(now));
    const timeline = buildTimeline(listLiveOrientationEntries(db), now, { capacity });
    return createSuccess({
      command: "orientation.timeline",
      workspace: workspacePath,
      data: { timeline, lines: renderTimelineAscii(timeline) }
    });
  } finally {
    db.close();
  }
}

export function renderOrientationTimelineSuccess(response: CommandSuccess<OrientationTimelineData>): string[] {
  return response.data.lines;
}

export interface OrientationCapacitySetOptions {
  workspace: string;
  note: string;
  sessionBlocks?: number | null;
  fragmentMinutes?: number | null;
  localDate?: string;
  source?: OrientationSource;
}

export function runOrientationCapacitySetCommand(
  options: OrientationCapacitySetOptions
): CommandSuccess<{ capacity: DailyCapacity }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const localDate = options.localDate ?? localDateStamp(new Date());
    const capacity = setDailyCapacity(db, {
      localDate,
      note: options.note,
      sessionBlocks: options.sessionBlocks,
      fragmentMinutes: options.fragmentMinutes,
      source: options.source ?? "cli"
    });
    emitOrientationEvent(db, "orientation.capacity.set", { localDate, source: capacity.source });
    return createSuccess({ command: "orientation.capacity.set", workspace: workspacePath, data: { capacity } });
  } finally {
    db.close();
  }
}

export function runOrientationCapacityShowCommand(options: {
  workspace: string;
  localDate?: string;
}): CommandSuccess<{ capacity: DailyCapacity | null; localDate: string }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const localDate = options.localDate ?? localDateStamp(new Date());
    return createSuccess({
      command: "orientation.capacity.show",
      workspace: workspacePath,
      data: { capacity: findDailyCapacity(db, localDate), localDate }
    });
  } finally {
    db.close();
  }
}

export function runOrientationCapacityClearCommand(options: {
  workspace: string;
  localDate?: string;
}): CommandSuccess<{ cleared: boolean; localDate: string }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const localDate = options.localDate ?? localDateStamp(new Date());
    const cleared = clearDailyCapacity(db, localDate);
    if (cleared) {
      emitOrientationEvent(db, "orientation.capacity.cleared", { localDate });
    }
    return createSuccess({
      command: "orientation.capacity.clear",
      workspace: workspacePath,
      data: { cleared, localDate }
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
  /**
   * When the reply is submitted from a specific entry's own detail view
   * (rather than the ledger/tower level), the interpreter is told to prefer
   * this entry over any other similarly-worded one. Without this, a reply
   * like "the plumber is coming Thursday to fix it" typed from "Fix garbage
   * disposal"'s detail view can land on the wrong entry (e.g. "Fix car
   * mirror") since the interpreter otherwise sees only the raw text against
   * the whole ledger with no notion of which entry the operator was looking
   * at.
   */
  focusedEntryId?: string;
}

export interface OrientationReplyData {
  echo: string;
  confidence: number;
  applied: boolean;
  ambiguousQuestion?: string;
  touchedEntries: OrientationEntry[];
  /** Present when the reply was a deterministic "what fits in N minutes?" question. */
  fits?: OrientationFitsData;
}

/**
 * Recognizes a plain "what's in the ledger" query so it can be answered
 * deterministically (per AGENTS.md: prefer deterministic before AI) rather
 * than routed through the Intelligence interpreter, which only understands
 * write operations (add/update/complete/reprioritize/confirm/context) — it
 * has no query intent to fall back on, so a reply like "list ledgers" would
 * otherwise get treated as unstructured context or come back ambiguous.
 */
function isListRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized === "list" || normalized === "ls") {
    return true;
  }
  return /\b(list|show)\b/.test(normalized) && /\b(ledgers?|entries|entry)\b/.test(normalized);
}

function formatEntryListEcho(entries: OrientationEntry[]): string {
  if (entries.length === 0) {
    return "The ledger is empty right now.";
  }
  const lines = entries.map(
    (entry, index) =>
      `${index + 1}. ${entry.title} [${entry.priority}/${entry.horizon}${entry.effort ? `/${entry.effort}` : ""}]${entry.dueAt ? ` — due ${entry.dueAt}` : ""} (id: ${entry.id})`
  );
  return `Current ledger:\n${lines.join("\n")}`;
}

export async function runOrientationReplyCommand(
  options: OrientationReplyOptions
): Promise<CommandSuccess<OrientationReplyData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  const source = options.source ?? "cli";
  try {
    const liveEntries = listLiveOrientationEntries(db);

    if (isListRequest(options.text)) {
      return createSuccess({
        command: "orientation.reply",
        workspace: workspacePath,
        data: {
          echo: formatEntryListEcho(liveEntries),
          confidence: 1,
          applied: true,
          touchedEntries: []
        }
      });
    }

    // "I have 20 minutes — what fits?" is a query, not a ledger write, and it
    // is answerable by a filter and a sort. Answering it here keeps the
    // guardrail honest (only *capturing* effort uses the model) and gives the
    // Discord packet flow fit-to-gap for free — a reply to the morning packet
    // routes straight through this path.
    const availableMinutes = parseAvailableMinutesRequest(options.text);
    if (availableMinutes !== null) {
      const result = selectFittingEntries(liveEntries, availableMinutes, new Date());
      emitOrientationEvent(db, "orientation.fits.asked", {
        availableMinutes,
        matched: result.fits.length,
        source
      });
      return createSuccess({
        command: "orientation.reply",
        workspace: workspacePath,
        data: {
          echo: formatFitResult(result),
          confidence: 1,
          applied: true,
          touchedEntries: [],
          fits: toFitsData(result)
        }
      });
    }

    let interpretation;
    try {
      interpretation = await interpretOrientationReply(db, workspacePath, options.text, liveEntries, options.focusedEntryId);
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
    (entry) =>
      `${entry.id}  [${entry.priority}/${entry.horizon}${entry.effort ? `/${entry.effort}` : ""}]${entry.stale ? " (stale)" : ""}  ${entry.title}`
  );
}

export function renderOrientationFitsSuccess(response: CommandSuccess<OrientationFitsData>): string[] {
  const { availableMinutes, fits, unsizedCount } = response.data;
  if (fits.length === 0) {
    return [
      unsizedCount > 0
        ? `Nothing sized fits ${availableMinutes}m (${unsizedCount} entr${unsizedCount === 1 ? "y has" : "ies have"} no effort yet).`
        : `Nothing fits ${availableMinutes}m.`
    ];
  }
  return [
    `Fits in ${availableMinutes}m:`,
    ...fits.map((item) => `  ${item.id}  [${item.effort}]  ${item.title}${item.stale ? " (unconfirmed)" : ""}`)
  ];
}

function formatCapacityLine(capacity: DailyCapacity): string {
  const sessions =
    capacity.sessionBlocks === null ? "sessions: unknown" : `sessions: ${capacity.sessionBlocks}`;
  const fragments =
    capacity.fragmentMinutes === null ? "gaps: unknown" : `gaps: ${capacity.fragmentMinutes}m`;
  return `${capacity.localDate}  ${capacity.note}  (${sessions}, ${fragments})`;
}

export function renderOrientationCapacitySuccess(response: CommandSuccess<{ capacity: DailyCapacity }>): string[] {
  return [formatCapacityLine(response.data.capacity)];
}

export function renderOrientationCapacityShowSuccess(
  response: CommandSuccess<{ capacity: DailyCapacity | null; localDate: string }>
): string[] {
  const { capacity, localDate } = response.data;
  return capacity ? [formatCapacityLine(capacity)] : [`No capacity stated for ${localDate}.`];
}

export function renderOrientationCapacityClearSuccess(
  response: CommandSuccess<{ cleared: boolean; localDate: string }>
): string[] {
  return [
    response.data.cleared
      ? `Cleared capacity for ${response.data.localDate}.`
      : `No capacity was set for ${response.data.localDate}.`
  ];
}

export function renderOrientationPacketComposeSuccess(
  response: CommandSuccess<OrientationPacketComposeData>
): string[] {
  if (response.data.alreadySent || !response.data.packet) {
    return ["Already composed today's packet."];
  }
  return response.data.packet.body.split("\n");
}

export function renderOrientationPacketExportSuccess(
  response: CommandSuccess<OrientationPacketExportData>
): string[] {
  const { packet, memory } = response.data;
  if (!memory) return [`Vault memory is disabled; packet ${packet.id} was not exported.`];
  return [
    `${memory.status === "created" ? "Created" : memory.status === "updated" ? "Updated" : "Unchanged"} Morning Packet vault Record.`,
    `Record: ${memory.recordPath}`
  ];
}

export function renderOrientationPacketMarkSentSuccess(response: CommandSuccess<{ packet: OrientationPacket }>): string[] {
  return [`Packet ${response.data.packet.id} marked sent (message ${response.data.packet.discordMessageId}).`];
}

export function renderOrientationPacketListSuccess(response: CommandSuccess<{ packets: OrientationPacket[] }>): string[] {
  return response.data.packets.map((packet) => `${packet.localDate}  ${packet.id}`);
}

export function renderOrientationReplySuccess(response: CommandSuccess<OrientationReplyData>): string[] {
  const lines = response.data.echo.split("\n");
  if (response.data.fits) {
    // A "what fits?" reply is a query — reporting "touched 0 entries" would
    // read as a failure rather than an answer.
    return lines;
  }
  return [
    ...lines,
    `Touched ${response.data.touchedEntries.length} entr${response.data.touchedEntries.length === 1 ? "y" : "ies"}.`
  ];
}
