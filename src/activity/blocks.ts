import type { ActivityEvent, ActivitySurface, EngagementBlock } from "./types.js";

/**
 * Individual interactions are noise. What the operator can actually recognize
 * as their day is the *stretches* — "you were in it from 6:40 to 7:15, mostly
 * about the disposal". This collapses moments into those stretches.
 */
const DEFAULT_GAP_MINUTES = 30;

/**
 * A lone interaction has no measurable duration, but it did happen and
 * pretending it took zero time makes a real morning read as empty. One minute
 * is the smallest honest floor.
 */
const MINIMUM_BLOCK_MINUTES = 1;

const MS_PER_MINUTE = 60_000;

export function deriveEngagementBlocks(
  events: ActivityEvent[],
  options: { gapMinutes?: number; includeAutomation?: boolean } = {}
): EngagementBlock[] {
  const gapMs = (options.gapMinutes ?? DEFAULT_GAP_MINUTES) * MS_PER_MINUTE;
  // Background pollers and daemons are recorded (nothing is hidden) but they
  // are not the operator being present, so they never form a block.
  const relevant = events
    .filter((event) => (options.includeAutomation ? true : event.surface !== "automation"))
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const blocks: EngagementBlock[] = [];
  let current: ActivityEvent[] = [];

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    const start = new Date(current[0].occurredAt).getTime();
    const end = new Date(current[current.length - 1].occurredAt).getTime();
    blocks.push({
      startedAt: current[0].occurredAt,
      endedAt: current[current.length - 1].occurredAt,
      minutes: Math.max(MINIMUM_BLOCK_MINUTES, Math.round((end - start) / MS_PER_MINUTE)),
      interactionCount: current.length,
      surfaces: uniqueSurfaces(current),
      focuses: rankedFocuses(current)
    });
    current = [];
  };

  for (const event of relevant) {
    if (current.length === 0) {
      current.push(event);
      continue;
    }
    const previous = new Date(current[current.length - 1].occurredAt).getTime();
    if (new Date(event.occurredAt).getTime() - previous > gapMs) {
      flush();
    }
    current.push(event);
  }
  flush();

  return blocks;
}

function uniqueSurfaces(events: ActivityEvent[]): ActivitySurface[] {
  const seen = new Set<ActivitySurface>();
  for (const event of events) {
    seen.add(event.surface);
  }
  return Array.from(seen);
}

/** Most-touched subjects first — what the stretch was actually about. */
function rankedFocuses(events: ActivityEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.focus) {
      continue;
    }
    counts.set(event.focus, (counts.get(event.focus) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([focus]) => focus);
}

export function totalEngagementMinutes(blocks: EngagementBlock[]): number {
  return blocks.reduce((total, block) => total + block.minutes, 0);
}
