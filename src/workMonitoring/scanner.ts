import { existsSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type {
  DeliveryState,
  LandedRepositoryWork,
  PreservationState,
  PullRequestSnapshot,
  RepositoryWorkingCopyAssessment,
  WorkMonitorProject,
  WorkMonitorSnapshot,
  WorkingCopyAssessment,
  WorkingCopyChanges
} from "./types.js";

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface WorkMonitorScanOptions {
  includePullRequests?: boolean;
  now?: Date;
}

interface WorktreeRecord {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
}

interface RevisionFacts {
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  commitsNotInBase: number;
  remoteBranchExists: boolean;
  lastCommitSubject: string | null;
  lastCommitAt: string | null;
}

const SAFETY_LABELS: Record<PreservationState, string> = {
  unsaved: "UNSAVED",
  local_only: "LOCAL ONLY",
  pushed: "PUSHED, NO PR",
  in_pr: "IN PR",
  landed: "LANDED"
};

const DELIVERY_LABELS: Record<DeliveryState, string> = {
  working: "WORKING",
  needs_preservation: "NEEDS PRESERVATION",
  needs_pr: "NEEDS PR",
  draft: "DRAFT",
  reviewable: "REVIEWABLE",
  merge_ready: "MERGE-READY",
  blocked: "BLOCKED",
  landed: "LANDED",
  unknown: "UNKNOWN"
};

/**
 * Read-only, deterministic repository inspection. The scanner never fetches,
 * switches branches, stages files, or changes refs. GitHub lookup is optional
 * and degrades to local Git evidence when `gh` is unavailable.
 */
export function scanProjectWorkingCopies(
  projects: WorkMonitorProject[],
  options: WorkMonitorScanOptions = {}
): WorkMonitorSnapshot {
  const repositories = projects.map((project) => scanRepository(project, options));
  const copies = repositories.flatMap((repository) => repository.workingCopies);
  return {
    scannedAt: (options.now ?? new Date()).toISOString(),
    repositories,
    totals: {
      projects: repositories.length,
      workingCopies: copies.length,
      unsaved: copies.filter((copy) => copy.preservation === "unsaved").length,
      localOnly: copies.filter((copy) => copy.preservation === "local_only").length,
      pushedWithoutPr: copies.filter((copy) => copy.preservation === "pushed").length,
      pullRequestUnknown: copies.filter((copy) => copy.preservation === "pushed" && copy.pullRequestLookup !== "queried").length,
      inPr: copies.filter((copy) => copy.preservation === "in_pr").length,
      landed: copies.filter((copy) => copy.preservation === "landed").length,
      configurationErrors: repositories.filter((repository) => repository.error !== null).length
    }
  };
}

export function formatWorkingCopySafetyLines(snapshot: WorkMonitorSnapshot, limit = 6): string[] {
  const riskOrder: Record<PreservationState, number> = {
    unsaved: 0,
    local_only: 1,
    pushed: 2,
    in_pr: 3,
    landed: 4
  };
  const errors = snapshot.repositories
    .filter((repository) => repository.error)
    .map((repository) => `${repository.projectName}: ${repository.error}`);
  const attention = snapshot.repositories
    .flatMap((repository) => repository.workingCopies)
    .filter((copy) => copy.preservation !== "landed" && (copy.preservation !== "in_pr" || copy.delivery === "blocked"))
    .sort((a, b) => riskOrder[a.preservation] - riskOrder[b.preservation] || a.projectName.localeCompare(b.projectName))
    .map((copy) => {
      const identity = copy.branch ?? "detached HEAD";
      const preservationLabel = copy.preservation === "pushed" && copy.pullRequestLookup !== "queried"
        ? "PUSHED, PR UNKNOWN"
        : SAFETY_LABELS[copy.preservation];
      return `${copy.projectName} / ${identity} — ${copy.summary} Preservation: ${preservationLabel}; delivery: ${DELIVERY_LABELS[copy.delivery]}.`;
    });
  return [...errors, ...attention].slice(0, limit);
}

/**
 * Read work that actually landed on each repository's locally known default
 * branch in a half-open time window. First-parent history reports the commits
 * integrated into the branch without repeating every commit inside a merged
 * topic branch.
 */
export function listLandedRepositoryWork(
  snapshot: WorkMonitorSnapshot,
  window: { start: string; end: string }
): LandedRepositoryWork[] {
  const startAt = new Date(window.start).getTime();
  const endAt = new Date(window.end).getTime();
  const landed = new Map<string, LandedRepositoryWork>();

  for (const repository of snapshot.repositories) {
    if (!repository.repositoryPath || !repository.baseRef) continue;
    const refs = [repository.baseRef];
    if (repository.baseRef.startsWith("origin/")) refs.push(repository.baseRef.slice("origin/".length));

    for (const ref of refs) {
      if (!run(repository.repositoryPath, "git", ["rev-parse", "--verify", "--quiet", ref]).ok) continue;
      const result = run(repository.repositoryPath, "git", [
        "log",
        "--first-parent",
        `--since=${window.start}`,
        `--until=${window.end}`,
        "--format=%x1e%H%x1f%cI%x1f%P%x1f%s%x1f%b",
        ref
      ]);
      if (!result.ok) continue;

      for (const record of result.stdout.split("\x1e").map((value) => value.trim()).filter(Boolean)) {
        const [sha, committedAt, parents, subject, ...bodyParts] = record.split("\x1f");
        if (!sha || !committedAt || !subject) continue;
        const committedTime = new Date(committedAt).getTime();
        if (!Number.isFinite(committedTime) || committedTime < startAt || committedTime >= endAt) continue;
        const key = `${repository.projectId}:${sha}`;
        landed.set(key, {
          projectId: repository.projectId,
          projectName: repository.projectName,
          sha,
          summary: landedCommitSummary(subject.trim(), bodyParts.join("\x1f"), parents ?? ""),
          committedAt
        });
      }
    }
  }

  return [...landed.values()].sort((a, b) => b.committedAt.localeCompare(a.committedAt) || a.sha.localeCompare(b.sha));
}

function landedCommitSummary(subject: string, body: string, parents: string): string {
  const mergeTitle = body.split("\n").map((line) => line.trim()).find(Boolean);
  const pullRequest = subject.match(/^Merge pull request #(\d+)\b/i);
  if (pullRequest && mergeTitle) return `Merged PR #${pullRequest[1]}: ${mergeTitle}`;
  if (parents.trim().split(/\s+/).filter(Boolean).length > 1 && mergeTitle) return `Merged: ${mergeTitle}`;
  return subject;
}

function scanRepository(
  project: WorkMonitorProject,
  options: WorkMonitorScanOptions
): RepositoryWorkingCopyAssessment {
  const configuredPath = project.repositoryPath?.trim() || null;
  if (!configuredPath) {
    return repositoryError(project, "No repository path is configured.");
  }
  if (!existsSync(configuredPath) || !statSync(configuredPath).isDirectory()) {
    return repositoryError(project, `Repository path is missing: ${configuredPath}`);
  }

  const repositoryPath = realpathSync(configuredPath);
  if (!run(repositoryPath, "git", ["rev-parse", "--is-inside-work-tree"]).ok) {
    return repositoryError(project, `Configured path is not a Git working copy: ${repositoryPath}`);
  }

  const baseRef = resolveBaseRef(repositoryPath);
  const ghRepository = options.includePullRequests === false ? null : resolveGitHubRepository(repositoryPath);
  const pullRequestLookup = options.includePullRequests === false ? "disabled" : ghRepository ? "queried" : "unavailable";
  const worktrees = parseWorktrees(run(repositoryPath, "git", ["worktree", "list", "--porcelain"]).stdout);
  const checkedOutBranches = new Set(worktrees.flatMap((worktree) => (worktree.branch ? [worktree.branch] : [])));
  const assessments = worktrees.map((worktree) =>
    assessWorkingCopy(project, repositoryPath, baseRef, worktree, ghRepository, pullRequestLookup)
  );

  for (const branch of listLocalBranches(repositoryPath)) {
    if (checkedOutBranches.has(branch)) continue;
    const revision = revisionFacts(repositoryPath, branch, branch, baseRef);
    if (revision.commitsNotInBase === 0 && (revision.ahead ?? 0) === 0) continue;
    assessments.push(
      assessUnattachedBranch(project, repositoryPath, baseRef, branch, revision, ghRepository, pullRequestLookup)
    );
  }

  return {
    projectId: project.id,
    projectName: project.name,
    repositoryPath,
    baseRef,
    workingCopies: assessments,
    error: null
  };
}

function assessWorkingCopy(
  project: WorkMonitorProject,
  repositoryPath: string,
  baseRef: string,
  worktree: WorktreeRecord,
  ghRepository: string | null,
  pullRequestLookup: WorkingCopyAssessment["pullRequestLookup"]
): WorkingCopyAssessment {
  const changes = readChanges(worktree.path);
  const revision = revisionFacts(worktree.path, "HEAD", worktree.branch, baseRef);
  const committedPaths = revision.commitsNotInBase > 0 ? changedPaths(worktree.path, baseRef, "HEAD") : [];
  const contextPaths = [...new Set([...changes.paths, ...committedPaths])];
  changes.paths = contextPaths;
  changes.areas = summarizeAreas(contextPaths);
  const pullRequest = worktree.branch && ghRepository && revision.commitsNotInBase > 0
    ? findPullRequest(worktree.path, ghRepository, worktree.branch)
    : null;
  return assembleAssessment({
    project,
    repositoryPath,
    worktreePath: worktree.path,
    branch: worktree.branch,
    detached: worktree.detached,
    head: worktree.head,
    baseRef,
    changes,
    revision,
    pullRequest,
    pullRequestLookup
  });
}

function assessUnattachedBranch(
  project: WorkMonitorProject,
  repositoryPath: string,
  baseRef: string,
  branch: string,
  revision: RevisionFacts,
  ghRepository: string | null,
  pullRequestLookup: WorkingCopyAssessment["pullRequestLookup"]
): WorkingCopyAssessment {
  const committedPaths = changedPaths(repositoryPath, baseRef, branch);
  const changes: WorkingCopyChanges = {
    total: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    paths: committedPaths,
    areas: summarizeAreas(committedPaths)
  };
  const head = run(repositoryPath, "git", ["rev-parse", branch]).stdout.trim();
  const pullRequest = ghRepository ? findPullRequest(repositoryPath, ghRepository, branch) : null;
  return assembleAssessment({
    project,
    repositoryPath,
    worktreePath: null,
    branch,
    detached: false,
    head,
    baseRef,
    changes,
    revision,
    pullRequest,
    pullRequestLookup
  });
}

function assembleAssessment(input: {
  project: WorkMonitorProject;
  repositoryPath: string;
  worktreePath: string | null;
  branch: string | null;
  detached: boolean;
  head: string;
  baseRef: string;
  changes: WorkingCopyChanges;
  revision: RevisionFacts;
  pullRequest: PullRequestSnapshot | null;
  pullRequestLookup: WorkingCopyAssessment["pullRequestLookup"];
}): WorkingCopyAssessment {
  const preservation = preservationState(input.changes, input.revision, input.pullRequest);
  const delivery = deliveryState(preservation, input.pullRequest);
  return {
    projectId: input.project.id,
    projectName: input.project.name,
    repositoryPath: input.repositoryPath,
    worktreePath: input.worktreePath,
    branch: input.branch,
    detached: input.detached,
    head: input.head,
    baseRef: input.baseRef,
    upstream: input.revision.upstream,
    aheadOfUpstream: input.revision.ahead,
    behindUpstream: input.revision.behind,
    commitsNotInBase: input.revision.commitsNotInBase,
    remoteBranchExists: input.revision.remoteBranchExists,
    changes: input.changes,
    pullRequest: input.pullRequest,
    pullRequestLookup: input.pullRequestLookup,
    preservation,
    delivery,
    summary: summary(input.changes, input.revision, input.pullRequest, input.pullRequestLookup, input.detached),
    recommendedAction: recommendedAction(preservation, input.branch, input.worktreePath, input.pullRequestLookup),
    lastCommitSubject: input.revision.lastCommitSubject,
    lastCommitAt: input.revision.lastCommitAt
  };
}

function preservationState(
  changes: WorkingCopyChanges,
  revision: RevisionFacts,
  pullRequest: PullRequestSnapshot | null
): PreservationState {
  if (changes.total > 0) return "unsaved";
  if (revision.commitsNotInBase === 0) return "landed";
  if (pullRequest?.state.toUpperCase() === "MERGED") return "landed";
  if ((revision.ahead ?? 0) > 0 || (!revision.upstream && revision.commitsNotInBase > 0)) return "local_only";
  if (pullRequest?.state.toUpperCase() === "OPEN") return "in_pr";
  if (revision.commitsNotInBase > 0 && revision.remoteBranchExists) return "pushed";
  return "landed";
}

function deliveryState(preservation: PreservationState, pullRequest: PullRequestSnapshot | null): DeliveryState {
  if (preservation === "unsaved") return "working";
  if (preservation === "local_only") return "needs_preservation";
  if (preservation === "pushed") return "needs_pr";
  if (preservation === "landed") return "landed";
  if (!pullRequest) return "unknown";
  const mergeState = pullRequest.mergeStateStatus?.toUpperCase();
  if (mergeState === "DIRTY" || mergeState === "BLOCKED") return "blocked";
  if (pullRequest.isDraft) return "draft";
  if (mergeState === "CLEAN" || mergeState === "HAS_HOOKS") return "merge_ready";
  return "reviewable";
}

function summary(
  changes: WorkingCopyChanges,
  revision: RevisionFacts,
  pullRequest: PullRequestSnapshot | null,
  pullRequestLookup: WorkingCopyAssessment["pullRequestLookup"],
  detached: boolean
): string {
  const area = changes.areas.length > 0 ? ` across ${naturalList(changes.areas)}` : "";
  if (changes.total > 0) {
    const detail = [
      changes.staged ? `${changes.staged} staged` : null,
      changes.unstaged ? `${changes.unstaged} unstaged` : null,
      changes.untracked ? `${changes.untracked} untracked` : null
    ].filter(Boolean).join(", ");
    return `${changes.total} uncommitted path${changes.total === 1 ? "" : "s"}${area}${detail ? ` (${detail})` : ""}.${detached ? " The worktree is detached." : ""}`;
  }
  if (pullRequest?.state.toUpperCase() === "MERGED") {
    return `PR #${pullRequest.number} is merged; no unique or uncommitted work remains.`;
  }
  if ((revision.ahead ?? 0) > 0) {
    return `${revision.ahead} local commit${revision.ahead === 1 ? "" : "s"} not pushed${area}.`;
  }
  if (!revision.upstream && revision.commitsNotInBase > 0) {
    return `${revision.commitsNotInBase} commit${revision.commitsNotInBase === 1 ? " is" : "s are"} not protected by an upstream branch${area}.`;
  }
  if (pullRequest?.state.toUpperCase() === "OPEN") {
    return `${pullRequest.isDraft ? "Draft" : "PR"} #${pullRequest.number}: ${pullRequest.title}.`;
  }
  if (revision.commitsNotInBase > 0) {
    if (pullRequestLookup === "queried") {
      return `${revision.commitsNotInBase} pushed commit${revision.commitsNotInBase === 1 ? " has" : "s have"} no open PR${area}.`;
    }
    return `${revision.commitsNotInBase} pushed commit${revision.commitsNotInBase === 1 ? " is" : "s are"} remote-backed; PR state is ${pullRequestLookup === "disabled" ? "not checked" : "unavailable"}${area}.`;
  }
  return "No unique or uncommitted work remains.";
}

function recommendedAction(
  preservation: PreservationState,
  branch: string | null,
  worktreePath: string | null,
  pullRequestLookup: WorkingCopyAssessment["pullRequestLookup"]
): string | null {
  if (preservation === "unsaved") {
    return branch
      ? `Review and commit the changes on ${branch}, then push the branch and open a draft PR.`
      : `Create a branch for the detached worktree${worktreePath ? ` at ${worktreePath}` : ""}, commit intentionally, then push and open a draft PR.`;
  }
  if (preservation === "local_only") return `Push ${branch ?? "the recovered branch"} and open a draft PR.`;
  if (preservation === "pushed") {
    return pullRequestLookup === "queried"
      ? `Open a draft PR for ${branch ?? "the pushed branch"}.`
      : `Check whether ${branch ?? "the pushed branch"} has a PR; open a draft PR if it does not.`;
  }
  return null;
}

function revisionFacts(cwd: string, revision: string, branch: string | null, baseRef: string): RevisionFacts {
  const upstreamResult = revision === "HEAD" || branch
    ? run(cwd, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${revision}@{upstream}`])
    : { ok: false, stdout: "", stderr: "" };
  const upstream = upstreamResult.ok ? upstreamResult.stdout.trim() : null;
  let ahead: number | null = null;
  let behind: number | null = null;
  if (upstream) {
    const counts = run(cwd, "git", ["rev-list", "--left-right", "--count", `${revision}...${upstream}`]);
    if (counts.ok) {
      const [left, right] = counts.stdout.trim().split(/\s+/).map(Number);
      ahead = Number.isFinite(left) ? left : null;
      behind = Number.isFinite(right) ? right : null;
    }
  }
  const unique = run(cwd, "git", ["rev-list", "--count", `${baseRef}..${revision}`]);
  const remoteBranchExists = Boolean(branch) && run(cwd, "git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`]).ok;
  const log = run(cwd, "git", ["log", "-1", "--format=%s%x00%cI", revision]);
  const [lastCommitSubject, lastCommitAt] = log.ok ? log.stdout.trim().split("\0") : [];
  return {
    upstream,
    ahead,
    behind,
    commitsNotInBase: unique.ok ? Number(unique.stdout.trim()) || 0 : 0,
    remoteBranchExists,
    lastCommitSubject: lastCommitSubject || null,
    lastCommitAt: lastCommitAt || null
  };
}

function readChanges(cwd: string): WorkingCopyChanges {
  const result = run(cwd, "git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!result.ok || !result.stdout) return emptyChanges();
  const records = result.stdout.split("\0").filter(Boolean);
  const paths: string[] = [];
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const record of records) {
    if (record.length < 4) continue;
    const indexState = record[0];
    const worktreeState = record[1];
    if (indexState === "?" && worktreeState === "?") untracked += 1;
    else {
      if (indexState !== " ") staged += 1;
      if (worktreeState !== " ") unstaged += 1;
    }
    paths.push(record.slice(3));
  }
  return { total: paths.length, staged, unstaged, untracked, paths, areas: summarizeAreas(paths) };
}

function emptyChanges(): WorkingCopyChanges {
  return { total: 0, staged: 0, unstaged: 0, untracked: 0, paths: [], areas: [] };
}

function changedPaths(cwd: string, baseRef: string, revision: string): string[] {
  const result = run(cwd, "git", ["diff", "--name-only", `${baseRef}...${revision}`]);
  return result.ok ? result.stdout.split("\n").map((value) => value.trim()).filter(Boolean) : [];
}

function summarizeAreas(paths: string[]): string[] {
  const counts = new Map<string, number>();
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let area = "repository root";
    if (parts[0] === "apps" && parts[1]) area = `app ${parts[1]}`;
    else if (parts[0] === "src" && parts[1]) area = humanize(parts[1]);
    else if (parts[0] === "tests" || parts[0] === "test") area = "tests";
    else if (parts[0] === "docs") area = "documentation";
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([area]) => area);
}

function naturalList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").toLowerCase();
}

function resolveBaseRef(cwd: string): string {
  const remoteHead = run(cwd, "git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead.ok && remoteHead.stdout.trim()) return remoteHead.stdout.trim();
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (run(cwd, "git", ["rev-parse", "--verify", "--quiet", candidate]).ok) return candidate;
  }
  return "HEAD";
}

function parseWorktrees(output: string): WorktreeRecord[] {
  return output
    .trim()
    .split(/\n\n+/)
    .map((record) => {
      const fields = new Map<string, string>();
      let detached = false;
      for (const line of record.split("\n")) {
        if (line === "detached") detached = true;
        const space = line.indexOf(" ");
        if (space > 0) fields.set(line.slice(0, space), line.slice(space + 1));
      }
      const branchRef = fields.get("branch");
      return {
        path: fields.get("worktree") ?? "",
        head: fields.get("HEAD") ?? "",
        branch: branchRef?.replace(/^refs\/heads\//, "") ?? null,
        detached
      };
    })
    .filter((record) => record.path.length > 0);
}

function listLocalBranches(cwd: string): string[] {
  const result = run(cwd, "git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return result.ok ? result.stdout.split("\n").map((value) => value.trim()).filter(Boolean) : [];
}

function resolveGitHubRepository(cwd: string): string | null {
  const result = run(cwd, "gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  return result.ok ? result.stdout.trim() || null : null;
}

function findPullRequest(cwd: string, repository: string, branch: string): PullRequestSnapshot | null {
  const result = run(cwd, "gh", [
    "pr", "list", "--repo", repository, "--head", branch, "--state", "all", "--limit", "1",
    "--json", "number,title,url,state,isDraft,mergeStateStatus,updatedAt"
  ]);
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.stdout) as PullRequestSnapshot[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function repositoryError(project: WorkMonitorProject, error: string): RepositoryWorkingCopyAssessment {
  return {
    projectId: project.id,
    projectName: project.name,
    repositoryPath: project.repositoryPath,
    baseRef: null,
    workingCopies: [],
    error
  };
}

function run(cwd: string, command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? ""
  };
}
