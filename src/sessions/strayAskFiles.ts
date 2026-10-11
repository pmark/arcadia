import { validationError } from "../cli/errors.js";
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

/** `agent-ask draft`'s file name, in the Asks directory or its `archive/`; nothing else is canonical. */
const CANONICAL_ASK_PATH = /^\.arcadia\/asks\/(?:archive\/)?agent-ask-[a-z0-9][a-z0-9._-]*\.(?:yaml|yml|json)$/;
/** Anywhere a path names the Asks directory, however oddly spelled (case, separators, a prefix). */
const UNDER_ASKS_DIRECTORY = /(?:^|\/)\.arcadia\/asks(?:\/|$)/i;

/** The paths, under `.arcadia/asks/`, that are not a canonical Agent Ask file name. Order is preserved. */
export function nonCanonicalAskPaths(paths: readonly string[]): string[] {
  return paths.filter((file) => UNDER_ASKS_DIRECTORY.test(file.replaceAll("\\", "/")) && !CANONICAL_ASK_PATH.test(file));
}

/**
 * The non-canonical Ask paths the candidate `tree` adds or modifies relative
 * to `baseRevision`. A deletion, and a file the base already carries
 * unchanged, never counts: only what this candidate itself introduces.
 */
export function strayAskFilesChangedSince(repository: string, baseRevision: string, tree: string): string[] {
  const changed = boundedExec("git", ["diff-tree", "-r", "-z", "--no-renames", "--name-only", "--diff-filter=AMT", baseRevision, tree],
    { cwd: repository, maxBuffer: 64 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
  return [...new Set(nonCanonicalAskPaths(changed))].sort();
}

/** Refuse, naming every offending path, when the candidate tree introduces a non-canonical Ask file. Changes nothing. */
export function assertNoStrayAskFiles(repository: string, baseRevision: string, tree: string): void {
  const stray = strayAskFilesChangedSince(repository, baseRevision, tree);
  if (stray.length === 0) return;
  throw validationError(
    `The candidate adds or changes ${stray.length === 1 ? "a file" : "files"} under .arcadia/asks/ that ` +
      `${stray.length === 1 ? "is not a canonical Agent Ask" : "are not canonical Agent Asks"}, so it will not be preserved: ${stray.join(", ")}. ` +
      "Remove each one from the candidate worktree, or re-submit it through `arcadia agent-ask draft` so it is written as " +
      ".arcadia/asks/agent-ask-<request_id>.yaml. The candidate worktree was left untouched.",
    { strayAskFiles: stray, remedy: "Remove the file, or draft the Ask with `arcadia agent-ask draft`." }
  );
}
