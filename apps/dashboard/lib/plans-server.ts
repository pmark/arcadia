import { resolveReadyWorkspace } from "../../../src/cli/workspace";
import { withDatabase } from "../../../src/db/connection";
import { getProjectBySlug, getProjectMetadata, listProjects } from "../../../src/db/repositories";
import { ArcadiaCliError, loadPlanProgress, loadProjectPlans } from "./arcadia-cli";
import type { AllPlansResponse, PlanDetailResponse } from "./plans-types";
import { cachedStale } from "./swr-cache";

/** Plan documents change only through settlement; serve the last read and refresh behind it. */
const PLANS_TTL_MS = 20_000;
/** Each read is a CLI process (about 1.5 s of CPU through tsx); a cold page must not start one per Project at once. */
const PLAN_READ_CONCURRENCY = 3;

/** Maps with at most `limit` calls in flight, keeping input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The CLI's own message for a refusal, so the page says what Arcadia said. */
export function cliMessage(error: unknown): string {
  const details = error instanceof ArcadiaCliError ? error.details : null;
  if (details && typeof details === "object" && "cause" in details && typeof details.cause === "string") return details.cause;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every Project's plans. Read-only: each Project with a repository path is
 * read through `arcadia plans`, and a Project that fails says why on its own
 * row instead of blanking the page.
 */
export async function loadAllPlans(): Promise<AllPlansResponse> {
  const { workspacePath } = resolveReadyWorkspace();
  const projects = withDatabase(workspacePath, (db) =>
    listProjects(db).map((project) => ({ project, repoPath: getProjectMetadata(db, project.id)?.repo_path ?? null }))
  );
  const rows = await mapLimit(projects, PLAN_READ_CONCURRENCY, async ({ project, repoPath }) => {
      const base = { id: project.id, slug: project.slug, name: project.name, status: project.status };
      if (!repoPath) return { ...base, activePlan: null, plans: null, error: "No repository path is configured, so its plans cannot be read." };
      try {
        const result = await cachedStale(`plans:${project.slug}`, PLANS_TTL_MS, () => loadProjectPlans(repoPath, project.slug));
        return { ...base, activePlan: result.data.project?.activePlan ?? null, plans: result.data.plans, error: null };
      } catch (error) {
        return { ...base, activePlan: null, plans: null, error: cliMessage(error) };
      }
  });
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
  const [progress, list] = await Promise.all([
    cachedStale(`plan:${project.slug}:${planSlug}`, PLANS_TTL_MS, () => loadPlanProgress(repoPath, project.slug, planSlug)),
    cachedStale(`plans:${project.slug}`, PLANS_TTL_MS, () => loadProjectPlans(repoPath, project.slug)).catch(() => null)
  ]);
  return {
    project: { id: project.id, slug: project.slug, name: project.name },
    plan: list?.data.plans.find((plan) => plan.slug === planSlug) ?? null,
    progress: progress.data
  };
}
