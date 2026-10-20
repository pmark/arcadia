import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";

/**
 * Every Project keeps its operator-action library at the same repository-relative
 * path Arcadia uses for its own. The dashboard and `check:operator-scripts` read
 * the registered Project's main checkout (its `repo_path`), never a worktree.
 */
export const OPERATOR_LIBRARY_RELATIVE = "artifacts/generated/operator-scripts";

/**
 * Separates the Project slug from the action id in a library key, as in
 * `private-practice-now--settle-some-ask`. Slugs never contain `--`, so the
 * first occurrence splits a key unambiguously, and a bare id (no `--`) is
 * always an entry of Arcadia's own library.
 */
export const PROJECT_KEY_SEPARATOR = "--";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ProjectOperatorLibrary {
  /** The registered Project slug that owns this library. */
  project: string;
  /** The library directory, after realpath, inside that Project's checkout. */
  path: string;
}

export interface ProjectLibraryDiscovery {
  libraries: ProjectOperatorLibrary[];
  /** Why discovery read nothing, when it could not (no workspace, unreadable registry); null otherwise. */
  unavailable: string | null;
}

export function projectLibraryKey(project: string, id: string): string {
  return `${project}${PROJECT_KEY_SEPARATOR}${id}`;
}

/** Parse a library key; null when it is neither a bare id nor `<project>--<id>`. */
export function parseOperatorScriptKey(key: string): { project: string | null; id: string } | null {
  if (typeof key !== "string") return null;
  const index = key.indexOf(PROJECT_KEY_SEPARATOR);
  if (index < 0) return SLUG.test(key) ? { project: null, id: key } : null;
  const project = key.slice(0, index);
  const id = key.slice(index + PROJECT_KEY_SEPARATOR.length);
  return SLUG.test(project) && SLUG.test(id) ? { project, id } : null;
}

/**
 * Where the dashboard and the shared runners keep run state, receipts and
 * locks for a Project library: beside Arcadia's own (git-ignored) library,
 * never inside the Project's checkout, so a press can never leave that
 * checkout dirty (Agent Ask settlement refuses a dirty checkout).
 */
export function projectLibraryStateDir(arcadiaLibrary: string, project: string): string {
  if (!SLUG.test(project)) throw new Error("Invalid Project slug for an operator library.");
  return path.join(arcadiaLibrary, "projects", project);
}

function sameOrMissing(a: string, b: string): boolean {
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
}

/**
 * Confine one Project's library to its own checkout: the directory must exist
 * and resolve (after symlinks) strictly inside the resolved repository.
 */
export function confinedProjectLibrary(project: string, repoPath: string): ProjectOperatorLibrary | null {
  if (!SLUG.test(project) || !path.isAbsolute(repoPath) || !existsSync(repoPath)) return null;
  const repo = realpathSync(repoPath);
  const candidate = path.join(repo, OPERATOR_LIBRARY_RELATIVE);
  if (!existsSync(candidate)) return null;
  const library = realpathSync(candidate);
  if (!library.startsWith(repo + path.sep) || !statSync(library).isDirectory()) return null;
  return { project, path: library };
}

/**
 * The registered Projects' libraries, read-only. `ARCADIA_OPERATOR_SCRIPT_PROJECT_LIBRARIES`
 * may be `off` (read none) or a JSON object `{ "<slug>": "<absolute repository path>" }`
 * for fixtures; otherwise the live registry (each Project's `repo_path`) is read.
 * Arcadia's own library is never listed twice: a Project whose library is the
 * Arcadia library itself is skipped.
 */
export function discoverProjectOperatorLibraries(arcadiaLibrary: string, env: NodeJS.ProcessEnv = process.env): ProjectLibraryDiscovery {
  const override = env.ARCADIA_OPERATOR_SCRIPT_PROJECT_LIBRARIES?.trim();
  let registered: { slug: string; repoPath: string | null }[];
  if (override === "off") return { libraries: [], unavailable: "Project libraries are switched off for this process." };
  if (override) {
    let parsed: unknown;
    try { parsed = JSON.parse(override); } catch { return { libraries: [], unavailable: "ARCADIA_OPERATOR_SCRIPT_PROJECT_LIBRARIES is not valid JSON." }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { libraries: [], unavailable: "ARCADIA_OPERATOR_SCRIPT_PROJECT_LIBRARIES must be an object of slug to repository path." };
    registered = Object.entries(parsed as Record<string, unknown>).map(([slug, repoPath]) => ({ slug, repoPath: typeof repoPath === "string" ? repoPath : null }));
  } else {
    try {
      const { workspacePath } = resolveReadyWorkspace(env.ARCADIA_WORKSPACE?.trim() || undefined);
      registered = withReadOnlyDatabase(workspacePath, (db) =>
        listProjects(db).map((project) => ({ slug: project.slug, repoPath: getProjectMetadata(db, project.id)?.repo_path?.trim() || null })));
    } catch (error) {
      return { libraries: [], unavailable: `The Project registry could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const libraries: ProjectOperatorLibrary[] = [];
  const seen = new Set<string>();
  for (const { slug, repoPath } of registered) {
    if (!repoPath) continue;
    let library: ProjectOperatorLibrary | null;
    try { library = confinedProjectLibrary(slug, repoPath); } catch { library = null; }
    if (!library || sameOrMissing(library.path, arcadiaLibrary) || seen.has(library.path)) continue;
    seen.add(library.path);
    libraries.push(library);
  }
  libraries.sort((a, b) => a.project.localeCompare(b.project));
  return { libraries, unavailable: null };
}
