import { ArcadiaError, validationError } from "../cli/errors.js";
import { resolveBaseBranch } from "../git/worktrees.js";
import { boundedExec } from "./preservationStages.js";

/**
 * Issue #1177: preservation snapshots every non-ignored file, so a hand-written,
 * non-canonical file under `.arcadia/asks/` (for example `complete-x.json`) was
 * committed into the preserved candidate and later accepted by settlement and
 * the draft-PR publish. Host settlement only ever recognizes the canonical
 * `agent-ask-<request_id>.yaml` draft, so such a file is never settled -- it
 * would simply ride into the PR. Preservation refuses it instead, naming it:
 * silently dropping it would remove it from the preserved record.
 */

/**
 * `agent-ask draft`'s file name, in the Asks directory or its `archive/`; nothing else is canonical.
 * Only YAML: draft writes `.yaml` and settlement discovery matches `.ya?ml`, so an
 * `agent-ask-*.json` would never be settled.
 */
const CANONICAL_ASK_PATH = /^\.arcadia\/asks\/(?:archive\/)?agent-ask-[a-z0-9][a-z0-9._-]*\.(?:yaml|yml)$/;
/**
 * The repository's own Asks directory. Changed paths are repo-relative, so this is
 * anchored at the root: a nested `.arcadia/asks` (a fixture repository, another
 * project's tree) is ordinary content. A backslash is a valid file-name character on
 * POSIX hosts but a separator on a Windows checkout, so it is read as one here; the
 * case-insensitive match covers a case-insensitive file system.
 */
const ROOT_ASKS_DIRECTORY = /^\.arcadia\/asks(?:\/|$)/i;
/** A draft-shaped name (`agent-ask-<id>.yaml`, directly in the Asks directory) whose id fails the slug rule. */
const DRAFT_SHAPED_ASK_PATH = /^\.arcadia\/asks\/agent-ask-[^/]*\.ya?ml$/;

/** The paths, under the repository's `.arcadia/asks/`, that are not a canonical Agent Ask file name. Order is preserved. */
export function nonCanonicalAskPaths(paths: readonly string[]): string[] {
  return paths.filter((file) => ROOT_ASKS_DIRECTORY.test(file.replaceAll("\\", "/")) && !CANONICAL_ASK_PATH.test(file));
}

/** A bounded Git timeout is not an answer: it must surface, never read as "nothing resolved". */
function rethrowTimeout(error: unknown): void {
  if (error instanceof ArcadiaError && error.code === "PRESERVATION_GIT_TIMEOUT") throw error;
}

/**
 * Where `baseRevision` forks from the project's own base branch, or null when
 * no base branch or merge base can be resolved (the caller then relies on
 * `baseRevision` alone). A recorded base that is itself a commit on the
 * candidate branch carries everything the candidate committed before it; its
 * fork point from the base branch does not.
 */
function projectBaseFork(repository: string, baseRevision: string): string | null {
  try {
    const branch = resolveBaseBranch(repository);
    const fork = boundedExec("git", ["merge-base", "--end-of-options", `refs/heads/${branch}`, baseRevision],
      { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    return /^[0-9a-f]{40,64}$/.test(fork) ? fork : null;
  } catch (error) {
    rethrowTimeout(error);
    return null;
  }
}

function addedOrModified(repository: string, from: string, tree: string): string[] {
  return boundedExec("git", ["diff-tree", "-r", "-z", "--no-renames", "--name-only", "--diff-filter=AMT", "--end-of-options", from, tree],
    { cwd: repository, maxBuffer: 64 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
}

/**
 * The non-canonical Ask paths the candidate `tree` adds or modifies relative
 * to `baseRevision`, and relative to where `baseRevision` forks from the
 * project's base branch (so a stray committed on the candidate branch before
 * its recorded base still counts). A deletion, and a file the base or the
 * base branch already carries unchanged, never counts: only what this
 * candidate itself introduces.
 */
export function strayAskFilesChangedSince(repository: string, baseRevision: string, tree: string): string[] {
  const changed = addedOrModified(repository, baseRevision, tree);
  const fork = projectBaseFork(repository, baseRevision);
  if (fork && fork !== baseRevision) changed.push(...addedOrModified(repository, fork, tree));
  return [...new Set(nonCanonicalAskPaths(changed))].sort();
}

/** Refuse, naming every offending path, when the candidate tree introduces a non-canonical Ask file. Changes nothing. */
export function assertNoStrayAskFiles(repository: string, baseRevision: string, tree: string): void {
  const stray = strayAskFilesChangedSince(repository, baseRevision, tree);
  if (stray.length === 0) return;
  // `agent-ask draft` writes `agent-ask-<request_id>.yaml` for any id it is given, so re-drafting an id that
  // fails the slug rule would recreate the same refused name: that case must say to change the id.
  const badId = stray.filter((file) => DRAFT_SHAPED_ASK_PATH.test(file));
  const other = stray.filter((file) => !DRAFT_SHAPED_ASK_PATH.test(file));
  const lead = (paths: string[]) => `The candidate adds or changes ${paths.length === 1 ? "a file" : "files"} under .arcadia/asks/ that ` +
    `${paths.length === 1 ? "is not a canonical Agent Ask" : "are not canonical Agent Asks"}, so it will not be preserved: ${paths.join(", ")}.`;
  const message = [
    other.length ? `${lead(other)} Remove each one from the candidate worktree, or re-submit it through \`arcadia agent-ask draft\` so it is ` +
      "written as .arcadia/asks/agent-ask-<request_id>.yaml. The candidate worktree was left untouched." : "",
    badId.length ? `${lead(badId)} The request_id in an agent-ask-<request_id>.yaml name must be lowercase letters, digits and hyphens, ` +
      "so this name must be changed: delete the file and draft the Ask again under a conforming request_id. " +
      "The candidate worktree was left untouched." : ""
  ].filter(Boolean).join(" ");
  throw validationError(message, { strayAskFiles: stray, remedy: "Remove the file, or draft the Ask with `arcadia agent-ask draft` under a lowercase request_id." });
}
