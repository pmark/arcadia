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

/** Whether a ref exists at all, so a missing branch is never mistaken for an unmerged one. */
export function refExists(cwd: string, ref: string): boolean {
  return tryGit(cwd, ["show-ref", "--verify", ref]) !== null;
}

export function hasUpstream(cwd: string, branch: string): boolean {
  return tryGit(cwd, ["rev-parse", "--verify", `${branch}@{upstream}`]) !== null;
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
