/**
 * Mirrors `src/journey/schema.ts`. The dashboard shells out to the CLI, so
 * these are the wire shapes of `arcadia journey <project>/<action> --json`,
 * not a second model.
 */

export type JourneyEventKind = "launch" | "obstacle" | "cleared" | "victory" | "now" | "gate";

export type ObstacleClass =
  | "stale-judgement"
  | "timing"
  | "identity-attestation"
  | "gate-misreads-bookkeeping"
  | "capacity-credential"
  | "environment-wall";

export interface JourneyRef {
  kind: "pr" | "issue" | "session" | "alert";
  id: string;
  url: string | null;
}

export interface JourneyEvent {
  at: string;
  kind: JourneyEventKind;
  label: string;
  detail: string;
  class: ObstacleClass | null;
  ref: JourneyRef | null;
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
  available: boolean;
  likely: boolean;
}

export type JourneyPhase = "parked" | "waiting" | "launching" | "driving" | "repairing" | "in-review" | "blocked" | "arrived";

export interface JourneyActivity {
  phase: JourneyPhase;
  headline: string;
  detail: string;
  since: string | null;
  yourMove?: string | null;
}

export interface JourneyContext {
  project: { name: string; goal: string; outcome: string | null; milestone: string | null } | null;
  plan: { slug: string; milestone: string | null; active: boolean; position: number | null; total: number; done: number } | null;
  action: { title: string; why: string | null; status: string } | null;
}

export interface Journey {
  schema: "arcadia-journey-v1";
  generatedAt: string;
  action: { key: string; project: string; plan: string | null; id: string; title: string | null };
  destination: { label: string; reached: boolean; at: string | null; ref: JourneyRef | null };
  activity: JourneyActivity;
  run: { position: number; total: number; next: string | null } | null;
  context: JourneyContext | null;
  events: JourneyEvent[];
  now: JourneyEvent | null;
  gate: JourneyEvent | null;
  budget: { reviewAttempts: JourneyBudget; repairRounds: JourneyBudget };
  ahead: JourneyBranch[];
  warnings: string[];
}

/** `arcadia journey <project>/plan:<plan> --json`: one summary line per Action in Plan order. */
export interface PlanJourneyAction {
  id: string;
  title: string;
  status: string;
  current: boolean;
  journey: {
    activity: { phase: JourneyPhase; headline: string; since: string | null; yourMove: string | null };
    destination: { reached: boolean };
    counts: { victories: number; cleared: number; open: number };
  };
}

export interface PlanJourney {
  progress?: JourneyProgress;
  schema: "arcadia-plan-journey-v1";
  generatedAt: string;
  project: string;
  plan: { slug: string; milestone: string | null; active: boolean };
  context: JourneyContext;
  northStar: null;
  actions: PlanJourneyAction[];
  warnings: string[];
}





export interface ProgressEvidence {
  at: string;
  action: string;
  source: string;
  id: string;
  sessionId: string;
  kind: "delivered" | "cleared" | "failed";
  url: string | null;
}
export interface ProgressService {
  service: string;
  configuredModel: string | null;
  configuredEffort: string | null;
  runtimeModel: null;
  runtimeEffort: null;
  workType: "managed development Session";
  sessions: number;
  closedSpans: number;
  sessionHours: number | null;
  delivered: number;
  failed: number;
  sessionIds: string[];
  source: "agent_sessions";
}
export interface ProgressWindow {
  services: ProgressService[];
  start: string;
  end: string;
  elapsedDays: number;
  delivered: number;
  cleared: number;
  failed: number;
  deliveredPerDay: number;
  clearedPerDay: number;
  sessionHours: number | null;
  occupiedHours: number | null;
  sessionsWithoutBounds: number;
  evidence: ProgressEvidence[];
}
export interface JourneyProgress {
  generatedAt: string;
  timezone: "UTC";
  periods: Array<{ days: number; current: ProgressWindow; previous: ProgressWindow }>;
  limitations: string[];
}
