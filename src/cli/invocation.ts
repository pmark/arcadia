import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The directory the operator was actually standing in.
 *
 * Arcadia's CLI has to execute inside Arcadia's own checkout, so the launcher
 * changes directory to get there. That makes `process.cwd()` a statement about
 * the runtime rather than about the operator, and every command that resolves
 * "which repository" or "which Project" from it silently answers for Arcadia
 * no matter where the question was asked.
 *
 * `scripts/arcadia` records the real directory in `ARCADIA_INVOKED_FROM`
 * before it moves. When that is absent -- a direct `pnpm arcadia` inside a
 * checkout, or a test -- `process.cwd()` is already correct.
 */
export function invocationRoot(): string {
  const declared = process.env.ARCADIA_INVOKED_FROM?.trim();
  if (!declared) return process.cwd();
  // A stale or deleted directory must not silently redirect the answer
  // somewhere else; falling back to cwd is the honest read.
  return existsSync(declared) ? path.resolve(declared) : process.cwd();
}

/**
 * Resolve an operator-supplied path option against the directory they were
 * standing in, rather than against `process.cwd()`.
 *
 * `invocationRoot` fixes the *default* for repository-scoped options, but a
 * relative path typed explicitly went straight to `path.resolve`, which
 * answers against the runtime's working directory -- the very thing the
 * launcher changes to reach Arcadia's checkout. So `arcadia docket --repo .`
 * reported Arcadia's own repository no matter where it was run, and
 * `arcadia project setup-context --repo .` wrote `.arcadia/` files there.
 *
 * That is the same wrong-project failure `invocationRoot` exists to prevent,
 * arriving through the one form that looks the most deliberate: a path the
 * operator typed themselves. An absolute path is unaffected, because
 * `path.resolve` still lets it win.
 */
export function resolveInvocationPath(input: string): string {
  return path.resolve(invocationRoot(), input.trim());
}

/**
 * The nearest enclosing repository that declares a managed Project, or null.
 *
 * Walks upward looking for a `PROJECT.md` carrying `arcadia: v1`, which is the
 * same marker `discoverDocs` treats as the sign of a governed repository. The
 * frontmatter check matters: plenty of repositories have a `PROJECT.md` that
 * means nothing to Arcadia, and treating one of those as a Project would
 * reintroduce the wrong-answer failure from the other direction.
 */
export function enclosingProjectRoot(from = invocationRoot()): string | null {
  let directory = path.resolve(from);

  for (;;) {
    if (declaresManagedProject(path.join(directory, "PROJECT.md"))) return directory;

    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function declaresManagedProject(projectFile: string): boolean {
  if (!existsSync(projectFile)) return false;

  try {
    // Only the frontmatter is needed, and a PROJECT.md can be long.
    return /^arcadia:\s*v1\s*$/m.test(readFileSync(projectFile, "utf8").slice(0, 512));
  } catch {
    return false;
  }
}
