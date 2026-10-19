/**
 * The rover-journey data contract (`arcadia-journey-v1`): one Action's past,
 * present and likely future, derived read-only from workspace records.
 *
 * The glyph vocabulary it feeds is fixed, one glyph per event kind: launch =
 * small dot; victory = green diamond; cleared = hollow rock the path arcs
 * over; obstacle = solid amber rock still on the path; gate = small circle
 * with review-attempt pips; now = haloed rover dot. Solid line = travelled,
 * dashed = ahead (fainter for the repair branch), target ring = destination.
 */

export const JOURNEY_SCHEMA = "arcadia-journey-v1";

/** One glyph each: launch dot, open rock, cleared rock, victory diamond, rover, review gate. */
export type JourneyEventKind = "launch" | "obstacle" | "cleared" | "victory" | "now" | "gate";

/**
 * The recurring obstacle classes. `null` on an event means none matched: a
 * genuine review finding about the work itself usually lands there.
 */
export const OBSTACLE_CLASSES = [
  "stale-judgement",
  "timing",
  "identity-attestation",
  "gate-misreads-bookkeeping",
  "capacity-credential",
  "environment-wall"
] as const;
export type ObstacleClass = (typeof OBSTACLE_CLASSES)[number];

export interface JourneyRef {
  kind: "pr" | "issue" | "session" | "alert";
  id: string;
  url: string | null;
}

export interface JourneyEvent {
  at: string;
  kind: JourneyEventKind;
  /** A few words, shown next to the glyph. */
  label: string;
  /** The full sentence, shown on hover or tap. */
  detail: string;
  class: ObstacleClass | null;
  ref: JourneyRef | null;
  /** Where the record that produced this event lives, for audit. */
  source: string;
}

export interface JourneyBudget {
  spent: number;
  inUse: number;
  limit: number;
}

export interface JourneyBranch {
  id: "pass" | "repair";
  label: string;
  /** False when the budget leaves no way down this branch. */
  available: boolean;
  likely: boolean;
}

export interface Journey {
  schema: typeof JOURNEY_SCHEMA;
  generatedAt: string;
  action: {
    key: string;
    project: string;
    plan: string | null;
    id: string;
    title: string | null;
  };
  destination: { label: string; reached: boolean; at: string | null; ref: JourneyRef | null };
  /** Chronological. Open obstacles (`kind: "obstacle"`) still block the way ahead. */
  events: JourneyEvent[];
  /** Where the rover is now; null once the destination is reached. */
  now: JourneyEvent | null;
  /** The independent-review gate ahead of the rover, when one stands between it and the destination. */
  gate: JourneyEvent | null;
  budget: { reviewAttempts: JourneyBudget; repairRounds: JourneyBudget };
  ahead: JourneyBranch[];
  warnings: string[];
}
