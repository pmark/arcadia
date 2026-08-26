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
