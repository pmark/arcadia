import path from "node:path";
import { resolveReadyWorkspace } from "../../../src/cli/workspace";
import { withDatabase } from "../../../src/db/connection";
import { getProjectBySlug, getProjectMetadata, listProjects } from "../../../src/db/repositories";
import { deriveRoadmap, roadmapFingerprint, type RoadmapView } from "../../../src/roadmap/derive";
import { createFingerprintCache } from "./fingerprint-cache";

export class RoadmapProjectNotFound extends Error {}

/**
 * The Roadmap is derived from checked-in files only, in process (no CLI subprocess), and rebuilt only when a source's
 * size or modification time changes. A hit costs a stat walk at most every `CHECK_AFTER_MS`; an idle page is never
 * served a copy older than the cache's `maxStaleMs`.
 */
const CHECK_AFTER_MS = 2_000;

const roadmaps = createFingerprintCache<string, RoadmapView>({
  name: "roadmap-server:view",
  keyOf: (repoPath) => path.resolve(repoPath),
  fingerprint: (repoPath) => roadmapFingerprint(repoPath),
  load: (repoPath) => deriveRoadmap(repoPath),
  checkAfterMs: CHECK_AFTER_MS,
  maxEntries: 20
});

function repoPathOf(projectSlug: string): string {
  const { workspacePath } = resolveReadyWorkspace();
  const found = withDatabase(workspacePath, (db) => {
    const project = getProjectBySlug(db, projectSlug);
    return project ? { repoPath: getProjectMetadata(db, project.id)?.repo_path ?? null } : null;
  });
  if (!found) throw new RoadmapProjectNotFound(`No Project "${projectSlug}" is in this workspace.`);
  if (!found.repoPath) throw new RoadmapProjectNotFound(`Project "${projectSlug}" has no repository path, so its Roadmap cannot be read.`);
  return found.repoPath;
}

/** One Project's Roadmap. Read-only. `fresh` (the operator's Refresh) checks the sources before answering. */
export async function loadRoadmap(projectSlug: string, options: { fresh?: boolean } = {}): Promise<RoadmapView> {
  return roadmaps.get(repoPathOf(projectSlug), options);
}

/** The Project slugs a Roadmap can open, for the bare `/workspace/roadmap` address. */
export function roadmapProjectSlugs(): string[] {
  const { workspacePath } = resolveReadyWorkspace();
  return withDatabase(workspacePath, (db) => listProjects(db).filter((p) => getProjectMetadata(db, p.id)?.repo_path).map((p) => p.slug));
}
