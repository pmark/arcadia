import path from "node:path";
import { resolveReadyWorkspace } from "../../../src/cli/workspace";
import { withReadOnlyDatabase } from "../../../src/db/connection";
import { getProjectBySlug, getProjectMetadata, listProjects } from "../../../src/db/repositories";
import { deriveRoadmap, roadmapFingerprint, type RoadmapView } from "../../../src/roadmap/derive";
import { createFingerprintCache } from "./fingerprint-cache";

export class RoadmapProjectNotFound extends Error {}

/** The workspace could not be opened for reading (not set up, database missing or locked). Says so in words, without paths. */
export class RoadmapWorkspaceUnavailable extends Error {}

/**
 * Read the workspace database, read-only, waiting briefly for a writer instead of failing at once. A read-only
 * connection has no busy timeout of its own, so a service committing at that moment would otherwise surface as SQLITE_BUSY.
 */
function readWorkspace<T>(callback: (db: Parameters<Parameters<typeof withReadOnlyDatabase>[1]>[0]) => T): T {
  try {
    const { workspacePath } = resolveReadyWorkspace();
    return withReadOnlyDatabase(workspacePath, (db) => {
      db.pragma("busy_timeout = 5000");
      return callback(db);
    });
  } catch (error) {
    if (error instanceof RoadmapProjectNotFound) throw error;
    throw new RoadmapWorkspaceUnavailable("The Arcadia workspace could not be read (it may not be set up, or its database is missing or busy). Nothing was changed; try again in a moment.");
  }
}

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
  const found = readWorkspace((db) => {
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
  return readWorkspace((db) => listProjects(db).filter((p) => getProjectMetadata(db, p.id)?.repo_path).map((p) => p.slug));
}
