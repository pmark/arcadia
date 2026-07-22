import type Database from "better-sqlite3";
import { formatMinutes } from "../orientation/effort.js";
import { listLiveOrientationEntries, findDailyCapacity } from "../orientation/repository.js";
import { isApproaching, isNeglected, isStale, daysUntilDue } from "../orientation/staleness.js";
import { buildTimeline } from "../orientation/timeline.js";
import type { OrientationEntry } from "../orientation/types.js";
import { computeOrientationUrgencyScore, urgencyLevelForScore } from "../orientation/urgency.js";
import { deriveEngagementBlocks, totalEngagementMinutes } from "./blocks.js";
import { formatEncouragement, selectEncouragement, type Encouragement } from "./encouragement.js";
import { listActivityEventsBetween, listTimeEntriesBetween } from "./repository.js";
import type { EngagementBlock, TimeEntry } from "./types.js";

/**
 * The daily and weekly story. Deterministic end to end: every sentence below
 * is assembled from rows that already exist, which is precisely what lets it
 * be *inspiring* — an accurate account of a real day is encouraging on its
 * own, and a generated one the operator can't trust is worse than nothing.
 */

export interface ProgressedItem {
  title: string;
  /** What happened to it, in the operator's terms. */
  what: string;
  /** Why that mattered — the area it serves, or what it unblocks. */
  why: string;
  occurredAt: string;
}

export interface UrgentItem {
  title: string;
  why: string;
  score: number;
}

export interface FocusTotal {
  focus: string;
  minutes: number;
}

export interface ActivityReport {
  kind: "daily" | "weekly";
  startLocalDate: string;
  endLocalDate: string;
  headline: string;
  engagement: {
    blocks: EngagementBlock[];
    totalMinutes: number;
    firstAt: string | null;
    lastAt: string | null;
  };
  logged: {
    entries: TimeEntry[];
    totalMinutes: number;
    byFocus: FocusTotal[];
  };
  progressed: ProgressedItem[];
  urgent: UrgentItem[];
  becomingUrgent: UrgentItem[];
  backlog: { totalMinutes: number; daysAtCapacity: number | null } | null;
  encouragement: Encouragement;
  lines: string[];
}

/** The operator's calendar day for a UTC instant — the only day that matters in a report. */
function localDateOf(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

interface DomainEventRow {
  event_type: string;
  payload_json: string;
  created_at: string;
}

/** What each recorded event means to a person reading their own day back. */
const PROGRESS_VERBS: Record<string, string> = {
  "orientation.entry.completed": "done",
  "orientation.entry.confirmed": "confirmed still true",
  "orientation.entry.added": "added",
  "orientation.entry.dropped": "dropped",
  "orientation.reply.op.complete": "done",
  "orientation.reply.op.add": "added",
  "orientation.capacity.set": "set today's capacity"
};

export function buildActivityReport(
  db: Database.Database,
  options: { kind: "daily" | "weekly"; startLocalDate: string; endLocalDate: string; now: Date }
): ActivityReport {
  const { kind, startLocalDate, endLocalDate, now } = options;

  const activityEvents = listActivityEventsBetween(db, startLocalDate, endLocalDate);
  const blocks = deriveEngagementBlocks(activityEvents);
  const timeEntries = listTimeEntriesBetween(db, startLocalDate, endLocalDate);
  const liveEntries = listLiveOrientationEntries(db);
  const capacity = findDailyCapacity(db, endLocalDate);
  const timeline = buildTimeline(liveEntries, now, { capacity });

  const loggedMinutes = timeEntries.reduce((total, entry) => total + entry.minutes, 0);
  const progressed = collectProgress(db, startLocalDate, endLocalDate);
  const { urgent, becomingUrgent } = collectUrgency(liveEntries, now);

  const encouragement = selectEncouragement(
    {
      daysOfBacklog: timeline.daysAtCurrentCapacity,
      itemsProgressed: progressed.filter((item) => item.what === "done").length,
      minutesLogged: loggedMinutes,
      engagementBlocks: blocks.length,
      deferredCount: Math.max(0, liveEntries.filter((entry) => isNeglected(entry, now)).length),
      urgentCount: urgent.length
    },
    endLocalDate
  );

  const report: ActivityReport = {
    kind,
    startLocalDate,
    endLocalDate,
    headline: buildHeadline(kind, progressed, loggedMinutes, blocks),
    engagement: {
      blocks,
      totalMinutes: totalEngagementMinutes(blocks),
      firstAt: blocks[0]?.startedAt ?? null,
      lastAt: blocks[blocks.length - 1]?.endedAt ?? null
    },
    logged: {
      entries: timeEntries,
      totalMinutes: loggedMinutes,
      byFocus: totalsByFocus(timeEntries)
    },
    progressed,
    urgent,
    becomingUrgent,
    backlog:
      timeline.items.length > 0
        ? { totalMinutes: timeline.totalMinutes, daysAtCapacity: timeline.daysAtCurrentCapacity }
        : null,
    encouragement,
    lines: []
  };

  report.lines = renderReport(report);
  return report;
}

function buildHeadline(
  kind: "daily" | "weekly",
  progressed: ProgressedItem[],
  loggedMinutes: number,
  blocks: EngagementBlock[]
): string {
  const finished = progressed.filter((item) => item.what === "done").length;
  const period = kind === "daily" ? "Today" : "This week";

  if (finished > 0 && loggedMinutes > 0) {
    return `${period}: ${finished} thing${finished === 1 ? "" : "s"} finished and ${formatMinutes(loggedMinutes)} of tracked work.`;
  }
  if (finished > 0) {
    return `${period}: ${finished} thing${finished === 1 ? "" : "s"} finished.`;
  }
  if (loggedMinutes > 0) {
    return `${period}: ${formatMinutes(loggedMinutes)} of tracked work.`;
  }
  if (blocks.length > 0) {
    return `${period}: ${blocks.length} stretch${blocks.length === 1 ? "" : "es"} with Arcadia, nothing closed out yet.`;
  }
  return `${period}: quiet.`;
}

function collectProgress(db: Database.Database, startLocalDate: string, endLocalDate: string): ProgressedItem[] {
  // The events table is the only record of what changed *when*; entry
  // timestamps alone cannot distinguish "confirmed today" from "edited today".
  //
  // created_at is UTC, so SQLite's date() would bucket an evening's work into
  // the next day for anyone west of Greenwich. Widen by a day on each side
  // and do the real comparison in local time below.
  const rows = db
    .prepare(
      `SELECT event_type, payload_json, created_at
       FROM events
       WHERE source_module = 'orientation'
         AND date(created_at) >= date(?, '-1 day')
         AND date(created_at) <= date(?, '+1 day')
       ORDER BY created_at ASC`
    )
    .all(startLocalDate, endLocalDate) as DomainEventRow[];

  const items: ProgressedItem[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const localDate = localDateOf(row.created_at);
    if (localDate < startLocalDate || localDate > endLocalDate) {
      continue;
    }
    const what = PROGRESS_VERBS[row.event_type];
    if (!what) {
      continue;
    }
    const payload = safeParse(row.payload_json);
    const entryId = typeof payload.entryId === "string" ? payload.entryId : opEntryId(payload);
    if (!entryId) {
      continue;
    }
    const entry = db
      .prepare("SELECT title, area, priority, status FROM orientation_entries WHERE id = ?")
      .get(entryId) as { title: string; area: string | null; priority: string; status: string } | undefined;
    if (!entry) {
      continue;
    }
    // An event says what was asked for; the entry says what is true now. An
    // item completed and later reopened must not be reported as finished —
    // a report that claims credit for undone work is worse than no report.
    if (!isStillTrue(what, entry.status)) {
      continue;
    }
    const key = `${entryId}:${what}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({
      title: entry.title,
      what,
      why: whyItMatters(entry.area, entry.priority, what),
      occurredAt: row.created_at
    });
  }

  // Finishing something is the headline of any day; keep it at the top.
  return items.sort((a, b) => rank(a.what) - rank(b.what) || a.occurredAt.localeCompare(b.occurredAt));
}

function isStillTrue(what: string, currentStatus: string): boolean {
  if (what === "done") {
    return currentStatus === "completed";
  }
  if (what === "dropped") {
    return currentStatus === "dropped";
  }
  return true;
}

function rank(what: string): number {
  if (what === "done") return 0;
  if (what === "added") return 1;
  return 2;
}

function whyItMatters(area: string | null, priority: string, what: string): string {
  const where = area?.trim() ? area.trim() : "the ledger";
  if (what === "done") {
    return priority === "critical" || priority === "high"
      ? `one of the heavier things in ${where} is off the list`
      : `${where} is one item lighter`;
  }
  if (what === "added") {
    return `now tracked in ${where} instead of carried in your head`;
  }
  if (what === "dropped") {
    return `deliberately let go, not forgotten`;
  }
  return `still true, so ${where} stays honest`;
}

function opEntryId(payload: Record<string, unknown>): string | null {
  const op = payload.op;
  if (op && typeof op === "object" && "entryId" in op) {
    const value = (op as Record<string, unknown>).entryId;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Splits the ledger on the same continuous urgency score the rest of Arcadia
 * ranks by, rather than on the coarse due-date predicates alone.
 *
 * That matters: a high-priority "now" item with no due date is exactly what
 * an operator means by "becoming urgent", but it satisfies neither
 * isDueOrUrgent nor isApproaching — a report built on those alone reads
 * "nothing urgent" over a ledger of pressing work, which is the one thing
 * this section must never do.
 */
function collectUrgency(entries: OrientationEntry[], now: Date): { urgent: UrgentItem[]; becomingUrgent: UrgentItem[] } {
  const urgent: UrgentItem[] = [];
  const becomingUrgent: UrgentItem[] = [];

  for (const entry of entries) {
    const score = computeOrientationUrgencyScore(entry, now);
    const item: UrgentItem = { title: entry.title, why: urgencyReason(entry, now), score };

    if (urgencyLevelForScore(score) === "critical") {
      urgent.push(item);
    } else if (urgencyLevelForScore(score) === "attention") {
      becomingUrgent.push(item);
    }
  }

  const byScore = (a: UrgentItem, b: UrgentItem): number => b.score - a.score;
  return { urgent: urgent.sort(byScore), becomingUrgent: becomingUrgent.sort(byScore).slice(0, 5) };
}

/** The most specific true thing about why this is pressing. */
function urgencyReason(entry: OrientationEntry, now: Date): string {
  const remaining = daysUntilDue(entry, now);

  if (remaining !== undefined && remaining <= 0) {
    return remaining === 0 ? "due today" : `${Math.abs(Math.round(remaining))} days overdue`;
  }
  if (entry.entryType === "time_bound" && isApproaching(entry, now)) {
    return `due in ${Math.round(remaining ?? 0)} days`;
  }
  // Silent rot is the failure mode the ledger exists to prevent, so drifting
  // is worth saying out loud even when nothing is formally due.
  if (isNeglected(entry, now)) {
    return "untouched long enough to be drifting";
  }
  if (isStale(entry, now)) {
    return "unconfirmed for a while — still true?";
  }
  if (entry.priority === "critical") {
    return "marked critical";
  }
  return `${entry.priority} priority, ${entry.horizon}`;
}

function totalsByFocus(entries: TimeEntry[]): FocusTotal[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const focus = entry.focus?.trim() || entry.area?.trim() || "unfiled";
    totals.set(focus, (totals.get(focus) ?? 0) + entry.minutes);
  }
  return Array.from(totals.entries())
    .map(([focus, minutes]) => ({ focus, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const MAX_ROUTINE_LINES = 3;
const MAX_BLOCK_LINES = 5;

export function renderReport(report: ActivityReport): string[] {
  const lines: string[] = [];
  const title =
    report.kind === "daily"
      ? `**Arcadia — your day, ${report.endLocalDate}**`
      : `**Arcadia — your week, ${report.startLocalDate} to ${report.endLocalDate}**`;

  lines.push(title, "", report.headline);

  if (report.progressed.length > 0) {
    lines.push("", "**What moved**");
    // Finishing things is the story; capturing things is housekeeping. Over a
    // week the second can outnumber the first ten to one and bury it, so the
    // routine kinds get rolled up into a count instead of a wall of lines.
    const notable = report.progressed.filter((item) => item.what === "done" || item.what === "dropped");
    const routine = report.progressed.filter((item) => item.what !== "done" && item.what !== "dropped");

    for (const item of notable) {
      lines.push(`- ${item.title} — ${item.what}; ${item.why}`);
    }
    for (const item of routine.slice(0, MAX_ROUTINE_LINES)) {
      lines.push(`- ${item.title} — ${item.what}; ${item.why}`);
    }
    if (routine.length > MAX_ROUTINE_LINES) {
      const rest = routine.length - MAX_ROUTINE_LINES;
      lines.push(`- …and ${rest} more captured or confirmed.`);
    }
  }

  if (report.logged.entries.length > 0) {
    lines.push("", `**Where the time went** (${formatMinutes(report.logged.totalMinutes)} logged)`);
    for (const total of report.logged.byFocus) {
      lines.push(`- ${total.focus}: ${formatMinutes(total.minutes)}`);
    }
  }

  if (report.engagement.blocks.length > 0) {
    const days = new Set(report.engagement.blocks.map((block) => localDateOf(block.startedAt))).size;
    const heading =
      report.kind === "weekly"
        ? `**When you were in it** (${report.engagement.blocks.length} stretch${report.engagement.blocks.length === 1 ? "" : "es"} across ${days} day${days === 1 ? "" : "s"})`
        : "**When you were in it**";
    lines.push("", heading);

    // A week of raw stretches is a log, not a story — show the longest and
    // say how many are not listed.
    const shown = [...report.engagement.blocks]
      .sort((a, b) => b.minutes - a.minutes || a.startedAt.localeCompare(b.startedAt))
      .slice(0, MAX_BLOCK_LINES)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    for (const block of shown) {
      const focus = block.focuses.length > 0 ? ` — ${block.focuses.slice(0, 2).join(", ")}` : "";
      const day = report.kind === "weekly" ? `${localDateOf(block.startedAt)} ` : "";
      lines.push(
        `- ${day}${clockRange(block)} (${block.interactionCount} touch${block.interactionCount === 1 ? "" : "es"}, ${block.surfaces.join("/")})${focus}`
      );
    }
    if (report.engagement.blocks.length > shown.length) {
      lines.push(`- …and ${report.engagement.blocks.length - shown.length} shorter stretches.`);
    }
  }

  if (report.urgent.length > 0) {
    lines.push("", "**Urgent now**");
    for (const item of report.urgent) {
      lines.push(`- ${item.title} — ${item.why}`);
    }
  }

  if (report.becomingUrgent.length > 0) {
    lines.push("", "**Becoming urgent**");
    for (const item of report.becomingUrgent) {
      lines.push(`- ${item.title} — ${item.why}`);
    }
  }

  if (report.backlog) {
    const scale =
      report.backlog.daysAtCapacity === null
        ? `${formatMinutes(report.backlog.totalMinutes)} of sized work is outstanding.`
        : `${formatMinutes(report.backlog.totalMinutes)} of sized work outstanding — about ${roundToHalf(report.backlog.daysAtCapacity)} day${roundToHalf(report.backlog.daysAtCapacity) === 1 ? "" : "s"} at your stated capacity.`;
    lines.push("", `**The shape of what's left**`, scale);
  }

  lines.push("", formatEncouragement(report.encouragement));
  return lines;
}

function clockRange(block: EngagementBlock): string {
  const start = new Date(block.startedAt);
  const end = new Date(block.endedAt);
  return block.minutes <= 1 ? clock(start) : `${clock(start)}–${clock(end)}`;
}

function clock(date: Date): string {
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
