import { resolveReadyWorkspace } from "../../../src/cli/workspace";
import { withDatabase } from "../../../src/db/connection";
import { getProjectBySlug, getProjectMetadata, listProjects } from "../../../src/db/repositories";
import { ArcadiaError } from "../../../src/cli/errors";
import { ArcadiaCliError } from "./arcadia-cli";
import type { AllPlansResponse, PlanDetailResponse, PlanSummariesResponse } from "./plans-types";
import { checkPlanSummaries, isPlanSummary, readPlanSummary } from "../../../src/docs/planSummaries";
import { createFingerprintCache } from "./fingerprint-cache";
import { readPlanProgress, readProjectPlans, summariesFingerprint } from "./repo-docs";

/** The CLI's own message for a refusal, so the page says what Arcadia said. */
export function cliMessage(error: unknown): string {
  const details = error instanceof ArcadiaCliError ? error.details : null;
  if (details && typeof details === "object" && "cause" in details && typeof details.cause === "string") return details.cause;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every Project's plans. Read-only: each Project with a repository path is
 * read as `arcadia plans` reads it, in process from the cached discovery
 * (repo-docs), and a Project that fails says why on its own row instead of
 * blanking the page.
 */
export async function loadAllPlans(): Promise<AllPlansResponse> {
  const { workspacePath } = resolveReadyWorkspace();
  const projects = withDatabase(workspacePath, (db) =>
    listProjects(db).map((project) => ({ project, repoPath: getProjectMetadata(db, project.id)?.repo_path ?? null }))
  );
  const rows = await Promise.all(projects.map(async ({ project, repoPath }) => {
      const base = { id: project.id, slug: project.slug, name: project.name, status: project.status };
      if (!repoPath) return { ...base, activePlan: null, plans: null, error: "No repository path is configured, so its plans cannot be read." };
      try {
        const result = await readProjectPlans(repoPath, project.slug);
        return { ...base, activePlan: result.project?.activePlan ?? null, plans: result.plans, error: null };
      } catch (error) {
        return { ...base, activePlan: null, plans: null, error: cliMessage(error) };
      }
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { generatedAt: new Date().toISOString(), projects: rows };
}

export class PlanNotFound extends Error {}

/** One Plan and every Action in it. Throws PlanNotFound for an unknown Project. */
export async function loadPlanDetail(projectSlug: string, planSlug: string): Promise<PlanDetailResponse> {
  const { workspacePath } = resolveReadyWorkspace();
  const found = withDatabase(workspacePath, (db) => {
    const project = getProjectBySlug(db, projectSlug);
    return project ? { project, repoPath: getProjectMetadata(db, project.id)?.repo_path ?? null } : null;
  });
  if (!found) throw new PlanNotFound(`No Project "${projectSlug}" is in this workspace.`);
  if (!found.repoPath) throw new PlanNotFound(`Project "${projectSlug}" has no repository path, so its plans cannot be read.`);
  const { project, repoPath } = found;
  let progress;
  try {
    progress = await readPlanProgress(repoPath, project.slug, planSlug);
  } catch (error) {
    // `arcadia plans --plan` refuses an unknown or ungoverned Plan slug with a validation error.
    if (error instanceof ArcadiaError && error.code === "VALIDATION_ERROR") throw new PlanNotFound(error.message);
    throw error;
  }
  const list = await readProjectPlans(repoPath, project.slug).catch(() => null);
  return {
    project: { id: project.id, slug: project.slug, name: project.name },
    plan: list?.plans.find((plan) => plan.slug === planSlug) ?? null,
    progress
  };
}

/**
 * One Project's Plan summaries with their freshness, read from its repository's generated namespace. Read-only and
 * model-free; summaries are derived reading aids that never govern (Decision 0004).
 */
export async function loadPlanSummaries(projectSlug: string): Promise<PlanSummariesResponse> {
  const { workspacePath } = resolveReadyWorkspace();
  const found = withDatabase(workspacePath, (db) => {
    const project = getProjectBySlug(db, projectSlug);
    return project ? { slug: project.slug, repoPath: getProjectMetadata(db, project.id)?.repo_path ?? null } : null;
  });
  if (!found) throw new PlanNotFound(`No Project "${projectSlug}" is in this workspace.`);
  if (!found.repoPath) throw new PlanNotFound(`Project "${projectSlug}" has no repository path, so its summaries cannot be read.`);
  const plans = await summaries.get(found.repoPath);
  return { project: found.slug, generatedAt: new Date().toISOString(), plans };
}

/** Re-read only when a Plan or a summary file changes, so a summary that just went stale is never hidden. */
const summaries = createFingerprintCache<string, PlanSummariesResponse["plans"]>({
  name: "plans-server:summaries",
  keyOf: (repoPath) => repoPath,
  fingerprint: summariesFingerprint,
  load: readSummaries,
  checkAfterMs: 2_000,
  maxEntries: 50
});

function readSummaries(repoPath: string): PlanSummariesResponse["plans"] {
  const report = checkPlanSummaries(repoPath);
  const plans: PlanSummariesResponse["plans"] = {};
  for (const status of report.plans) {
    const raw = status.state === "fresh" || status.state === "stale" ? readPlanSummary(repoPath, status.plan) : null;
    plans[status.plan] = {
      state: status.state,
      planFresh: status.planFresh,
      summary: raw && isPlanSummary(raw) ? raw : null,
      actions: Object.fromEntries(status.actions.map((a) => [a.id, a.state]))
    };
  }
  return plans;
}
