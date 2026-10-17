import type Database from "better-sqlite3";
import { classifyAuthorityPaths, type AuthorityBoundary } from "../decisions/batchMerge.js";
import { computeBlastRadius } from "../stewardship/prBlastRadius.js";
import { git, isAncestor, tryGit } from "../git/worktrees.js";
import { classifyPullRequestChecks, runHostCommand, type PullRequestCheckRun, type QaPrReviewDependencies } from "../qa/prReview.js";
import type { VerdictGate } from "../sessions/roleLineage.js";

/**
 * The worker's automated review-and-merge (Decision 0097, Action
 * worker-review-and-merge): land a candidate on the governed base only by
 * merging its pull request on GitHub, pinned to the exact head an independent
 * review passed, and only when
 *
 * 1. the recorded independent code review and QA (the verdict gate) bind
 *    exactly the candidate head and neither has a blocking finding;
 * 2. GitHub reports that same head, the PR open and not a draft, every gating
 *    check on it green and the merge state CLEAN (branch protection's required
 *    checks satisfied); and
 * 3. the blast-radius assessment does not mark it authority-adjacent.
 *
 * Every unknown is a refusal with a named code (fail closed). The merge itself
 * is `gh pr merge <url> --merge --match-head-commit <head>`, so GitHub refuses
 * it too if the head moved after the last read; nothing here fast-forwards a
 * local branch into the base or pushes the base. Only after GitHub reports the
 * PR MERGED at that head does the local checkout move onto the remote base,
 * the same `--ff-only` sync the tick already runs every tick for an in-scope
 * Project (`detectBaseBranchAdvance`), so the next Action admits from the
 * merged main.
 *
 * Authority: this runs only when the Active production scope's Decision 0058
 * integration grant carries the opt-in `mergeThroughPullRequest: true`
 * (`production activate --integration-grant-merge-pull-request`, default
 * off, shown in `production status`). It creates no new authority of its own
 * and never merges an authority-adjacent PR: that PR is recorded with its
 * reason for the operator's batch-merge card instead.
 */

export type WorkerMergeRefusalCode =
  | "review_missing"
  | "review_stale_head"
  | "pull_request_missing"
  | "pull_request_unreadable"
  | "pull_request_not_open"
  | "head_moved"
  | "wrong_base"
  | "checks_unknown"
  | "checks_pending"
  | "check_failed"
  | "merge_state_not_clean"
  | "blast_radius_unknown"
  | "authority_adjacent"
  | "merge_failed"
  | "merge_unverified"
  | "base_not_synced";

export const WORKER_MERGE_REFUSAL_CODES: readonly WorkerMergeRefusalCode[] = [
  "review_missing",
  "review_stale_head",
  "pull_request_missing",
  "pull_request_unreadable",
  "pull_request_not_open",
  "head_moved",
  "wrong_base",
  "checks_unknown",
  "checks_pending",
  "check_failed",
  "merge_state_not_clean",
  "blast_radius_unknown",
  "authority_adjacent",
  "merge_failed",
  "merge_unverified",
  "base_not_synced"
];

/** What `gh pr view --json state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,statusCheckRollup` reports. */
export interface WorkerMergePullRequestView {
  state: string;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  baseRefName?: string;
  mergeStateStatus: string | null;
  statusCheckRollup: PullRequestCheckRun[];
}

/** The blast-radius assessment of one exact candidate head, as the worker merge reads it. */
export interface WorkerMergeBlastRadius {
  authorityAdjacent: boolean;
  /** Why it is authority-adjacent (empty when it is not). */
  reasons: string[];
  /** The shared batch-merge path classifier's boundaries for the agent's own changes. */
  boundaries: AuthorityBoundary[];
  touchedPaths: string[];
  linesChanged: number;
}

export interface WorkerMergeFacts {
  /** The settled candidate head the worker means to land. */
  expectedHead: string;
  /** The governed base branch the PR must target; anything else (a stacked or retargeted base) refuses. */
  baseBranch: string;
  /** The independent verdict gate; null when none was consulted (refused as missing). */
  review: VerdictGate | null;
  /** The PR's URL from the worker preservation receipt; null when the candidate has no PR. */
  pullRequestUrl: string | null;
  /** A fresh read of the PR; null when it could not be read. */
  pullRequest: WorkerMergePullRequestView | null;
  /** Why the read failed, when it did. */
  pullRequestReadError?: string | null;
  /** The blast-radius assessment of `expectedHead`; null when it could not be computed. */
  blastRadius: WorkerMergeBlastRadius | null;
}

export type WorkerMergeEvaluation =
  | { ok: true; head: string; pullRequestUrl: string }
  | { ok: false; code: WorkerMergeRefusalCode; reason: string };

const short = (sha: string) => sha.slice(0, 12);
const SHA_RE = /^[0-9a-f]{40,64}$/;

/**
 * The pure merge gate: every fact the worker needs, in a fixed order, each
 * unknown a named refusal. Never reads anything itself.
 */
export function evaluateWorkerMerge(facts: WorkerMergeFacts): WorkerMergeEvaluation {
  const head = facts.expectedHead;
  const refuse = (code: WorkerMergeRefusalCode, reason: string): WorkerMergeEvaluation => ({ ok: false, code, reason });
  if (!facts.review) return refuse("review_missing", `No independent review was recorded for ${short(head)}; the worker merges only an exact-head reviewed candidate.`);
  if (!facts.review.satisfied) {
    return refuse("review_missing", `No passing independent review of ${short(head)} is recorded: ${facts.review.reason}`);
  }
  if (facts.review.binding.targetHead !== head) {
    return refuse("review_stale_head", `The recorded independent review binds ${short(facts.review.binding.targetHead)}, not the candidate head ${short(head)}.`);
  }
  if (!facts.pullRequestUrl) return refuse("pull_request_missing", "The candidate has no host-created pull request, so it cannot be merged through one.");
  const pr = facts.pullRequest;
  if (!pr) {
    return refuse("pull_request_unreadable", `PR ${facts.pullRequestUrl} could not be read${facts.pullRequestReadError ? `: ${facts.pullRequestReadError}` : ""}.`);
  }
  if (typeof pr.state !== "string" || pr.state.toUpperCase() !== "OPEN" || pr.isDraft !== false) {
    return refuse("pull_request_not_open", `PR ${facts.pullRequestUrl} is ${String(pr.state)}${pr.isDraft ? " (draft)" : ""}, not an open ready PR.`);
  }
  if (typeof pr.headRefOid !== "string" || !SHA_RE.test(pr.headRefOid)) {
    return refuse("pull_request_unreadable", `PR ${facts.pullRequestUrl} reported no readable head commit.`);
  }
  if (typeof pr.baseRefName !== "string" || pr.baseRefName !== facts.baseBranch) {
    return refuse("wrong_base", `PR ${facts.pullRequestUrl} targets ${String(pr.baseRefName ?? "an unreported base")}, not the governed base ${facts.baseBranch}; the worker merges only into the governed base.`);
  }
  if (pr.headRefOid !== head) {
    return refuse("head_moved", `PR ${facts.pullRequestUrl} head ${short(pr.headRefOid)} is not the reviewed candidate head ${short(head)}; a moved head is never merged.`);
  }
  if (!facts.blastRadius) return refuse("blast_radius_unknown", `The blast radius of ${short(head)} could not be assessed; an unassessed candidate is never merged by the worker.`);
  if (facts.blastRadius.authorityAdjacent) {
    return refuse("authority_adjacent", `The blast-radius assessment marks ${short(head)} authority-adjacent: ${facts.blastRadius.reasons.join(" ")}`);
  }
  if (!Array.isArray(pr.statusCheckRollup)) return refuse("checks_unknown", `PR ${facts.pullRequestUrl} reported no readable checks.`);
  const checks = classifyPullRequestChecks(pr.statusCheckRollup);
  if (checks.state === "none") return refuse("checks_unknown", `No required check state is known on ${short(head)}: ${checks.blockers.join(" ")}`);
  if (checks.unknown.length > 0) return refuse("checks_unknown", `Check state on ${short(head)} is unreadable: ${checks.blockers.join(" ")}`);
  if (checks.state === "failed") return refuse("check_failed", `A check on ${short(head)} did not pass: ${checks.blockers.join(" ")}`);
  if (checks.state === "pending") return refuse("checks_pending", `Checks on ${short(head)} have not all finished: ${checks.blockers.join(" ")}`);
  const mergeState = typeof pr.mergeStateStatus === "string" ? pr.mergeStateStatus.toUpperCase() : "UNKNOWN";
  if (mergeState !== "CLEAN") {
    return refuse("merge_state_not_clean", `PR ${facts.pullRequestUrl} merge state is ${mergeState}, not CLEAN; required checks or branch protection are not satisfied.`);
  }
  return { ok: true, head, pullRequestUrl: facts.pullRequestUrl };
}

/**
 * The ONLY paths the agent's own commits may change for the worker to merge
 * unattended (an allowlist: anything else is authority-adjacent). Matched on
 * the LOWERCASED path, because the host's file system may be case-insensitive
 * (`docs/Decisions/x.md` is `docs/decisions/x.md` there).
 * - No source or app code at all: no `src/**` (every module can define or
 *   enforce a gate), no `apps/**` (dashboard server components can run
 *   commands), no scripts, config or manifests.
 * - `tests/**`, minus the shared helpers and harness fakes that gate proofs;
 * - `docs/**` Markdown, minus Decisions, agent guidance, Plans, scout state,
 *   the shared agent context and the production readiness report;
 * - a top-level Markdown file that is not a governance document.
 * No path segment may start with a dot, and no governance file name may
 * appear anywhere. The batch-merge classifier and the stewardship
 * assessment still apply on top, and renames count both paths.
 */
const WORKER_MERGE_SAFE_PATHS: readonly RegExp[] = [
  /^tests\/(?!helpers\/|fast-rehearsal\/helpers\/|setup)[^\0]+$/,
  /^docs\/(?!decisions\/|agent-guidance\/|plans\/|scout\/|agents-context\.md$|managed-production-readiness\.md$)[^\0]+\.md$/,
  /^[a-z0-9_-]+\.md$/
];
const GOVERNANCE_FILE_NAMES = new Set([
  "agents.md", "claude.md", "project.md", "constitution.md", "north_star.md", "operator_context.md", "mission_log.md", "codeowners"
]);

/** Whether one agent-changed path is on the worker-merge allowlist (case-insensitively, fail closed). */
export function isWorkerMergeSafePath(path: string): boolean {
  const lower = path.normalize("NFKC").toLowerCase();
  if (/[^\x20-\x7e]/.test(lower) || lower.includes("\\")) return false;
  const segments = lower.split("/");
  if (segments.some((segment) => segment === "" || segment.startsWith(".") || segment !== segment.trim())) return false;
  if (GOVERNANCE_FILE_NAMES.has(segments[segments.length - 1])) return false;
  return WORKER_MERGE_SAFE_PATHS.some((pattern) => pattern.test(lower));
}

/** Every path a diff touches, renames and copies as BOTH their old and new path (`--no-renames`), so a move out of a governed path counts. */
function diffPaths(repoRoot: string, args: string[]): string[] {
  return git(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", ...args])
    .split("\n").map((line) => line.trim()).filter(Boolean);
}

/** The governed records a completion settlement commit writes (pointer, Plan status, Mission Log, archived Ask), exact case; anything else in it is authority-adjacent. */
const SETTLEMENT_RECORD_PATH =/^(?:PROJECT\.md|MISSION_LOG\.md|docs\/plans\/[^/]+\.md|\.arcadia\/asks\/archive\/[^/]+\.ya?ml)$/;

/**
 * The blast-radius assessment of one candidate head: the stewardship
 * assessment (`arcadia pr assess-blast-radius`: controller safety and
 * authority paths, diff size, missing evidence) over the whole candidate,
 * plus the batch-merge card's authority-path classifier over the agent's own
 * commits. When `settlementCommit` is the head (the governed completion
 * settlement the terminal guards verified), that one commit may touch only
 * the Project and Plan records it settles; every earlier commit is classified
 * in full. Any Git failure returns null (unknown, which refuses).
 */
export function assessWorkerMergeBlastRadius(
  repoRoot: string,
  baseRevision: string,
  head: string,
  settlementCommit: string | null
): WorkerMergeBlastRadius | null {
  try {
    const stewardship = computeBlastRadius(repoRoot, baseRevision, head);
    const settled = settlementCommit !== null && settlementCommit === head;
    const parent = settled ? git(repoRoot, ["rev-parse", `${head}^`]).trim() : head;
    const agentPaths = settled && isAncestor(repoRoot, parent, baseRevision)
      ? []
      : diffPaths(repoRoot, [`${baseRevision}...${parent}`]);
    const settlementPaths = settled ? diffPaths(repoRoot, [parent, head]) : [];
    const boundaries = agentPaths.length > 0 ? classifyAuthorityPaths(agentPaths) : [];
    const outsideRecords = settlementPaths.filter((path) => !SETTLEMENT_RECORD_PATH.test(path));
    const notAllowlisted = agentPaths.filter((path) => !isWorkerMergeSafePath(path));
    const reasons = [...stewardship.reasons];
    if (notAllowlisted.length > 0) reasons.push(`The agent's own commits change paths outside the worker-merge allowlist: ${notAllowlisted.join(", ")}.`);
    if (boundaries.length > 0) reasons.push(`The agent's own commits touch authority boundaries: ${boundaries.join(", ")}.`);
    if (outsideRecords.length > 0) reasons.push(`The completion settlement commit changes paths outside the Project and Plan records: ${outsideRecords.join(", ")}.`);
    if (settled && agentPaths.length === 0) reasons.push("The candidate carries no change of its own beyond its completion settlement.");
    return {
      authorityAdjacent: reasons.length > 0,
      reasons,
      boundaries,
      touchedPaths: stewardship.touchedPaths,
      linesChanged: stewardship.linesChanged
    };
  } catch {
    return null;
  }
}

/* ------------------------------ durable record ------------------------------ */

export interface WorkerMergeRecord {
  request_id: string;
  session_id: string;
  action_key: string;
  pull_request_url: string | null;
  head: string;
  outcome: "merged" | "refused";
  code: WorkerMergeRefusalCode | null;
  reason: string;
  boundaries_json: string;
  updated_at: string;
}

export function ensureWorkerMergeTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_worker_merges (
      request_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      pull_request_url TEXT,
      head TEXT NOT NULL,
      outcome TEXT NOT NULL,
      code TEXT,
      reason TEXT NOT NULL,
      boundaries_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
  `);
}

function recordWorkerMerge(db: Database.Database, row: Omit<WorkerMergeRecord, "request_id">): void {
  ensureWorkerMergeTable(db);
  const requestId = `worker-merge-${row.session_id}-${row.head}`;
  const existing = db.prepare("SELECT outcome, code, reason, pull_request_url, boundaries_json FROM production_worker_merges WHERE request_id = ?").get(requestId) as
    Pick<WorkerMergeRecord, "outcome" | "code" | "reason" | "pull_request_url" | "boundaries_json"> | undefined;
  // An identical outcome repeated on a later tick writes nothing.
  if (existing && existing.outcome === row.outcome && existing.code === row.code && existing.reason === row.reason
    && existing.pull_request_url === row.pull_request_url && existing.boundaries_json === row.boundaries_json) return;
  db.prepare(`INSERT INTO production_worker_merges (request_id, session_id, action_key, pull_request_url, head, outcome, code, reason, boundaries_json, updated_at)
    VALUES (@request_id, @session_id, @action_key, @pull_request_url, @head, @outcome, @code, @reason, @boundaries_json, @updated_at)
    ON CONFLICT(request_id) DO UPDATE SET pull_request_url = @pull_request_url, outcome = @outcome, code = @code, reason = @reason,
      boundaries_json = @boundaries_json, updated_at = @updated_at`)
    .run({ ...row, request_id: requestId });
}

/** Read-only: every recorded worker merge outcome, newest first. A database without the table has none. */
export function listWorkerMerges(db: Database.Database, limit = 20): WorkerMergeRecord[] {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_worker_merges'").get();
  if (!exists) return [];
  return db.prepare("SELECT * FROM production_worker_merges ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(limit) as WorkerMergeRecord[];
}

/** One PR the worker refused as authority-adjacent: it waits for the operator's batch-merge card. */
export interface OperatorMergeQueueEntry {
  actionKey: string;
  pullRequestUrl: string;
  pullRequestNumber: number | null;
  headSha: string;
  /** The card row's "why": the worker's named refusal and the assessment's reasons. */
  why: string;
  boundaries: AuthorityBoundary[];
}

/**
 * The authority-adjacent PRs the worker refused to merge, latest head per
 * Action, for the batch-merge card (`buildBatchMergeCard`'s `why` and its
 * acknowledged boundaries) and `production status`. Read-only.
 */
export function operatorMergeQueue(db: Database.Database): OperatorMergeQueueEntry[] {
  const latest = new Map<string, WorkerMergeRecord>();
  for (const row of listWorkerMerges(db, 200)) if (!latest.has(row.action_key)) latest.set(row.action_key, row);
  const entries: OperatorMergeQueueEntry[] = [];
  for (const row of latest.values()) {
    if (row.outcome !== "refused" || row.code !== "authority_adjacent" || !row.pull_request_url) continue;
    let boundaries: AuthorityBoundary[];
    try { boundaries = JSON.parse(row.boundaries_json) as AuthorityBoundary[]; } catch { boundaries = ["unclassifiable_path"]; }
    const number = /\/pull\/(\d+)$/.exec(row.pull_request_url)?.[1];
    entries.push({
      actionKey: row.action_key,
      pullRequestUrl: row.pull_request_url,
      pullRequestNumber: number ? Number(number) : null,
      headSha: row.head,
      why: `The worker did not merge ${row.action_key} (authority_adjacent): ${row.reason}`,
      boundaries
    });
  }
  return entries;
}

/**
 * Fill the batch-merge card's per-PR facts from the worker's queue: a PR the
 * worker refused as authority-adjacent at exactly this head carries that reason
 * as its `why`. Any other PR is returned unchanged.
 */
export function withWorkerMergeReasons<T extends { number: number; headSha: string; why: string }>(prs: readonly T[], queue: readonly OperatorMergeQueueEntry[]): T[] {
  return prs.map((pr) => {
    const entry = queue.find((candidate) => candidate.pullRequestNumber === pr.number && candidate.headSha === pr.headSha);
    return entry ? { ...pr, why: pr.why ? `${pr.why} ${entry.why}` : entry.why } : pr;
  });
}

/* ------------------------------- the merge step ------------------------------- */

export type RunCommand = NonNullable<QaPrReviewDependencies["runCommand"]>;

export interface WorkerMergeDeps {
  /** `gh` runner; defaults to the host runner `arcadia qa pr` uses. */
  runCommand?: RunCommand;
  /** Moves the local base onto the remote base after GitHub merged; defaults to `git fetch` + `merge --ff-only origin/<base>`. */
  syncBase?: (input: { repoRoot: string; baseBranch: string }) => void;
}

export interface WorkerMergeInput {
  db: Database.Database;
  repoRoot: string;
  baseBranch: string;
  sessionId: string;
  actionKey: string;
  head: string;
  settlementCommit: string | null;
  pullRequestUrl: string | null;
  review: VerdictGate | null;
  now: Date;
  /** Re-checked right before the merge call; a non-null answer withholds it. */
  authorityChanged?: () => string | null;
}

export type WorkerMergeOutcome =
  | { kind: "merged"; head: string; pullRequestUrl: string; replayed: boolean }
  | { kind: "refused"; code: WorkerMergeRefusalCode; reason: string; operatorMergeCommand: string | null }
  | { kind: "withheld"; reason: string };

const VIEW_FIELDS = "state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,statusCheckRollup";

function readPullRequest(runCommand: RunCommand, repoRoot: string, url: string): { view: WorkerMergePullRequestView | null; error: string | null } {
  const viewed = runCommand({ command: "gh", args: ["pr", "view", url, "--json", VIEW_FIELDS], cwd: repoRoot, timeoutMs: 30_000 });
  if (viewed.status !== 0) return { view: null, error: viewed.error ?? (viewed.stderr.trim() || `exit ${String(viewed.status)}`) };
  try {
    return { view: JSON.parse(viewed.stdout) as WorkerMergePullRequestView, error: null };
  } catch (error) {
    return { view: null, error: `unusable JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function defaultSyncBase({ repoRoot, baseBranch }: { repoRoot: string; baseBranch: string }): void {
  git(repoRoot, ["fetch", "--quiet", "origin", baseBranch]);
  git(repoRoot, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--quiet", `origin/${baseBranch}`]);
}

/** The exact operator command for a refused worker merge. */
export function workerOperatorMergeCommand(url: string | null, head: string): string | null {
  return url ? `gh pr merge ${url} --merge --match-head-commit ${head}` : null;
}

/**
 * Merge one candidate's PR on GitHub at its exact reviewed head, or refuse with
 * a named reason. Records every outcome durably (one row per Session and head).
 */
export function mergeCandidatePullRequest(input: WorkerMergeInput, deps: WorkerMergeDeps = {}): WorkerMergeOutcome {
  const runCommand = deps.runCommand ?? runHostCommand;
  const syncBase = deps.syncBase ?? defaultSyncBase;
  const { db, repoRoot, baseBranch, head } = input;
  const url = input.pullRequestUrl;
  const operatorCommand = workerOperatorMergeCommand(url, head);
  const base = { session_id: input.sessionId, action_key: input.actionKey, pull_request_url: url, head, updated_at: input.now.toISOString() };
  const refused = (code: WorkerMergeRefusalCode, reason: string, boundaries: AuthorityBoundary[] = []): WorkerMergeOutcome => {
    recordWorkerMerge(db, { ...base, outcome: "refused", code, reason, boundaries_json: JSON.stringify(boundaries) });
    return { kind: "refused", code, reason: `Worker merge refused (${code}): ${reason}`, operatorMergeCommand: code === "base_not_synced" ? null : operatorCommand };
  };
  const synced = (replayed: boolean): WorkerMergeOutcome => {
    try {
      syncBase({ repoRoot, baseBranch });
    } catch (error) {
      return refused("base_not_synced", `GitHub merged ${url} at ${short(head)}, but the local ${baseBranch} could not be moved onto the remote: ${error instanceof Error ? error.message : String(error)} The next tick's base-branch sync retries.`);
    }
    if (tryGit(repoRoot, ["merge-base", "--is-ancestor", head, `refs/heads/${baseBranch}`]) === null) {
      return refused("base_not_synced", `GitHub merged ${url} at ${short(head)}, but the local ${baseBranch} does not contain it yet; the next tick's base-branch sync retries.`);
    }
    recordWorkerMerge(db, { ...base, outcome: "merged", code: null, reason: `Merged ${url} at ${short(head)} through GitHub.`, boundaries_json: "[]" });
    return { kind: "merged", head, pullRequestUrl: url!, replayed };
  };

  const read = url ? readPullRequest(runCommand, repoRoot, url) : { view: null, error: null };
  // A PR GitHub already merged at exactly this head (an earlier tick merged it
  // and stopped before the local sync) only needs the sync.
  if (read.view && typeof read.view.state === "string" && read.view.state.toUpperCase() === "MERGED") {
    if (read.view.baseRefName !== baseBranch) {
      return refused("wrong_base", `PR ${url} was merged into ${String(read.view.baseRefName ?? "an unreported base")}, not the governed base ${baseBranch}.`);
    }
    if (read.view.headRefOid === head) return synced(true);
    return refused("head_moved", `PR ${url} was merged at ${short(String(read.view.headRefOid))}, not the reviewed head ${short(head)}.`);
  }
  const blastRadius = assessWorkerMergeBlastRadius(repoRoot, baseBranch, head, input.settlementCommit);
  const evaluation = evaluateWorkerMerge({
    expectedHead: head,
    baseBranch,
    review: input.review,
    pullRequestUrl: url,
    pullRequest: read.view,
    pullRequestReadError: read.error,
    blastRadius
  });
  if (!evaluation.ok) return refused(evaluation.code, evaluation.reason, evaluation.code === "authority_adjacent" ? blastRadius?.boundaries ?? [] : []);

  const fenced = input.authorityChanged?.() ?? null;
  if (fenced) return { kind: "withheld", reason: `Withheld the worker merge of ${url}: ${fenced}.` };
  const merged = runCommand({ command: "gh", args: ["pr", "merge", evaluation.pullRequestUrl, "--merge", "--match-head-commit", head], cwd: repoRoot, timeoutMs: 120_000 });
  if (merged.status !== 0) {
    const detail = merged.error ?? (merged.stderr.trim() || `exit ${String(merged.status)}`);
    return refused("merge_failed", `gh pr merge ${evaluation.pullRequestUrl} --match-head-commit ${short(head)} failed: ${detail}`);
  }
  const after = readPullRequest(runCommand, repoRoot, evaluation.pullRequestUrl);
  if (!after.view || String(after.view.state).toUpperCase() !== "MERGED" || after.view.headRefOid !== head) {
    return refused("merge_unverified", `GitHub did not report ${evaluation.pullRequestUrl} MERGED at ${short(head)} after the merge call${after.error ? ` (${after.error})` : ""}.`);
  }
  return synced(false);
}
