import { existsSync } from "node:fs";

import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { invocationRoot } from "../cli/invocation.js";
import {
  SAFE_TASK_BRANCH,
  countCommits,
  existingDirectory,
  git,
  hasUpstream,
  isAncestor,
  isPatchEquivalent,
  listWorktrees,
  mergedPullRequests,
  resolveBaseBranch,
  resolveComparisonBase,
  samePath,
  shortBranch,
  tryGit,
  uncommittedChanges,
  type ComparisonBase
} from "../git/worktrees.js";

/**
 * What tidy decided about one worktree or branch, and why.
 *
 * Every verdict names its reason, because the operator's actual complaint is
 * not that the mess exists — it is not knowing which branch holds the live work
 * or what state anything is in. A classification without a reason would replace
 * one opaque situation with another.
 */
export type TidyVerdict =
  /** The base branch, or where this command was invoked from. Never touched. */
  | "protected"
  /** Uncommitted changes present. Never touched, reported first. */
  | "dirty"
  /** Clean, and every commit is already on the base branch. Safe to retire. */
  | "merged"
  /** Clean, but carries commits the base branch does not have. Never touched. */
  | "unmerged"
  /** Registered worktree whose directory is gone. Safe to prune. */
  | "missing"
  /** Clean and detached, with nothing unreachable. Safe to retire. */
  | "detached";

/**
 * How a `merged` verdict was actually established.
 *
 * `ancestry` means the branch's own commits are reachable from the base
 * branch — true for an ordinary merge or fast-forward.
 *
 * `patch-equivalent` means they are not reachable, but `git cherry` finds an
 * equivalent patch already upstream for every one of them — what a cherry-pick,
 * a rebase, or an amended commit leaves behind. Local, offline, no credentials.
 *
 * `pull-request` means neither of the above held, but GitHub recorded a merged
 * pull request for the branch and the commit it actually produced
 * (`mergeCommit`) is on the base branch. Checking that commit's ancestry
 * rather than trusting GitHub's "merged" label is what makes it a proof.
 *
 * All three answer the same question — did this content land? — and each
 * catches cases the others miss, which is why a branch is only reported
 * unmerged once all three decline it.
 */
export type MergeProof = "ancestry" | "patch-equivalent" | "pull-request";

export interface TidyWorktree {
  path: string;
  branch: string | null;
  verdict: TidyVerdict;
  reason: string;
  /** Commits on this branch that the base branch does not have. */
  ahead: number;
  /** Whether a remote-tracking branch exists, so unmerged work is not necessarily lost. */
  pushed: boolean;
  uncommitted: string[];
  /** Set only when `verdict` is `merged`. */
  mergeProof: MergeProof | null;
  /** Whether `--apply` actually retired it on this run. */
  retired: boolean;
}

export interface TidyBranch {
  branch: string;
  verdict: Extract<TidyVerdict, "merged" | "unmerged" | "protected">;
  reason: string;
  ahead: number;
  pushed: boolean;
  agentOwned: boolean;
  mergeProof: MergeProof | null;
  retired: boolean;
  /** Tag written before a forced delete, so the commit stays reachable by name. Null when `git branch -d` sufficed. */
  archivedAs: string | null;
}

export interface TidyCommandData {
  repoRoot: string;
  baseBranch: string;
  /** The ref ancestry was actually checked against — `origin/<base>` when the fetch below succeeded. */
  comparisonRef: string;
  fetched: boolean;
  /** Set when fetching from `origin` was attempted and failed, so a stale-looking answer is explained rather than silent. */
  fetchNote: string | null;
  /** Whether pull-request-based verification ran at all, so a squash-merged branch reported `unmerged` can be told apart from one that was actually checked and found unmerged. */
  githubVerificationAvailable: boolean;
  applied: boolean;
  worktrees: TidyWorktree[];
  branches: TidyBranch[];
  /** Anything that could lose work if handled carelessly. */
  needsAttention: string[];
}

export interface TidyCommandOptions {
  repo?: string;
  /** Without this nothing is changed, whatever the verdicts say. */
  apply?: boolean;
  /** Also retire merged branches the operator named themselves, not just agent-owned ones. */
  includeOwnBranches?: boolean;
  /**
   * Skip fetching `origin` first. Every worktree in a repository shares one
   * set of refs, so comparing against a stale local base branch silently
   * misclassifies anything merged since the last `git pull` as unmerged.
   * Fetching first is the default for that reason; this exists for offline
   * use, where a stale-but-labelled answer beats none.
   */
  noFetch?: boolean;
  /** Skip GitHub pull-request verification even when `gh` is available. */
  noGithub?: boolean;
}

/**
 * Retire the worktrees and branches whose work is provably already on the base
 * branch, and report everything else without touching it.
 *
 * The safety rule is one sentence: **nothing is removed unless every commit it
 * carries is already reachable from the base branch, and its working tree is
 * clean.** That makes removal information-preserving by construction rather
 * than by careful reasoning — there is no state in which this command can lose
 * a commit, because a branch whose commits are all ancestors of base has no
 * commits of its own to lose.
 *
 * Everything else is reported. An unmerged branch is never deleted even when it
 * looks abandoned, a dirty worktree is never touched even when its branch is
 * merged, and `--apply` is required before anything at all is written.
 */
export function runTidyCommand(options: TidyCommandOptions = {}): CommandSuccess<TidyCommandData> {
  const repoRoot = existingDirectory(options.repo ?? invocationRoot(), "repository");
  const baseBranch = resolveBaseBranch(repoRoot);
  const worktrees = listWorktrees(repoRoot);
  const controlWorktree = worktrees[0]?.path ?? repoRoot;
  const here = invocationRoot();

  // Fetched once, against the shared repository object database — every
  // worktree sees the result, so there is no reason to repeat it per worktree.
  const comparisonBase: ComparisonBase = options.noFetch
    ? { ref: baseBranch, fetched: false, fetchError: null }
    : resolveComparisonBase(repoRoot, baseBranch);

  const prMerges = options.noGithub ? null : mergedPullRequests(repoRoot);
  const prMergeCommits = new Map(
    (prMerges ?? []).map((entry) => [entry.headBranch, { sha: entry.mergeCommitSha, number: entry.number }])
  );

  const assessed: TidyWorktree[] = worktrees.map((record) =>
    assessWorktree({ record, repoRoot, comparisonBase, controlWorktree, here, prMergeCommits })
  );

  const claimedByWorktree = new Set(
    assessed.map((entry) => entry.branch).filter((branch): branch is string => branch !== null)
  );

  const branches = assessBranches({
    repoRoot,
    comparisonBase,
    claimedByWorktree,
    includeOwn: options.includeOwnBranches,
    prMergeCommits
  });

  if (options.apply) {
    for (const entry of assessed) {
      if (entry.verdict === "merged" || entry.verdict === "missing" || entry.verdict === "detached") {
        entry.retired = retireWorktree(repoRoot, entry, baseBranch);
      }
    }
    for (const entry of branches) {
      if (entry.verdict === "merged") {
        const outcome = retireBranch(repoRoot, entry.branch);
        entry.retired = outcome.retired;
        entry.archivedAs = outcome.archivedAs;
      }
    }
  }

  return createSuccess({
    command: "tidy",
    data: {
      repoRoot,
      baseBranch,
      comparisonRef: comparisonBase.ref,
      fetched: comparisonBase.fetched,
      fetchNote: comparisonBase.fetchError,
      githubVerificationAvailable: prMerges !== null,
      applied: options.apply === true,
      worktrees: assessed,
      branches,
      needsAttention: collectAttention(assessed, branches)
    }
  });
}

function assessWorktree(input: {
  record: { path: string; head: string; branch: string | null };
  repoRoot: string;
  comparisonBase: ComparisonBase;
  controlWorktree: string;
  here: string;
  prMergeCommits: Map<string, { sha: string; number: number }>;
}): TidyWorktree {
  const { record, comparisonBase, controlWorktree, here, prMergeCommits } = input;
  const compareRef = comparisonBase.ref;
  const branch = shortBranch(record.branch);
  const base: Omit<TidyWorktree, "verdict" | "reason"> = {
    path: record.path,
    branch,
    ahead: 0,
    pushed: false,
    uncommitted: [],
    mergeProof: null,
    retired: false
  };

  if (!existsSync(record.path)) {
    return { ...base, verdict: "missing", reason: "Registered worktree whose directory no longer exists." };
  }

  if (samePath(record.path, controlWorktree)) {
    return { ...base, verdict: "protected", reason: "The repository's primary worktree." };
  }
  if (samePath(record.path, here)) {
    return { ...base, verdict: "protected", reason: "You are standing in this worktree." };
  }
  if (branch === comparisonBase.ref.replace(/^origin\//, "")) {
    return { ...base, verdict: "protected", reason: `Holds the base branch.` };
  }

  const uncommitted = uncommittedChanges(record.path);
  if (uncommitted.length > 0) {
    return {
      ...base,
      uncommitted,
      verdict: "dirty",
      reason: `${uncommitted.length} uncommitted change${uncommitted.length === 1 ? "" : "s"}; nothing here is touched.`
    };
  }

  if (branch === null) {
    const reachable = isAncestor(record.path, record.head, compareRef);
    return reachable
      ? { ...base, verdict: "detached", mergeProof: "ancestry", reason: "Detached at a commit the base branch already contains." }
      : {
          ...base,
          verdict: "unmerged",
          reason: `Detached at ${record.head.slice(0, 8)}, which the base branch does not contain. Name a branch for it before it can be retired.`
        };
  }

  const merge = evaluateMerge({ cwd: record.path, branch, compareRef, prMergeCommits });
  const pushed = hasUpstream(record.path, branch);

  if (merge.merged) {
    return { ...base, pushed, verdict: "merged", mergeProof: merge.proof, reason: merge.reason };
  }

  const reason = `${merge.reason}${pushed ? "; a remote copy exists" : "; no remote copy exists"}.`;
  return { ...base, ahead: merge.ahead, pushed, verdict: "unmerged", reason };
}

/**
 * The one place `merged` gets decided, for both worktrees and standalone
 * branches, so the two paths cannot reach different verdicts for the same
 * branch depending on which happened to be checked.
 *
 * Ancestry against the fetched base is tried first because it needs no
 * network call beyond the fetch already done once for the whole run. The
 * pull-request check only runs for branches ancestry could not clear, and
 * only when a `gh`-verified merge commit exists for that exact branch name.
 */
export function evaluateMerge(input: {
  cwd: string;
  branch: string;
  compareRef: string;
  prMergeCommits: Map<string, { sha: string; number: number }>;
}): { merged: true; proof: MergeProof; reason: string } | { merged: false; ahead: number; reason: string } {
  const { cwd, branch, compareRef, prMergeCommits } = input;
  const baseName = compareRef.replace(/^origin\//, "");
  const ahead = countCommits(cwd, compareRef, branch);

  if (ahead === 0 && isAncestor(cwd, branch, compareRef)) {
    return { merged: true, proof: "ancestry", reason: `Every commit on ${branch} is already on ${baseName}.` };
  }

  // Local and free, so it runs before reaching for the network. Catches
  // cherry-picks, rebases, and amended commits, and works with no credentials.
  if (isPatchEquivalent(cwd, compareRef, branch)) {
    return {
      merged: true,
      proof: "patch-equivalent",
      reason: `Every commit on ${branch} already exists on ${baseName} as an equivalent patch (rebased, cherry-picked, or amended).`
    };
  }

  const pr = prMergeCommits.get(branch);
  if (pr && isAncestor(cwd, pr.sha, compareRef)) {
    return {
      merged: true,
      proof: "pull-request",
      reason: `PR #${pr.number} merged (squash/rebase) — ${pr.sha.slice(0, 8)} is on ${baseName}.`
    };
  }

  return {
    merged: false,
    ahead,
    reason: `${ahead} commit${ahead === 1 ? "" : "s"} on ${branch} not on ${baseName}`
  };
}

function assessBranches(input: {
  repoRoot: string;
  comparisonBase: ComparisonBase;
  claimedByWorktree: Set<string>;
  includeOwn?: boolean;
  prMergeCommits: Map<string, { sha: string; number: number }>;
}): TidyBranch[] {
  const { repoRoot, comparisonBase, claimedByWorktree, includeOwn, prMergeCommits } = input;
  const compareRef = comparisonBase.ref;
  const baseName = compareRef.replace(/^origin\//, "");

  return git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((branch) => branch !== baseName)
    // A branch checked out somewhere is that worktree's business; deleting the
    // ref out from under it is how a worktree ends up detached and confusing.
    .filter((branch) => !claimedByWorktree.has(branch) && !claimedByWorktree.has(`refs/heads/${branch}`))
    .map((branch) => {
      const agentOwned = SAFE_TASK_BRANCH.test(branch);
      const pushed = hasUpstream(repoRoot, branch);
      const merge = evaluateMerge({ cwd: repoRoot, branch, compareRef, prMergeCommits });

      if (!merge.merged) {
        return {
          branch,
          verdict: "unmerged" as const,
          ahead: merge.ahead,
          pushed,
          agentOwned,
          mergeProof: null,
          retired: false,
          archivedAs: null,
          reason: `${merge.reason}${pushed ? "; a remote copy exists" : "; NO remote copy"}.`
        };
      }

      if (!agentOwned && !includeOwn) {
        return {
          branch,
          verdict: "protected" as const,
          ahead: 0,
          pushed,
          agentOwned,
          mergeProof: merge.proof,
          retired: false,
          archivedAs: null,
          reason: `Fully merged, but not an agent-owned name (${merge.reason.toLowerCase()}). Pass --include-own-branches to retire it too.`
        };
      }

      return {
        branch,
        verdict: "merged" as const,
        ahead: 0,
        pushed,
        agentOwned,
        mergeProof: merge.proof,
        retired: false,
        archivedAs: null,
        reason: `${merge.reason} Deleting the ref loses no commit.`
      };
    });
}

/**
 * Delete a branch whose content is already on the base branch, keeping a way
 * back even when git's own check has to be overridden.
 *
 * `git branch -d` is tried first and is usually enough. It refuses in two
 * situations that are nonetheless safe here: a branch that landed by squash,
 * rebase, or cherry-pick is not an ancestor of anything, and a branch whose
 * remote-tracking counterpart still exists is compared against *that* rather
 * than against the base branch — git will say "not yet merged to
 * refs/remotes/origin/x, even though it is merged to HEAD".
 *
 * Both cases are already proven merged by `evaluateMerge`, so the deletion is
 * information-preserving. Rather than trust that proof alone, this writes an
 * `archive/<branch>` tag first and only then forces. The commit stays
 * reachable by name forever, so even a wrong verdict costs nothing but a tag
 * to recover from.
 */
function retireBranch(repoRoot: string, branch: string): { retired: boolean; archivedAs: string | null } {
  if (tryGit(repoRoot, ["branch", "-d", branch]) !== null) {
    return { retired: true, archivedAs: null };
  }

  const tag = `archive/${branch.replace(/\//g, "-")}`;
  // `-f` so a re-run after a partial failure is not blocked by its own tag.
  if (tryGit(repoRoot, ["tag", "-f", tag, branch]) === null) {
    return { retired: false, archivedAs: null };
  }

  const forced = tryGit(repoRoot, ["branch", "-D", branch]) !== null;
  return { retired: forced, archivedAs: forced ? tag : null };
}

function retireWorktree(repoRoot: string, entry: TidyWorktree, baseBranch: string): boolean {
  const removed =
    entry.verdict === "missing"
      ? tryGit(repoRoot, ["worktree", "prune"]) !== null
      : tryGit(repoRoot, ["worktree", "remove", entry.path]) !== null;

  if (!removed) return false;

  // The branch only goes once its worktree is gone, and only when git agrees
  // it is merged. A failure here leaves the ref in place rather than forcing.
  if (entry.branch && entry.branch !== baseBranch && SAFE_TASK_BRANCH.test(entry.branch)) {
    tryGit(repoRoot, ["branch", "-d", entry.branch]);
  }
  return true;
}

/**
 * The things that could lose work, stated as instructions rather than statuses.
 *
 * This is the part the operator actually asked for: not a tidier repository,
 * but knowing what is at risk and where the live work is.
 */
function collectAttention(worktrees: TidyWorktree[], branches: TidyBranch[]): string[] {
  const attention: string[] = [];

  for (const entry of worktrees.filter((candidate) => candidate.verdict === "dirty")) {
    attention.push(
      `${entry.path} has ${entry.uncommitted.length} uncommitted change${entry.uncommitted.length === 1 ? "" : "s"}${entry.branch ? ` on ${entry.branch}` : ""}. Commit or preserve them; tidy will never discard them.`
    );
  }

  for (const entry of worktrees.filter((candidate) => candidate.verdict === "unmerged" && !candidate.pushed)) {
    attention.push(
      `${entry.path}${entry.branch ? ` (${entry.branch})` : ""} has ${entry.ahead} unmerged commit${entry.ahead === 1 ? "" : "s"} and no remote copy. This is the only copy.`
    );
  }

  for (const entry of branches.filter((candidate) => candidate.verdict === "unmerged" && !candidate.pushed)) {
    attention.push(
      `Branch ${entry.branch} has ${entry.ahead} unmerged commit${entry.ahead === 1 ? "" : "s"} and no remote copy. This is the only copy.`
    );
  }

  return attention;
}

export function renderTidySuccess(response: CommandSuccess<TidyCommandData>): string[] {
  const {
    repoRoot,
    baseBranch,
    comparisonRef,
    fetched,
    fetchNote,
    githubVerificationAvailable,
    applied,
    worktrees,
    branches,
    needsAttention
  } = response.data;

  const lines: string[] = [`Arcadia Tidy — ${repoRoot}`];

  // Freshness first, unconditionally — every verdict below depends on it, and
  // a stale comparison looks identical to a fresh one unless this is said.
  lines.push(
    fetched
      ? `Base branch: ${baseBranch} (fetched ${comparisonRef} from origin just now)`
      : `Base branch: ${baseBranch} (comparing against the LOCAL branch — ${fetchNote ?? "not fetched"})`
  );
  lines.push(
    githubVerificationAvailable
      ? "GitHub verification: on — a branch whose own commits are not on the base branch is still checked against merged pull requests, so a squash- or rebase-merged branch is not reported as unmerged."
      : "GitHub verification: unavailable (gh CLI missing, unauthenticated, or no GitHub remote) — a squash- or rebase-merged branch may be reported unmerged even though it landed."
  );
  lines.push("");

  const retirable = [...worktrees.filter(isRetirableWorktree), ...branches.filter((b) => b.verdict === "merged")];

  if (needsAttention.length > 0) {
    lines.push(`Needs your attention (${needsAttention.length}) — nothing below was touched:`);
    lines.push(...needsAttention.map((note) => `  ! ${note}`));
    lines.push("");
  }

  const live = worktrees.filter((entry) => entry.verdict === "dirty" || entry.verdict === "unmerged");
  if (live.length > 0) {
    lines.push("Where the live work is:");
    for (const entry of live) {
      lines.push(`  ${entry.branch ?? "(detached)"} — ${entry.path}`);
      lines.push(`      ${entry.reason}`);
    }
    lines.push("");
  }

  lines.push(applied ? `Retired (${retirable.length}):` : `Would retire (${retirable.length}):`);
  if (retirable.length === 0) {
    lines.push("  Nothing. Every worktree and branch either holds work or is protected.");
  } else {
    for (const entry of worktrees.filter(isRetirableWorktree)) {
      const mark = applied ? (entry.retired ? "✓" : "✗ failed") : "-";
      lines.push(`  ${mark} worktree ${entry.path}${entry.branch ? ` [${entry.branch}]` : ""}`);
      lines.push(`      ${entry.reason}`);
    }
    for (const entry of branches.filter((candidate) => candidate.verdict === "merged")) {
      const mark = applied ? (entry.retired ? "✓" : "✗ failed") : "-";
      lines.push(`  ${mark} branch   ${entry.branch}`);
      lines.push(`      ${entry.reason}`);
      if (entry.archivedAs) {
        lines.push(`      Kept as tag ${entry.archivedAs} — restore with: git branch ${entry.branch} ${entry.archivedAs}`);
      }
    }
  }

  const protectedBranches = branches.filter((entry) => entry.verdict === "protected");
  if (protectedBranches.length > 0) {
    lines.push("");
    lines.push(`Merged, but yours to confirm (${protectedBranches.length}) — pass --include-own-branches:`);
    lines.push(...protectedBranches.map((entry) => `  · ${entry.branch}`));
  }

  const unmergedBranches = branches.filter((entry) => entry.verdict === "unmerged");
  if (unmergedBranches.length > 0) {
    lines.push("");
    lines.push(`Unmerged branches (${unmergedBranches.length}) — never touched by tidy:`);
    for (const entry of unmergedBranches) {
      lines.push(`  · ${entry.branch} — ${entry.reason}`);
    }
  }

  lines.push("");
  lines.push(
    applied
      ? "Nothing was removed whose commits were not already on the base branch."
      : "Nothing was changed. Re-run with --apply to retire the items listed above."
  );

  return lines;
}

function isRetirableWorktree(entry: TidyWorktree): boolean {
  return entry.verdict === "merged" || entry.verdict === "missing" || entry.verdict === "detached";
}
