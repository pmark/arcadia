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
  listWorktrees,
  refExists,
  resolveBaseBranch,
  samePath,
  shortBranch,
  tryGit,
  uncommittedChanges
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
  retired: boolean;
}

export interface TidyCommandData {
  repoRoot: string;
  baseBranch: string;
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

  const assessed: TidyWorktree[] = worktrees.map((record) =>
    assessWorktree({ record, repoRoot, baseBranch, controlWorktree, here })
  );

  const claimedByWorktree = new Set(
    assessed.map((entry) => entry.branch).filter((branch): branch is string => branch !== null)
  );

  const branches = assessBranches({ repoRoot, baseBranch, claimedByWorktree, includeOwn: options.includeOwnBranches });

  if (options.apply) {
    for (const entry of assessed) {
      if (entry.verdict === "merged" || entry.verdict === "missing" || entry.verdict === "detached") {
        entry.retired = retireWorktree(repoRoot, entry, baseBranch);
      }
    }
    for (const entry of branches) {
      if (entry.verdict === "merged") {
        // `-d` and not `-D`: git refuses to delete an unmerged branch on its
        // own, so the ancestry check above and git's own check must both agree
        // before a ref disappears.
        entry.retired = tryGit(repoRoot, ["branch", "-d", entry.branch]) !== null;
      }
    }
  }

  return createSuccess({
    command: "tidy",
    data: {
      repoRoot,
      baseBranch,
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
  baseBranch: string;
  controlWorktree: string;
  here: string;
}): TidyWorktree {
  const { record, repoRoot, baseBranch, controlWorktree, here } = input;
  const branch = shortBranch(record.branch);
  const base: Omit<TidyWorktree, "verdict" | "reason"> = {
    path: record.path,
    branch,
    ahead: 0,
    pushed: false,
    uncommitted: [],
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
  if (branch === baseBranch) {
    return { ...base, verdict: "protected", reason: `Holds the base branch ${baseBranch}.` };
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
    const reachable = isAncestor(record.path, record.head, baseBranch);
    return reachable
      ? { ...base, verdict: "detached", reason: "Detached at a commit the base branch already contains." }
      : {
          ...base,
          verdict: "unmerged",
          reason: `Detached at ${record.head.slice(0, 8)}, which ${baseBranch} does not contain. Name a branch for it before it can be retired.`
        };
  }

  const ahead = countCommits(record.path, baseBranch, branch);
  const pushed = hasUpstream(record.path, branch);

  if (ahead === 0 && isAncestor(record.path, branch, baseBranch)) {
    return {
      ...base,
      pushed,
      verdict: "merged",
      reason: `Every commit on ${branch} is already on ${baseBranch}.`
    };
  }

  return {
    ...base,
    ahead,
    pushed,
    verdict: "unmerged",
    reason: `${ahead} commit${ahead === 1 ? "" : "s"} on ${branch} ${ahead === 1 ? "is" : "are"} not on ${baseBranch}${pushed ? "; a remote copy exists" : "; no remote copy exists"}.`
  };
}

function assessBranches(input: {
  repoRoot: string;
  baseBranch: string;
  claimedByWorktree: Set<string>;
  includeOwn?: boolean;
}): TidyBranch[] {
  const { repoRoot, baseBranch, claimedByWorktree, includeOwn } = input;

  return git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((branch) => branch !== baseBranch)
    // A branch checked out somewhere is that worktree's business; deleting the
    // ref out from under it is how a worktree ends up detached and confusing.
    .filter((branch) => !claimedByWorktree.has(branch) && !claimedByWorktree.has(`refs/heads/${branch}`))
    .map((branch) => {
      const agentOwned = SAFE_TASK_BRANCH.test(branch);
      const pushed = hasUpstream(repoRoot, branch);
      const merged = refExists(repoRoot, `refs/heads/${branch}`) && isAncestor(repoRoot, branch, baseBranch);
      const ahead = merged ? 0 : countCommits(repoRoot, baseBranch, branch);

      if (!merged) {
        return {
          branch,
          verdict: "unmerged" as const,
          ahead,
          pushed,
          agentOwned,
          retired: false,
          reason: `${ahead} commit${ahead === 1 ? "" : "s"} not on ${baseBranch}${pushed ? "; a remote copy exists" : "; NO remote copy"}.`
        };
      }

      if (!agentOwned && !includeOwn) {
        return {
          branch,
          verdict: "protected" as const,
          ahead: 0,
          pushed,
          agentOwned,
          retired: false,
          reason: `Fully merged into ${baseBranch}, but not an agent-owned name. Pass --include-own-branches to retire it too.`
        };
      }

      return {
        branch,
        verdict: "merged" as const,
        ahead: 0,
        pushed,
        agentOwned,
        retired: false,
        reason: `Fully merged into ${baseBranch}; deleting the ref loses no commit.`
      };
    });
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
  const { repoRoot, baseBranch, applied, worktrees, branches, needsAttention } = response.data;
  const lines: string[] = [
    `Arcadia Tidy — ${repoRoot}`,
    `Base branch: ${baseBranch}`,
    ""
  ];

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
