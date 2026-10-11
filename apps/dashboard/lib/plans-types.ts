/**
 * View models for a Project's plan list. Mirrors `src/commands/plans.ts`,
 * following the same convention as `now-types.ts`: the dashboard is a
 * separate package that talks to Arcadia over the CLI's JSON contract, so it
 * declares the shape of that contract rather than reaching across the
 * repository into the CLI's own source tree.
 */

export interface PlanRow {
  slug: string;
  status: string;
  /** false for a `dormant`/`proposed` plan: Arcadia does not evaluate or govern it. */
  governed: boolean;
  milestone: string | null;
  isActivePlan: boolean;
  actionCounts: { open: number; in_progress: number; done: number; blocked: number } | null;
  /** For an ungoverned plan, the paragraph under its own trigger heading, when it has one. */
  activationNote: string | null;
  relativePath: string;
}

export interface ProjectPlansResponse {
  repoRoot: string;
  project: { slug: string; name: string; activePlan: string | null } | null;
  plans: PlanRow[];
}

/** One Action of a Plan, as `arcadia plans --plan <slug> --all` reports it. */
export interface PlanProgressAction {
  /** `<project>/<actionId>`. */
  key: string;
  /** The Plan document's recorded status. */
  status: string;
  dependsOn: string[];
  title: string;
}

export interface PlanProgressEntry {
  key: string;
  title: string;
  status: string;
  /** Unfinished dependencies still ahead of this Action. */
  waitingOn: string[];
}

/** Mirrors `PlanProgressData` in `src/commands/plans.ts`. */
export interface PlanProgressData {
  schema: string;
  source: { planSlug: string; planPath: string; updated: string };
  counts: { open: number; in_progress: number; done: number; blocked: number; deferred: number; total: number };
  isActivePlan: boolean;
  current: (PlanProgressEntry & { basis: string }) | null;
  currentNote: string | null;
  next: PlanProgressEntry[];
  blocked: Array<PlanProgressEntry & { reason: string }>;
  actions: PlanProgressAction[];
  note: string;
}

/** `/api/plans`: every Project's plans, each Project read on its own so one failure stays local. */
export interface AllPlansResponse {
  generatedAt: string;
  projects: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    activePlan: string | null;
    plans: PlanRow[] | null;
    error: string | null;
  }>;
}

/** `/api/plans/<project>/<plan>`: one Plan with every Action. */
export interface PlanDetailResponse {
  project: { id: string; slug: string; name: string };
  plan: PlanRow | null;
  progress: PlanProgressData;
}
