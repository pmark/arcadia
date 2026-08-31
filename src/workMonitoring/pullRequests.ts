import { existsSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { WorkMonitorProject } from "./types.js";

export const PULL_REQUEST_READINESS = [
  "blocked",
  "checks_failing",
  "checks_pending",
  "draft",
  "ready",
  "merge_ready",
  "unknown"
] as const;
export type PullRequestReadiness = (typeof PULL_REQUEST_READINESS)[number];

export interface PullRequestCheck {
  name: string;
  status: string | null;
  conclusion: string | null;
  url: string | null;
}

export interface OutstandingPullRequest {
  projectId: string;
  projectName: string;
  repositoryPath: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN";
  isDraft: boolean;
  mergeStateStatus: string | null;
  headBranch: string;
  baseBranch: string;
  author: string | null;
  reviewDecision: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  checks: PullRequestCheck[];
  readiness: PullRequestReadiness;
  readinessLabel: string;
  summary: string;
  briefing: PullRequestBriefing | null;
}

export interface PullRequestBriefing {
  changedFiles: string[];
  unmentionedFiles: string[];
  decisionFiles: string[];
  materialFacts: string[];
  basePullRequest: { number: number; title: string; headBranch: string } | null;
}

export interface PullRequestDetails {
  body: string;
  files: string[];
}

export interface PullRequestProjectError {
  projectId: string;
  projectName: string;
  repositoryPath: string | null;
  message: string;
}

export interface OutstandingPullRequestsSnapshot {
  generatedAt: string;
  projectsScanned: number;
  pullRequests: OutstandingPullRequest[];
  errors: PullRequestProjectError[];
  counts: {
    total: number;
    blocked: number;
    checksFailing: number;
    checksPending: number;
    drafts: number;
    ready: number;
    mergeReady: number;
    unknown: number;
  };
}

interface RawPullRequest {
  number?: unknown;
  title?: unknown;
  url?: unknown;
  state?: unknown;
  isDraft?: unknown;
  mergeStateStatus?: unknown;
  headRefName?: unknown;
  baseRefName?: unknown;
  author?: { login?: unknown } | null;
  reviewDecision?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  statusCheckRollup?: Array<{
    name?: unknown;
    status?: unknown;
    conclusion?: unknown;
    detailsUrl?: unknown;
  }> | null;
}

interface RawPullRequestDetails {
  body?: unknown;
  files?: Array<{ path?: unknown }> | null;
}

interface PullRequestScanOptions {
  now?: Date;
  runCommand?: (cwd: string, command: string, args: string[]) => CommandResult;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const READINESS_LABELS: Record<PullRequestReadiness, string> = {
  blocked: "BLOCKED",
  checks_failing: "CHECKS FAILING",
  checks_pending: "CHECKS PENDING",
  draft: "DRAFT",
  ready: "READY FOR REVIEW",
  merge_ready: "MERGE-READY",
  unknown: "UNKNOWN"
};

export function listOutstandingPullRequests(
  projects: WorkMonitorProject[],
  options: PullRequestScanOptions = {}
): OutstandingPullRequestsSnapshot {
  const runCommand = options.runCommand ?? run;
  const pullRequests: OutstandingPullRequest[] = [];
  const errors: PullRequestProjectError[] = [];
  const seenRepositories = new Set<string>();
  const detailsByPullRequest = new Map<string, PullRequestDetails>();

  for (const project of projects) {
    const configuredPath = project.repositoryPath?.trim() || null;
    if (!configuredPath) {
      errors.push(projectError(project, null, "No repository path is configured."));
      continue;
    }
    if (!existsSync(configuredPath) || !statSync(configuredPath).isDirectory()) {
      errors.push(projectError(project, configuredPath, `Repository path is missing: ${configuredPath}`));
      continue;
    }

    const repositoryPath = realpathSync(configuredPath);
    if (!runCommand(repositoryPath, "git", ["rev-parse", "--is-inside-work-tree"]).ok) {
      errors.push(projectError(project, repositoryPath, `Configured path is not a Git working copy: ${repositoryPath}`));
      continue;
    }
    if (seenRepositories.has(repositoryPath)) continue;
    seenRepositories.add(repositoryPath);

    const repositoryResult = runCommand(repositoryPath, "gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
    const repository = repositoryResult.ok ? repositoryResult.stdout.trim() : "";
    if (!repository) {
      errors.push(projectError(project, repositoryPath, repositoryResult.stderr.trim() || "GitHub repository could not be identified."));
      continue;
    }

    const result = runCommand(repositoryPath, "gh", [
      "pr", "list", "--repo", repository, "--state", "open", "--limit", "1000",
      "--json", "number,title,url,state,isDraft,mergeStateStatus,headRefName,baseRefName,author,reviewDecision,createdAt,updatedAt,statusCheckRollup"
    ]);
    if (!result.ok) {
      errors.push(projectError(project, repositoryPath, result.stderr.trim() || "Open pull requests could not be read."));
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(result.stdout);
    } catch {
      errors.push(projectError(project, repositoryPath, "GitHub returned invalid pull-request data."));
      continue;
    }
    if (!Array.isArray(raw)) {
      errors.push(projectError(project, repositoryPath, "GitHub returned an unexpected pull-request response."));
      continue;
    }

    for (const item of raw) {
      const pullRequest = normalizePullRequest(project, repositoryPath, repository, item as RawPullRequest);
      if (pullRequest) {
        pullRequests.push(pullRequest);
        const details = readPullRequestDetails(repositoryPath, repository, pullRequest.number, runCommand);
        if (details) detailsByPullRequest.set(pullRequestKey(pullRequest), details);
      }
    }
  }

  const sorted = pullRequests.sort((a, b) =>
    readinessRank(a.readiness) - readinessRank(b.readiness) ||
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
    a.projectName.localeCompare(b.projectName) ||
    a.number - b.number
  );

  const openPullRequestsByBranch = new Map(sorted.map((pullRequest) => [
    `${pullRequest.repository}:${pullRequest.headBranch}`,
    pullRequest
  ]));
  const decisionFilesByPullRequest = new Map(
    [...detailsByPullRequest.entries()].map(([key, details]) => [
      key,
      details.files.filter((file) => /^docs\/decisions\/\d{4}-/i.test(file))
    ])
  );
  for (const pullRequest of sorted) {
    const details = detailsByPullRequest.get(pullRequestKey(pullRequest));
    pullRequest.briefing = details
      ? buildPullRequestBriefing(pullRequest, details, openPullRequestsByBranch, decisionFilesByPullRequest)
      : null;
  }

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    projectsScanned: projects.length,
    pullRequests: sorted,
    errors,
    counts: {
      total: sorted.length,
      blocked: sorted.filter((item) => item.readiness === "blocked").length,
      checksFailing: sorted.filter((item) => item.readiness === "checks_failing").length,
      checksPending: sorted.filter((item) => item.readiness === "checks_pending").length,
      drafts: sorted.filter((item) => item.readiness === "draft").length,
      ready: sorted.filter((item) => item.readiness === "ready").length,
      mergeReady: sorted.filter((item) => item.readiness === "merge_ready").length,
      unknown: sorted.filter((item) => item.readiness === "unknown").length
    }
  };
}

export function normalizePullRequest(
  project: WorkMonitorProject,
  repositoryPath: string,
  repository: string,
  raw: RawPullRequest
): OutstandingPullRequest | null {
  const number = typeof raw.number === "number" ? raw.number : Number(raw.number);
  const title = stringValue(raw.title);
  const url = stringValue(raw.url);
  if (!Number.isFinite(number) || !title || !url) return null;

  const checks = (raw.statusCheckRollup ?? []).map((check) => ({
    name: stringValue(check.name) ?? "Unnamed check",
    status: stringValue(check.status),
    conclusion: stringValue(check.conclusion),
    url: stringValue(check.detailsUrl)
  }));
  const isDraft = raw.isDraft === true;
  const mergeStateStatus = stringValue(raw.mergeStateStatus);
  const reviewDecision = stringValue(raw.reviewDecision);
  const readiness = derivePullRequestReadiness({ isDraft, mergeStateStatus, reviewDecision, checks });

  return {
    projectId: project.id,
    projectName: project.name,
    repositoryPath,
    repository,
    number,
    title,
    url,
    state: "OPEN",
    isDraft,
    mergeStateStatus,
    headBranch: stringValue(raw.headRefName) ?? "unknown",
    baseBranch: stringValue(raw.baseRefName) ?? "main",
    author: raw.author ? stringValue(raw.author.login) : null,
    reviewDecision,
    createdAt: stringValue(raw.createdAt),
    updatedAt: stringValue(raw.updatedAt),
    checks,
    readiness,
    readinessLabel: READINESS_LABELS[readiness],
    summary: pullRequestSummary(readiness, checks, reviewDecision),
    briefing: null
  };
}

export function buildPullRequestBriefing(
  pullRequest: OutstandingPullRequest,
  details: PullRequestDetails,
  openPullRequestsByBranch: Map<string, OutstandingPullRequest>,
  decisionFilesByPullRequest: Map<string, string[]> = new Map()
): PullRequestBriefing {
  const changedFiles = [...new Set(details.files)].sort();
  const body = details.body.toLocaleLowerCase();
  const unmentionedFiles = changedFiles.filter((file) => {
    const normalized = file.toLocaleLowerCase();
    const basename = normalized.split("/").pop() ?? normalized;
    return !body.includes(normalized) && !body.includes(basename);
  });
  const decisionFiles = changedFiles.filter((file) => /^docs\/decisions\/\d{4}-/i.test(file));
  const pointerFiles = changedFiles.filter((file) => file === "PROJECT.md" || /^docs\/plans\/.*\.md$/i.test(file));
  const schemaFiles = changedFiles.filter((file) => file === "src/db/schema.ts" || /(^|\/)migrations?\//i.test(file));
  const outwardFiles = changedFiles.filter((file) => /(^|\/)(discord|email|deploy|publish|webhook|notifications?)\b/i.test(file));
  const basePullRequest = openPullRequestsByBranch.get(`${pullRequest.repository}:${pullRequest.baseBranch}`);
  const decisionCollisions = decisionFiles.filter((file) => [...openPullRequestsByBranch.values()].some((other) =>
    other.number !== pullRequest.number && other.repository === pullRequest.repository &&
    (decisionFilesByPullRequest.get(pullRequestKey(other))?.includes(file) ?? false)
  ));
  const materialFacts: string[] = [];
  if (basePullRequest) materialFacts.push(`Base branch ${pullRequest.baseBranch} is another open PR (#${basePullRequest.number}).`);
  if (pointerFiles.length > 0) materialFacts.push(`Touches managed pointer or plan files (${pointerFiles.length}).`);
  if (decisionFiles.length > 0) materialFacts.push(`Adds or changes ${decisionFiles.length} governed Decision document${decisionFiles.length === 1 ? "" : "s"}.`);
  if (schemaFiles.length > 0) materialFacts.push(`Changes database schema or migration files (${schemaFiles.length}).`);
  if (outwardFiles.length > 0) materialFacts.push(`Touches outward-facing behavior (${outwardFiles.length} path${outwardFiles.length === 1 ? "" : "s"}).`);
  if (unmentionedFiles.length > 0) materialFacts.push(`${unmentionedFiles.length} changed file${unmentionedFiles.length === 1 ? " is" : "s are"} not named in the PR body.`);
  if (decisionCollisions.length > 0) materialFacts.push(`Decision documents overlap another open PR (${decisionCollisions.length}).`);
  const ciConclusion = pullRequest.checks.length === 0
    ? "no checks reported"
    : pullRequest.checks.map((check) => `${check.name}: ${check.conclusion ?? check.status ?? "unknown"}`).join(", ");
  materialFacts.push(`CI checks: ${ciConclusion}.`);
  return { changedFiles, unmentionedFiles, decisionFiles, materialFacts, basePullRequest: basePullRequest ? {
    number: basePullRequest.number,
    title: basePullRequest.title,
    headBranch: basePullRequest.headBranch
  } : null };
}

export function derivePullRequestReadiness(input: {
  isDraft: boolean;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  checks: PullRequestCheck[];
}): PullRequestReadiness {
  const mergeState = input.mergeStateStatus?.toUpperCase();
  const reviewDecision = input.reviewDecision?.toUpperCase();
  const failing = input.checks.some((check) => ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "ERROR"].includes(check.conclusion?.toUpperCase() ?? ""));
  const pending = input.checks.some((check) => check.status?.toUpperCase() !== "COMPLETED" || !check.conclusion);
  if (mergeState === "DIRTY" || mergeState === "BLOCKED" || reviewDecision === "CHANGES_REQUESTED") return "blocked";
  if (failing) return "checks_failing";
  if (input.isDraft) return "draft";
  if (pending) return "checks_pending";
  if (mergeState === "CLEAN" || mergeState === "HAS_HOOKS") {
    return reviewDecision === "APPROVED" ? "merge_ready" : "ready";
  }
  return "unknown";
}

function pullRequestSummary(
  readiness: PullRequestReadiness,
  checks: PullRequestCheck[],
  reviewDecision: string | null
): string {
  if (readiness === "blocked") return "Needs conflict, policy, or review-request resolution.";
  if (readiness === "checks_failing") return `${checks.filter((check) => check.conclusion && check.conclusion.toUpperCase() !== "SUCCESS").length} check(s) need attention.`;
  if (readiness === "checks_pending") return "Validation is still running or has not reported.";
  if (readiness === "draft") return "Draft work is preserved but not yet ready for review.";
  if (readiness === "merge_ready") return "Approved with passing checks and a clean merge state.";
  if (readiness === "ready") return reviewDecision === "REVIEW_REQUIRED" ? "Passing checks; waiting for review." : "Passing checks; ready for review.";
  return "GitHub did not provide enough state to rate readiness.";
}

function readinessRank(readiness: PullRequestReadiness): number {
  return { blocked: 0, checks_failing: 1, checks_pending: 2, draft: 3, ready: 4, merge_ready: 5, unknown: 6 }[readiness];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pullRequestKey(pullRequest: Pick<OutstandingPullRequest, "repository" | "number">): string {
  return `${pullRequest.repository}#${pullRequest.number}`;
}

function readPullRequestDetails(
  cwd: string,
  repository: string,
  number: number,
  runCommand: (cwd: string, command: string, args: string[]) => CommandResult
): PullRequestDetails | null {
  const result = runCommand(cwd, "gh", ["pr", "view", String(number), "--repo", repository, "--json", "body,files"]);
  if (!result.ok) return null;
  try {
    const raw = JSON.parse(result.stdout) as RawPullRequestDetails;
    return {
      body: typeof raw.body === "string" ? raw.body : "",
      files: (raw.files ?? []).map((file) => stringValue(file.path)).filter((file): file is string => Boolean(file))
    };
  } catch {
    return null;
  }
}

function projectError(project: WorkMonitorProject, repositoryPath: string | null, message: string): PullRequestProjectError {
  return { projectId: project.id, projectName: project.name, repositoryPath, message };
}

function run(cwd: string, command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? ""
  };
}
