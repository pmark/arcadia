/**
 * Two different kinds of evidence about how a day actually went.
 *
 * An *interaction* is a moment Arcadia observed for free — every command,
 * from every surface, with what it was about. It costs the operator nothing
 * and answers "when was I engaged, and with what".
 *
 * A *time entry* is a block of real work the operator described in passing
 * ("spent the morning on the website, maybe two hours"). It is the only thing
 * that knows about work done away from the keyboard, and it is deliberately
 * approximate — a system that demands exact start and stop times will simply
 * not get used.
 */

export const ACTIVITY_SURFACES = ["cli", "dashboard", "discord", "automation"] as const;
export type ActivitySurface = (typeof ACTIVITY_SURFACES)[number];

export interface ActivityEvent {
  id: string;
  occurredAt: string;
  localDate: string;
  surface: ActivitySurface;
  /** The CLI command name, e.g. "orientation.reply" — the grain of "what kind of thing I was doing". */
  command: string;
  /** Human-readable subject, when the command made one plain. */
  focus: string | null;
  entryId: string | null;
  projectId: string | null;
  outcome: "ok" | "error";
  durationMs: number | null;
}

export interface RecordActivityInput {
  occurredAt: string;
  surface: ActivitySurface;
  command: string;
  focus?: string | null;
  entryId?: string | null;
  projectId?: string | null;
  outcome: "ok" | "error";
  durationMs?: number | null;
}

export interface TimeEntry {
  id: string;
  localDate: string;
  /** When the work started. Approximate by design; null when only a duration was given. */
  startedAt: string | null;
  endedAt: string | null;
  minutes: number;
  /** The operator's own words. Never rewritten — this is what gets read back. */
  description: string;
  /** What it was about: a ledger entry's title, an area, or a free-text label. */
  focus: string | null;
  entryId: string | null;
  projectId: string | null;
  area: string | null;
  source: "cli" | "discord" | "admin";
  createdAt: string;
  updatedAt: string;
}

export interface CreateTimeEntryInput {
  localDate: string;
  startedAt?: string | null;
  endedAt?: string | null;
  minutes: number;
  description: string;
  focus?: string | null;
  entryId?: string | null;
  projectId?: string | null;
  area?: string | null;
  source: TimeEntry["source"];
}

/**
 * Contiguous interactions collapsed into one stretch of engagement. Individual
 * moments are noise; the blocks are the shape of the day — when the operator
 * was actually in it, and what they were in it about.
 */
export interface EngagementBlock {
  startedAt: string;
  endedAt: string;
  minutes: number;
  interactionCount: number;
  surfaces: ActivitySurface[];
  /** Most-touched subjects during the block, most frequent first. */
  focuses: string[];
}
