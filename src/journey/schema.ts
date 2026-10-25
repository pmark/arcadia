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

/** What the rover is doing right now. */
export type JourneyPhase = "parked" | "waiting" | "launching" | "driving" | "repairing" | "in-review" | "blocked" | "arrived";

export interface JourneyActivity {
  phase: JourneyPhase;
  /** A few words: "Under repair: round 2 of 3". */
  headline: string;
  detail: string;
  /** When this phase began, as far as the records say; null when they do not say. */
  since: string | null;
  /** What the operator can do to unblock the rover, when the worker says a person is needed. */
  yourMove?: string | null;
}

/**
 * Where the Action sits in its Project, from the checked-in documents: the
 * Project's goal, outcome and milestone, and the Action's place in its Plan.
 */
export interface JourneyContext {
  project: { name: string; goal: string; outcome: string | null; milestone: string | null } | null;
  plan: { slug: string; milestone: string | null; active: boolean; position: number | null; total: number; done: number } | null;
  action: { title: string; why: string | null; status: string } | null;
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
  activity: JourneyActivity;
  /** Place in the running production's ordered scope; null when production is Off or does not name the Action. */
  run: { position: number; total: number; next: string | null } | null;
  /** Null when the Project's documents could not be read (a warning says why). */
  context: JourneyContext | null;
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

/** One Action's line in a Plan journey: its status in the Plan document and a summary of its own journey. */
export interface PlanJourneyAction {
  id: string;
  title: string;
  /** The Action's status in the checked-in Plan document. */
  status: string;
  /** True for the Project's `current_action`. */
  current: boolean;
  journey: {
    activity: { phase: JourneyPhase; headline: string; since: string | null; yourMove: string | null };
    destination: { reached: boolean };
    counts: { victories: number; cleared: number; open: number };
  };
}

/** A whole Plan's journey (`arcadia-plan-journey-v1`): one summary line per Action, in Plan order. */
export interface PlanJourney {
  schema: typeof PLAN_JOURNEY_SCHEMA;
  generatedAt: string;
  project: string;
  plan: { slug: string; milestone: string | null; active: boolean };
  context: JourneyContext;
  /** The dashboard fills this in from the Path brief; the CLI never does. */
  northStar: null;
  actions: PlanJourneyAction[];
  warnings: string[];
}

export const PLAN_JOURNEY_SCHEMA = "arcadia-plan-journey-v1";
