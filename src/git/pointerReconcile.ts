import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";
import {
  assertReconcilableHistory,
  baseReconciliationCommitMessage,
  countRevisionRange,
  createBaseReconciliationCommit,
  isRecognizedProtectedReconciliation,
  verifyReconciliationCommit,
  writeCleanBaseMergeTree
} from "./baseReconcile.js";
import { git, isAncestor, tryGit } from "./worktrees.js";

/**
 * Bring the local base branch onto its remote when that is safe. Pointer
 * commits (`chore(arcadia): point at ...`) are written locally and never
 * pushed, so after GitHub merges a PR the local base is both ahead (its own
 * pointer commits) and behind (the merge). A plain `--ff-only` refuses that
 * forever. When every local-only commit is such a pointer commit -- one parent,
 * a diff limited to PROJECT.md and the active Plan document -- this publishes
 * the same conflict-free two-parent reconcile commit `arcadia go` writes, then
 * fast-forwards the checkout onto it. It never rewrites or discards a local
 * commit, never pushes, and refuses (leaving the checkout untouched) on any
 * other local-only commit, a dirty tracked file, another checked-out branch,
 * a conflict, or a merged pointer pair that no longer agrees with the Plan.
 */
export type BaseSyncOutcome = "current" | "fast-forwarded" | "reconciled" | "refused";

export interface BaseSyncResult {
  outcome: BaseSyncOutcome;
  /** Why the sync refused, or null. */
  reason: string | null;
  headBefore: string | null;
  resultHead: string | null;
  /** The local-only pointer commits a reconcile kept, oldest first. */
  pointerCommits: string[];
}

export interface BaseSyncInput {
  repoRoot: string;
  baseBranch: string;
  remote?: string;
  /** False when the caller has just fetched. Defaults to fetching. */
  fetch?: boolean;
  now?: Date;
}

const POINTER_SUBJECT = /^chore\(arcadia\): point at \S/;

class SyncRefusal extends Error {}

function refuse(reason: string): never {
  throw new SyncRefusal(reason);
}

function result(outcome: BaseSyncOutcome, headBefore: string | null, resultHead: string | null, reason: string | null = null, pointerCommits: string[] = []): BaseSyncResult {
  return { outcome, reason, headBefore, resultHead, pointerCommits };
}

export function syncBaseWithOwnPointerCommits(input: BaseSyncInput): BaseSyncResult {
  const { repoRoot, baseBranch } = input;
  const remote = input.remote ?? "origin";
  const baseRef = `refs/heads/${baseBranch}`;
  const upstream = `${remote}/${baseBranch}`;
  const headBefore = tryGit(repoRoot, ["rev-parse", "--verify", baseRef])?.trim() ?? null;
  try {
    if (!headBefore) refuse(`the local branch ${baseBranch} does not exist`);
    const checkedOut = tryGit(repoRoot, ["symbolic-ref", "-q", "HEAD"])?.trim() ?? null;
    if (checkedOut !== baseRef) refuse(`the checkout is on ${checkedOut?.replace(/^refs\/heads\//, "") ?? "a detached HEAD"}, not ${baseBranch}`);
    if (input.fetch !== false && tryGit(repoRoot, ["fetch", "--quiet", remote, baseBranch]) === null) {
      refuse(`could not fetch ${upstream}`);
    }
    const remoteHead = tryGit(repoRoot, ["rev-parse", "--verify", `refs/remotes/${upstream}`])?.trim() ?? null;
    if (!remoteHead) refuse(`${upstream} is not known locally`);

    if (headBefore === remoteHead || isAncestor(repoRoot, remoteHead, headBefore)) return result("current", headBefore, headBefore);
    if (isAncestor(repoRoot, headBefore, remoteHead)) {
      if (tryGit(repoRoot, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--quiet", remoteHead]) === null) {
        refuse(`${baseBranch} cannot fast-forward onto ${upstream} (conflicting local changes)`);
      }
      return result("fast-forwarded", headBefore, tryGit(repoRoot, ["rev-parse", "HEAD"])?.trim() ?? remoteHead);
    }

    // Diverged: reconcile only a base whose local-only commits are all ours.
    const dirty = (tryGit(repoRoot, ["status", "--porcelain", "--untracked-files=no"]) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (dirty.length > 0) refuse(`the checkout has uncommitted changes (${dirty.slice(0, 5).join("; ")})`);
    const mergeBase = assertReconcilableHistory(repoRoot, { localHead: headBefore, remoteHead }, (message) => refuse(message));
    const localCommits = git(repoRoot, ["rev-list", "--reverse", `${remoteHead}..${headBefore}`]).split("\n").map((v) => v.trim()).filter(Boolean);
    const foreign = localCommits.filter((commit) => !isOwnPointerCommit(repoRoot, commit, { baseBranch, upstream, remoteHead }));
    if (localCommits.length === 0 || foreign.length > 0) {
      refuse(`${baseBranch} has local-only commits that are not pointer commits (${foreign.slice(0, 3).map((c) => c.slice(0, 12)).join(", ")})`);
    }
    let tree: string;
    try {
      tree = writeCleanBaseMergeTree(repoRoot, headBefore, remoteHead);
    } catch (error) {
      return refuseResult(headBefore, error);
    }
    const coherence = pointerPairProblem(repoRoot, tree);
    if (coherence) refuse(coherence);
    const message = baseReconciliationCommitMessage({
      baseBranch,
      upstream,
      localHead: headBefore,
      remoteHead,
      mergeBase,
      localCommits: localCommits.length,
      remoteCommits: countRevisionRange(repoRoot, `${headBefore}..${remoteHead}`)
    });
    const resultHead = createBaseReconciliationCommit({ cwd: repoRoot, tree, localHead: headBefore, remoteHead, message, now: input.now ?? new Date() });
    verifyReconciliationCommit(repoRoot, resultHead, tree, headBefore, remoteHead);
    // Re-check immediately before the only write; nothing may have moved.
    if (tryGit(repoRoot, ["rev-parse", "--verify", baseRef])?.trim() !== headBefore) refuse(`${baseBranch} moved during the reconcile`);
    if (tryGit(repoRoot, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--quiet", resultHead]) === null) {
      refuse(`${baseBranch} could not fast-forward onto the reconcile commit`);
    }
    return result("reconciled", headBefore, resultHead, null, localCommits);
  } catch (error) {
    return refuseResult(headBefore, error);
  }
}

function refuseResult(headBefore: string | null, error: unknown): BaseSyncResult {
  const reason = error instanceof SyncRefusal || error instanceof Error ? error.message : String(error);
  return result("refused", headBefore, headBefore, reason);
}

/** Throws when the sync refuses; the worker-merge sync reports that as `base_not_synced`. */
export function syncBaseOrThrow(input: BaseSyncInput): BaseSyncResult {
  const synced = syncBaseWithOwnPointerCommits(input);
  if (synced.outcome === "refused") throw validationError(synced.reason ?? "base sync refused");
  return synced;
}

function isOwnPointerCommit(cwd: string, commit: string, context: { baseBranch: string; upstream: string; remoteHead: string }): boolean {
  const parents = git(cwd, ["show", "-s", "--format=%P", commit]).trim().split(/\s+/).filter(Boolean);
  const message = git(cwd, ["show", "-s", "--format=%B", commit]);
  const subject = message.split(/\r?\n/, 1)[0];
  // A reconcile this function (or `arcadia go`) wrote earlier and never pushed.
  if (subject === `chore(arcadia): reconcile ${context.baseBranch} with ${context.upstream}`) {
    return isRecognizedProtectedReconciliation(cwd, commit, parents, message, context);
  }
  if (parents.length !== 1 || !POINTER_SUBJECT.test(subject)) return false;
  const paths = git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit]).split("\0").filter(Boolean);
  if (paths.length === 0) return false;
  const plan = activePlanPath(cwd, commit);
  return paths.every((p) => p === "PROJECT.md" || (plan !== null && p === plan));
}

function frontmatter(text: string | null): Record<string, unknown> | null {
  const match = text ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(text) : null;
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function activePlanPath(cwd: string, treeish: string): string | null {
  const slug = frontmatter(tryGit(cwd, ["show", `${treeish}:PROJECT.md`]))?.active_plan;
  return typeof slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(slug) ? `docs/plans/${slug}.md` : null;
}

/**
 * A clean three-way merge can keep a pointer the Plan no longer supports: a
 * squash merge applies a branch's pointer change as part of one patch, so the
 * merge base cannot show that the remote moved on. Returns the problem, or null
 * when PROJECT.md and the active Plan agree and the Action is still unfinished.
 */
export function pointerPairProblem(cwd: string, treeish: string): string | null {
  const project = frontmatter(tryGit(cwd, ["show", `${treeish}:PROJECT.md`]));
  const planPath = activePlanPath(cwd, treeish);
  if (!project || !planPath) return "the merged PROJECT.md has no readable active_plan";
  const plan = frontmatter(tryGit(cwd, ["show", `${treeish}:${planPath}`]));
  if (!plan) return `the merged active Plan ${planPath} is not readable`;
  const current = project.current_action;
  if (typeof current !== "string") return "the merged PROJECT.md has no current_action";
  if (plan.current_action !== undefined && plan.current_action !== current) {
    return `the merged pointer disagrees with its Plan (PROJECT.md ${current}, Plan ${String(plan.current_action)})`;
  }
  const actions = Array.isArray(plan.actions) ? (plan.actions as Array<Record<string, unknown>>) : [];
  const action = actions.find((candidate) => candidate.id === current);
  if (!action) return `the merged current_action ${current} is not an Action of ${planPath}`;
  if (action.status === "done") return `the merged current_action ${current} is already done in ${planPath}; the remote moved past this pointer`;
  return null;
}
