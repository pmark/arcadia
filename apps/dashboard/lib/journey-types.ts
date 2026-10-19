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
  context: JourneyContext | null;
  events: JourneyEvent[];
  now: JourneyEvent | null;
  gate: JourneyEvent | null;
  budget: { reviewAttempts: JourneyBudget; repairRounds: JourneyBudget };
  ahead: JourneyBranch[];
  warnings: string[];
}
