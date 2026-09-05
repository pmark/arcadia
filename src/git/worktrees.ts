import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import { validationError } from "../cli/errors.js";

/**
 * Git primitives shared by every command that reasons about worktrees.
 *
 * These began as private helpers inside `arcadia go`. `arcadia tidy` needs the
 * same questions answered — is this clean, is this merged, what is the base
 * branch — and two implementations of "is it safe to delete this branch" is the
 * one duplication this repository cannot afford. Extracted verbatim rather than
 * reimplemented, so `go` and `tidy` cannot disagree about safety.
 */

export interface WorktreeRecord {
  path: string;
  head: string;
  /** Full ref, e.g. `refs/heads/main`, or null when detached. */
  branch: string | null;
}

/**
 * Branches Arcadia may retire without asking.
 *
 * An agent-owned branch is disposable by construction: it was created by a
 * dispatched session, it carries a generated name, and its work belongs on the
 * base branch or nowhere. Anything else is presumed to be the operator's and is
 * only ever reported.
 */
export const SAFE_TASK_BRANCH = /^(codex\/|claude\/|agent\/|worktree-)/;

export function shortBranch(branch: string | null): string | null {
  return branch === null ? null : branch.replace(/^refs\/heads\//, "");
}

export function existingDirectory(input: string, label: string): string {
  const resolved = path.resolve(input);
  if (!existsSync(resolved)) {
    throw validationError(`The ${label} path does not exist.`, { path: resolved });
  }
  return realpathSync(resolved);
}

/** Every uncommitted change, untracked files included. Empty means clean. */
export function uncommittedChanges(cwd: string): string[] {
  return git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean);
}

export function assertClean(cwd: string, label: string): void {
  const changes = uncommittedChanges(cwd);
  if (changes.length > 0) {
    throw validationError(`The ${label} is not clean; Arcadia will not preserve or discard changes implicitly.`, {
      path: cwd,
      changes,
      remedy: "Review and commit the intended work, or preserve it on a recovery branch, before retrying."
    });
  }
}

export function resolveBaseBranch(cwd: string): string {
  const remoteHead = tryGit(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead) return remoteHead.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    if (tryGit(cwd, ["show-ref", "--verify", `refs/heads/${candidate}`]) !== null) return candidate;
  }
  throw validationError("Arcadia could not determine the local base branch.", {
    remedy: "Configure origin/HEAD or create a local main/master branch."
  });
}

export function countCommits(cwd: string, base: string, source: string): number {
  return Number.parseInt(git(cwd, ["rev-list", "--count", `${base}..${source}`]).trim(), 10);
}

export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd }).status === 0;
}

/**
 * Whether every commit on `branch` already exists on `base` as an equivalent
 * patch, even though none of them is literally an ancestor.
 *
 * `git cherry` compares patch content rather than commit identity, so it sees
 * through the three ways history gets rewritten between a branch and the base
 * it landed on: cherry-picks, rebases, and amended commits. It prefixes each
 * commit with `-` when an equivalent patch is already upstream and `+` when it
 * is genuinely absent, so a branch is fully applied exactly when no `+` line
 * appears.
 *
 * This is the offline half of merge detection. It needs no network, no `gh`,
 * and no authentication, which matters because the alternative — asking GitHub
 * which pull requests merged — is unavailable in exactly the situations where
 * someone is most likely to be cleaning up: a fresh clone, a container, a
 * machine with no credentials. It does not replace the pull-request check,
 * which still catches squash merges that combine or reword commits enough that
 * no individual patch matches.
 *
 * Returns false rather than throwing when git cannot answer, so an
 * indeterminate result never reads as "safe to delete".
 */
export function isPatchEquivalent(cwd: string, base: string, branch: string): boolean {
  const output = tryGit(cwd, ["cherry", base, branch]);
  if (output === null) return false;

  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  // No commits at all means nothing to apply, which the ancestry check should
  // already have caught; treating it as equivalent here would let an empty or
  // failed comparison stand in for proof.
  if (lines.length === 0) return false;

  return lines.every((line) => line.startsWith("-"));
}

/** Whether a ref exists at all, so a missing branch is never mistaken for an unmerged one. */
export function refExists(cwd: string, ref: string): boolean {
  return tryGit(cwd, ["show-ref", "--verify", ref]) !== null;
}

export function hasUpstream(cwd: string, branch: string): boolean {
  return tryGit(cwd, ["rev-parse", "--verify", `${branch}@{upstream}`]) !== null;
}

/** The branch's upstream in `remote/branch` form, or null when none is configured. */
export function upstreamRef(cwd: string, branch: string): string | null {
  return tryGit(cwd, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]);
}

export function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = error as { stderr?: Buffer | string; message?: string };
    throw validationError(`Git command failed: git ${args.join(" ")}`, {
      cwd,
      cause: String(detail.stderr ?? detail.message ?? error).trim()
    });
  }
}

export function tryGit(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function parseWorktrees(output: string): WorktreeRecord[] {
  return output
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      const fields = new Map(block.split("\n").map((line) => {
        const separator = line.indexOf(" ");
        return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
      }));
      const declared = fields.get("worktree") ?? "";
      return {
        // A worktree whose directory was deleted by hand is still registered.
        // Resolving it must not throw, because tidying that is the whole point.
        path: existsSync(declared) ? realpathSync(declared) : path.resolve(declared),
        head: fields.get("HEAD") ?? "",
        branch: fields.get("branch") ?? null
      };
    });
}

export function listWorktrees(repo: string): WorktreeRecord[] {
  return parseWorktrees(git(repo, ["worktree", "list", "--porcelain"]));
}

export function samePath(left: string, right: string): boolean {
  const resolve = (value: string) => (existsSync(value) ? realpathSync(value) : path.resolve(value));
  return resolve(left) === resolve(right);
}

export function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The freshest known state of a branch, and how it was obtained.
 *
 * A worktree's local `main` reflects whatever the last person to `git pull`
 * there happened to fetch. Every worktree in a repository shares one set of
 * refs, so one stale worktree makes every ancestry check in every other
 * worktree stale too, silently — a merged branch reads as unmerged, which
 * looks safe but is not the truth being reported. Found in practice: this
 * repository's own `main` was two merged pull requests behind `origin/main`
 * with no error, no warning, and no worktree flagged as out of date.
 */
/**
 * A cheap, local-only count of what has accumulated, for nudging rather than
 * deciding.
 *
 * Deliberately does no fetch and no GitHub call: this runs at session
 * boundaries where latency is felt, and its only job is to notice that clutter
 * exists. `arcadia tidy` does the accurate work when asked. Undercounting is
 * fine and expected here — a squash-merged branch will look unmerged to this
 * check — because the nudge points at the tool that gets it right.
 *
 * This exists because the accumulation that prompted `tidy` went unnoticed for
 * weeks. Nothing surfaced it; there was no moment at which the state was put
 * in front of anyone.
 */
export interface ClutterSummary {
  extraWorktrees: number;
  branches: number;
  /** Branches whose commits are already on the base branch by plain ancestry — a floor, not a total. */
  obviouslyMerged: number;
}

export function summarizeClutter(repo: string, baseBranch: string): ClutterSummary | null {
  const worktrees = tryGit(repo, ["worktree", "list", "--porcelain"]);
  const refs = tryGit(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (worktrees === null || refs === null) return null;

  const branches = refs.split("\n").map((line) => line.trim()).filter(Boolean);
  const obviouslyMerged = branches.filter(
    (branch) => branch !== baseBranch && isAncestor(repo, branch, baseBranch)
  ).length;

  return {
    extraWorktrees: Math.max(0, parseWorktrees(worktrees).length - 1),
    branches: branches.length,
    obviouslyMerged
  };
}

export interface ComparisonBase {
  /** The ref to compare ancestry against — `origin/<base>` when fetch succeeded, else local `<base>`. */
  ref: string;
  fetched: boolean;
  /** Set when fetch was attempted and failed, so the caller can say why local data was used. */
  fetchError: string | null;
}

/**
 * Resolve the freshest available state of the base branch, fetching from
 * `origin` first. Never throws — a failed fetch (offline, no `origin`, no
 * network) falls back to whatever is already local, because reporting a
 * possibly-stale answer is better than refusing to report anything.
 */
export function resolveComparisonBase(repo: string, baseBranch: string): ComparisonBase {
  const hasOrigin = tryGit(repo, ["remote", "get-url", "origin"]) !== null;
  if (!hasOrigin) {
    return { ref: baseBranch, fetched: false, fetchError: "No `origin` remote is configured." };
  }

  const result = spawnSync("git", ["fetch", "--quiet", "origin", baseBranch], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    return {
      ref: baseBranch,
      fetched: false,
      fetchError: (result.stderr || "git fetch failed").trim().split("\n")[0]
    };
  }

  const remoteRef = `origin/${baseBranch}`;
  return refExists(repo, `refs/remotes/${remoteRef}`)
    ? { ref: remoteRef, fetched: true, fetchError: null }
    : { ref: baseBranch, fetched: false, fetchError: `origin/${baseBranch} does not exist after fetching.` };
}

export interface MergedPullRequest {
  headBranch: string;
  /** What actually landed on the base branch — the squash commit, the merge commit, or the branch tip for a fast-forward. Ancestry of *this*, not the branch tip, is what proves the content is on base. */
  mergeCommitSha: string;
  number: number;
}

/**
 * Every merged pull request GitHub knows about for this repository, or null
 * when that cannot be determined.
 *
 * This is what makes a squash- or rebase-merged branch verifiable: after such
 * a merge the branch's own commits are never ancestors of the base branch —
 * only the rewritten commit GitHub actually landed is. Checking `mergeCommit`
 * ancestry rather than the branch tip is what makes this correct regardless
 * of merge strategy.
 *
 * Returns null — never throws — when the `gh` CLI is missing, unauthenticated,
 * or the repository has no GitHub remote. A degraded answer (ancestry only) is
 * always available; this is a refinement of it, not a dependency of it.
 */
export function mergedPullRequests(repo: string): MergedPullRequest[] | null {
  const remoteUrl = tryGit(repo, ["remote", "get-url", "origin"]);
  const slug = remoteUrl ? parseGithubSlug(remoteUrl) : null;
  if (!slug) return null;

  const result = spawnSync(
    "gh",
    ["pr", "list", "--repo", slug, "--state", "merged", "--limit", "1000", "--json", "number,headRefName,mergeCommit"],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (result.status !== 0 || !result.stdout) return null;

  try {
    const parsed = JSON.parse(result.stdout) as Array<{
      number: number;
      headRefName: string;
      mergeCommit: { oid: string } | null;
    }>;
    return parsed
      .filter((entry) => entry.mergeCommit?.oid)
      .map((entry) => ({ headBranch: entry.headRefName, mergeCommitSha: entry.mergeCommit!.oid, number: entry.number }));
  } catch {
    return null;
  }
}

export function parseGithubSlug(remoteUrl: string): string | null {
  const match = remoteUrl.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}
