import { EFFORT_CEILING_MINUTES, formatMinutes } from "./effort.js";
import type { DailyCapacity, OrientationEffort, OrientationEntry } from "./types.js";
import { computeOrientationUrgencyScore } from "./urgency.js";

/**
 * The scale-of-time picture: every sized item drawn to the same scale, laid
 * against how much time the day actually holds.
 *
 * The whole point is proportion. A list says "6 things"; this says "9h15m of
 * work against a 4-hour day" — the fact the operator cannot feel from a list
 * and the one that actually changes what they decide to do. Deterministic
 * arithmetic over stored effort; no model, no scheduling.
 */

export interface TimelineItem {
  id: string;
  title: string;
  effort: OrientationEffort;
  /** Minutes this item claims. Always finite — unbounded items never reach here. */
  minutes: number;
  area: string | null;
  urgencyScore: number;
  /** Cumulative minutes before this item, if everything were done back to back. */
  startMinute: number;
}

/**
 * A `project`-sized item has no honest length — that is what "multi-session"
 * means. Rather than invent a number that would quietly corrupt every total,
 * it is held off the scale and reported separately.
 */
export interface UnboundedTimelineItem {
  id: string;
  title: string;
  area: string | null;
  urgencyScore: number;
}

export interface TimelineCapacity {
  note: string;
  /** Minutes today holds: session blocks at their nominal length plus stated gap time. */
  minutes: number;
  sessionBlocks: number | null;
  fragmentMinutes: number | null;
}

export interface Timeline {
  items: TimelineItem[];
  unbounded: UnboundedTimelineItem[];
  totalMinutes: number;
  /** Live entries with no size yet — the total is a floor, not a full picture, while this is above zero. */
  unsizedCount: number;
  capacity: TimelineCapacity | null;
  /** How many days like today this collection would take. Null without capacity. */
  daysAtCurrentCapacity: number | null;
}

/** A session block is 1–3h; the midpoint is the honest planning figure for "how much is a session". */
const NOMINAL_SESSION_MINUTES = 120;

function isLive(entry: OrientationEntry): boolean {
  return entry.status === "active" || entry.status === "confirmed";
}

/**
 * Minutes a stated capacity actually holds. Unknown (null) dimensions
 * contribute nothing rather than being guessed at — the same rule the day
 * slate follows.
 */
export function capacityMinutes(capacity: DailyCapacity): number {
  return (capacity.sessionBlocks ?? 0) * NOMINAL_SESSION_MINUTES + (capacity.fragmentMinutes ?? 0);
}

export function buildTimeline(
  entries: OrientationEntry[],
  now: Date,
  options: { capacity?: DailyCapacity | null } = {}
): Timeline {
  const live = entries.filter(isLive);

  const items: TimelineItem[] = [];
  const unbounded: UnboundedTimelineItem[] = [];
  let cursor = 0;

  const sized = live
    .filter((entry): entry is OrientationEntry & { effort: OrientationEffort } => Boolean(entry.effort))
    .map((entry) => ({ entry, urgencyScore: computeOrientationUrgencyScore(entry, now) }))
    // Cheapest first, so the bars read as a ramp and the eye can compare
    // lengths without hunting; urgency orders within a size.
    .sort((a, b) => {
      const costDelta = EFFORT_CEILING_MINUTES[a.entry.effort] - EFFORT_CEILING_MINUTES[b.entry.effort];
      if (costDelta !== 0) {
        return costDelta;
      }
      if (b.urgencyScore !== a.urgencyScore) {
        return b.urgencyScore - a.urgencyScore;
      }
      return a.entry.createdAt.localeCompare(b.entry.createdAt);
    });

  for (const { entry, urgencyScore } of sized) {
    if (entry.effort === "project") {
      unbounded.push({ id: entry.id, title: entry.title, area: entry.area, urgencyScore });
      continue;
    }
    const minutes = EFFORT_CEILING_MINUTES[entry.effort];
    items.push({
      id: entry.id,
      title: entry.title,
      effort: entry.effort,
      minutes,
      area: entry.area,
      urgencyScore,
      startMinute: cursor
    });
    cursor += minutes;
  }

  const capacity = options.capacity
    ? {
        note: options.capacity.note,
        minutes: capacityMinutes(options.capacity),
        sessionBlocks: options.capacity.sessionBlocks,
        fragmentMinutes: options.capacity.fragmentMinutes
      }
    : null;

  return {
    items,
    unbounded,
    totalMinutes: cursor,
    unsizedCount: live.filter((entry) => !entry.effort).length,
    capacity,
    daysAtCurrentCapacity: capacity && capacity.minutes > 0 ? cursor / capacity.minutes : null
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BAR_UNIT_MINUTES = 15;
const MAX_BAR_BLOCKS = 40;

/**
 * One row per item, every bar drawn at the same minutes-per-block scale, and
 * a total measured against the day. Plain text on purpose: it has to read the
 * same in a terminal, a Discord message, and a mobile screen.
 */
export function renderTimelineAscii(timeline: Timeline, options: { width?: number } = {}): string[] {
  const labelWidth = Math.min(
    options.width ?? 34,
    Math.max(12, ...timeline.items.map((item) => item.title.length), ...timeline.unbounded.map((item) => item.title.length))
  );

  if (timeline.items.length === 0 && timeline.unbounded.length === 0) {
    return [
      timeline.unsizedCount > 0
        ? `Nothing is sized yet, so there is no scale to show. ${timeline.unsizedCount} entr${timeline.unsizedCount === 1 ? "y is" : "ies are"} waiting for a size.`
        : "Nothing to show."
    ];
  }

  const lines: string[] = [`Sized work, to scale (one block = ${formatMinutes(BAR_UNIT_MINUTES)})`, ""];

  const blocksFor = (minutes: number): number =>
    Math.max(1, Math.min(MAX_BAR_BLOCKS, Math.round(minutes / BAR_UNIT_MINUTES)));
  // Pad to the widest bar actually present, not the cap — a ledger of quick
  // items should not be shoved across a screen of empty space.
  const barWidth = Math.max(...timeline.items.map((item) => blocksFor(item.minutes)));

  for (const item of timeline.items) {
    lines.push(
      `${pad(item.title, labelWidth)}  ${"█".repeat(blocksFor(item.minutes)).padEnd(barWidth)}  ${formatMinutes(item.minutes).padStart(6)}  ${item.effort}`
    );
  }

  if (timeline.items.length > 0) {
    lines.push(`${" ".repeat(labelWidth)}  ${"─".repeat(barWidth)}`);
    lines.push(`${pad("Total", labelWidth)}  ${" ".repeat(barWidth)}  ${formatMinutes(timeline.totalMinutes).padStart(6)}`);
  }

  lines.push("", ...renderScaleVerdict(timeline));

  if (timeline.unbounded.length > 0) {
    lines.push("");
    lines.push("Not on the scale — multi-session, unbounded until broken down:");
    for (const item of timeline.unbounded) {
      lines.push(`  ${item.title}`);
    }
  }

  if (timeline.unsizedCount > 0) {
    lines.push("");
    lines.push(
      `${timeline.unsizedCount} un-sized entr${timeline.unsizedCount === 1 ? "y is" : "ies are"} not counted — the total above is a floor.`
    );
  }

  return lines;
}

/** The one sentence the picture exists to deliver. */
export function renderScaleVerdict(timeline: Timeline): string[] {
  if (timeline.items.length === 0) {
    return [];
  }
  const total = formatMinutes(timeline.totalMinutes);
  if (!timeline.capacity || timeline.daysAtCurrentCapacity === null) {
    return [`${total} of sized work. Tell Arcadia what today holds to see how that compares.`];
  }

  const held = formatMinutes(timeline.capacity.minutes);
  const days = timeline.daysAtCurrentCapacity;
  const dayCount = days < 1 ? "less than a day" : `about ${roundToHalf(days)} day${roundToHalf(days) === 1 ? "" : "s"}`;
  return [
    `Today holds ${held} — ${timeline.capacity.note}`,
    `${total} of sized work is ${dayCount} at today's capacity.`
  ];
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}
