import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import type { AgentSession } from "../sessions/index.js";
import { systemPreservationRemote, type CandidatePreservationReceipt, type CandidatePreservationRemote } from "../sessions/candidatePreservation.js";
import { INDEPENDENT_VERDICT_ROLES, latestRoleAttempt, type IndependentVerdictRole } from "../sessions/enrollment.js";
import { independentVerdictReadiness } from "../sessions/roleLineage.js";
import { isAncestor, tryGit } from "../git/worktrees.js";
import {
  classifyPullRequestChecks,
  runHostCommand,
  runQaPrReviewCommand,
  type PullRequestCheckRun,
  type QaPrReviewDependencies
} from "../qa/prReview.js";
import { PRODUCTION_CONTROL_DEADLINES, policyAuthorizesPullRequestReadiness, readProductionPolicySafely } from "./policy.js";

/**
 * The unattended half of the independent verdict gate. After the exit tick
 * preserves and accepts a managed candidate behind a host-created draft PR,
 * each later tick advances that PR by at most one side effect toward the two
 * exact-head verdicts integration needs:
 *
 * 1. push exactly the settled head commit when a settlement commit landed after
 *    preservation (the PR still shows the preserved commit);
 * 2. `gh pr ready` the draft;
 * 3. poll required checks (read-only) until green, failed or past a deadline;
 * 4. run `arcadia qa code-review`, then `arcadia qa pr`, one reviewer per tick.
 *
 * Nothing here sleeps: every tick re-derives where the candidate stands from
 * GitHub, the role lineage and one persisted step row per exact head, so a
 * restarted worker resumes mid-step and a replayed step is a no-op (a ready PR
 * is not readied again; a recorded verdict is reused by its per-head receipt,
 * and an interrupted one resumes its own lineage attempt). Every side effect
 * re-reads the policy first, against a fresh clock, and is withheld on Off, a
 * changed epoch or a lapsed grant. Consecutive failures of GitHub, the push or
 * the reviewer's own infrastructure consume a per-head budget that survives
 * restart (a success resets it, and a total cap per head bounds failures that
 * alternate between steps; a GitHub rate limit backs off without spending it
 * and escalates after hours of unbroken limiting). A non-pass verdict is re-run
 * only when its own lineage receipt records that the reviewer was unavailable,
 * which `arcadia qa pr` derives from deterministic evidence alone; a
 * reviewer's real non-pass judgment is never retried automatically and never
 * integrates.
 *
 * Every step, the push included, requires `policyAuthorizesPullRequestReadiness`
 * (`--remote-preservation` and a current Decision 0058 integration grant).
 * Out of scope by design: merging the PR on GitHub and pushing the base
 * branch. Integration remains the tick's local fast-forward.
 */

export type ReviewBlockCode =
  | "review_head_moved"
  | "review_pull_request_unavailable"
  | "review_paused_as_draft"
  | "required_checks_failed"
  | "required_checks_timeout"
  | "review_budget_exhausted"
  | "review_rate_limited"
  | "independent_verdict_failed";

export const REVIEW_BLOCK_CODES: ReadonlySet<string> = new Set<ReviewBlockCode>([
  "review_head_moved",
  "review_pull_request_unavailable",
  "review_paused_as_draft",
  "required_checks_failed",
  "required_checks_timeout",
  "review_budget_exhausted",
  "review_rate_limited",
  "independent_verdict_failed"
]);

export type ReviewStepOutcome =
  /** The tick does not drive this candidate's review; `reason` says why (no PR, no authority). */
  | { kind: "not_applicable"; reason: string }
  /** Nothing to do this tick (polling interval, pending checks, authority changed mid-step). */
  | { kind: "waiting"; reason: string }
  /** One side effect happened this tick. */
  | { kind: "advanced"; step: "pushed" | "ready" | IndependentVerdictRole; reason: string }
  | { kind: "blocked"; code: ReviewBlockCode; reason: string; remedy: string };

export interface IndependentReviewDeps {
  /** The GitHub CLI and reviewer process runner; defaults to the one `arcadia qa pr` uses. */
  runCommand?: QaPrReviewDependencies["runCommand"];
  selectReviewer?: QaPrReviewDependencies["selectReviewer"];
  /** The push half of preservation's network adapter, reused to publish a settled head. */
  remote?: CandidatePreservationRemote;
  /** A fresh reading of the time for authority checks; defaults to the tick's `now`. */
  clock?: () => Date;
  pollIntervalMs?: number;
  checksDeadlineMs?: number;
  maxFailures?: number;
  reviewerTimeoutMs?: number;
  rateLimitBackoffMs?: number;
  /** Continuous rate limiting this long escalates `review_rate_limited`. */
  rateLimitEscalateAfterMs?: number;
}

export interface ReviewStepRow {
  request_id: string;
  session_id: string;
  action_key: string;
  target_head: string;
  pull_request_url: string;
  policy_epoch: number;
  pushed_at: string | null;
  ready_at: string | null;
  checks_started_at: string | null;
  last_polled_at: string | null;
  /** Consecutive failures; any success resets it. */
  failures: number;
  /** Which step the consecutive failures belong to (read, push, ready, code-review, qa). */
  failure_step: string | null;
  last_error: string | null;
  /** Every failure on this head, never reset by a success (only by an operator reset). */
  total_failures: number;
  /** No GitHub read before this instant (a reported rate limit). */
  backoff_until: string | null;
  /** When the current unbroken run of rate limits began; cleared by a successful read. */
  backoff_started_at: string | null;
  /** The last polled outcome, replayed between polls so the escalation stays stable. */
  last_outcome_json: string | null;
  created_at: string;
  updated_at: string;
}

export function ensureProductionReviewStepTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_review_steps (
      request_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      target_head TEXT NOT NULL,
      pull_request_url TEXT NOT NULL,
      policy_epoch INTEGER NOT NULL,
      pushed_at TEXT,
      ready_at TEXT,
      checks_started_at TEXT,
      last_polled_at TEXT,
      failures INTEGER NOT NULL DEFAULT 0,
      failure_step TEXT,
      total_failures INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      backoff_until TEXT,
      backoff_started_at TEXT,
      last_outcome_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_production_review_steps_action ON production_review_steps(action_key);
  `);
  // A database created by an earlier candidate build of this table keeps its
  // old shape under CREATE TABLE IF NOT EXISTS; add whatever it lacks. An
  // obsolete column (retry_role) is left in place and ignored.
  const present = new Set((db.prepare("PRAGMA table_info(production_review_steps)").all() as Array<{ name: string }>).map((column) => column.name));
  for (const [name, definition] of REVIEW_STEP_ADDED_COLUMNS) {
    if (!present.has(name)) db.exec(`ALTER TABLE production_review_steps ADD COLUMN ${name} ${definition}`);
  }
}

const REVIEW_STEP_ADDED_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["last_polled_at", "TEXT"],
  ["failure_step", "TEXT"],
  ["total_failures", "INTEGER NOT NULL DEFAULT 0"],
  ["backoff_until", "TEXT"],
  ["backoff_started_at", "TEXT"],
  ["last_outcome_json", "TEXT"]
];

/** The step row's request id: one per Session and exact settled head, so a moved head starts fresh. */
export function reviewStepRequestId(sessionId: string, head: string): string {
  return `worker-tick-review-${sessionId}-${head}`;
}

export function listReviewSteps(db: Database.Database, actionKey: string): ReviewStepRow[] {
  ensureProductionReviewStepTable(db);
  return db.prepare("SELECT * FROM production_review_steps WHERE action_key = ? ORDER BY created_at, rowid").all(actionKey) as ReviewStepRow[];
}

/**
 * Operator reset (`arcadia production reset-repair-budget`): a fresh failure
 * budget, checks deadline, backoff and poll for the Action.
 */
export function resetReviewSteps(db: Database.Database, actionKey: string): number {
  ensureProductionReviewStepTable(db);
  return db.prepare(`UPDATE production_review_steps
    SET failures = 0, total_failures = 0, failure_step = NULL, last_error = NULL, checks_started_at = NULL, last_polled_at = NULL,
      backoff_until = NULL, backoff_started_at = NULL
    WHERE action_key = ? AND (failures > 0 OR total_failures > 0 OR checks_started_at IS NOT NULL OR backoff_until IS NOT NULL)`).run(actionKey).changes;
}

function workerPreservationReceipt(db: Database.Database, session: AgentSession): CandidatePreservationReceipt | null {
  try {
    const row = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?")
      .get(`worker-tick-preserve-${session.id}`) as { receipt_json: string } | undefined;
    return row ? JSON.parse(row.receipt_json) as CandidatePreservationReceipt : null;
  } catch {
    return null;
  }
}

/**
 * Whether the tick drives this candidate's review at all, without touching
 * GitHub: a worker preservation receipt with a host-created PR, under a
 * policy that authorizes readying it. Used for the escalation's remedy too.
 */
export function reviewApplicability(db: Database.Database, session: AgentSession, now: Date):
  { applicable: true; pullRequestUrl: string } | { applicable: false; reason: string } {
  const receipt = workerPreservationReceipt(db, session);
  if (!receipt) return { applicable: false, reason: "No worker preservation receipt exists for this candidate." };
  if (!receipt.pullRequestUrl) {
    return {
      applicable: false,
      reason: `The candidate was preserved ${receipt.preservationState} with no pull request, so the tick has no PR to ready or review; `
        + "a later grant activated with `--remote-preservation` (and a current integration grant) lets a newly preserved candidate be reviewed unattended."
    };
  }
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok") return { applicable: false, reason: `The production policy is unreadable: ${policyRead.reason}` };
  const authorized = policyAuthorizesPullRequestReadiness(policyRead.policy, `${session.project_slug}/${session.action_id}`, now);
  if (!authorized.authorized) return { applicable: false, reason: `The tick may not ready or review this PR: ${authorized.reason}` };
  return { applicable: true, pullRequestUrl: receipt.pullRequestUrl };
}

interface PullRequestView {
  state: string;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  /** The PR's base branch now; checked against the base preservation opened it on (`prBase`). */
  baseRefName?: string;
  mergeStateStatus: string | null;
  statusCheckRollup: PullRequestCheckRun[];
}

function parseOutcome(json: string | null): ReviewStepOutcome | null {
  if (!json) return null;
  try { return JSON.parse(json) as ReviewStepOutcome; } catch { return null; }
}

const RATE_LIMITED = /rate limit|secondary rate|abuse detection|HTTP 429/i;

/** Whether a non-pass lineage verdict records that the reviewer itself was unavailable (or went stale), never a judgment. */
function retryableVerdictReceipt(json: string | null): boolean {
  if (!json) return false;
  try {
    const receipt = JSON.parse(json) as { reviewerUnavailable?: unknown; stale?: unknown };
    return (typeof receipt.reviewerUnavailable === "string" && receipt.reviewerUnavailable.length > 0) || receipt.stale === true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


/**
 * Advance one candidate's unattended review by at most one side effect.
 * Called by the tick only when integration is otherwise authorized and would
 * fast-forward, and only while the gate still awaits verdicts.
 */
export function advanceIndependentReview(db: Database.Database, input: {
  workspace: string;
  repoRoot: string;
  session: AgentSession;
  now: Date;
  deps?: IndependentReviewDeps;
  heartbeat?: () => void;
  log?: (message: string) => void;
}): ReviewStepOutcome {
  const { session, repoRoot, now } = input;
  const deps = input.deps ?? {};
  const runCommand = deps.runCommand ?? runHostCommand;
  const clock = deps.clock ?? (() => now);
  const pollIntervalMs = deps.pollIntervalMs ?? PRODUCTION_CONTROL_DEADLINES.reviewPollIntervalMs;
  const checksDeadlineMs = deps.checksDeadlineMs ?? PRODUCTION_CONTROL_DEADLINES.requiredChecksDeadlineMs;
  const maxFailures = deps.maxFailures ?? PRODUCTION_CONTROL_DEADLINES.maxReviewStepFailures;
  const reviewerTimeoutMs = deps.reviewerTimeoutMs ?? PRODUCTION_CONTROL_DEADLINES.tickReviewerTimeoutMs;
  const rateLimitBackoffMs = deps.rateLimitBackoffMs ?? PRODUCTION_CONTROL_DEADLINES.reviewRateLimitBackoffMs;
  const rateLimitEscalateAfterMs = deps.rateLimitEscalateAfterMs ?? PRODUCTION_CONTROL_DEADLINES.reviewRateLimitEscalateAfterMs;
  const maxTotalFailures = maxFailures * 3;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  ensureProductionReviewStepTable(db);

  const applicability = reviewApplicability(db, session, clock());
  if (!applicability.applicable) return { kind: "not_applicable", reason: applicability.reason };
  const url = applicability.pullRequestUrl;
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok") return { kind: "not_applicable", reason: "The production policy is unreadable." };
  const epoch = policyRead.policy.epoch;
  /** Re-read before every side effect, at a fresh time: Off, a new epoch or a lapsed grant withholds it. */
  const authorityChanged = (): string | null => {
    const current = readProductionPolicySafely(db);
    if (current.status !== "ok" || current.policy.desiredState !== "active") return "managed production is Off";
    if (current.policy.epoch !== epoch) return `the production epoch changed (${epoch} -> ${current.policy.epoch})`;
    const authorized = policyAuthorizesPullRequestReadiness(current.policy, actionKey, clock());
    return authorized.authorized ? null : authorized.reason;
  };

  const readiness = independentVerdictReadiness(db, { session, repoRoot });
  if (!readiness.ready) return { kind: "not_applicable", reason: `The candidate is not ready for verdicts: ${readiness.reasons.join(" ")}` };
  const head = readiness.binding.targetHead;
  const requestId = reviewStepRequestId(session.id, head);
  const at = now.toISOString();
  db.prepare(`INSERT INTO production_review_steps (request_id, session_id, action_key, target_head, pull_request_url, policy_epoch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`).run(requestId, session.id, actionKey, head, url, epoch, at, at);
  const read = () => db.prepare("SELECT * FROM production_review_steps WHERE request_id = ?").get(requestId) as ReviewStepRow;
  const update = (fields: Partial<Omit<ReviewStepRow, "request_id">>) => {
    const entries = Object.entries({ ...fields, updated_at: now.toISOString() });
    db.prepare(`UPDATE production_review_steps SET ${entries.map(([key]) => `${key} = @${key}`).join(", ")} WHERE request_id = @request_id`)
      .run({ ...Object.fromEntries(entries), request_id: requestId });
  };
  let step = read();
  if (step.policy_epoch !== epoch) {
    input.log?.(`Review of ${actionKey} at ${head.slice(0, 12)} resumes under production epoch ${epoch} (was ${step.policy_epoch}).`);
    update({ policy_epoch: epoch });
    step = read();
  }

  const exhausted = (): ReviewStepOutcome => ({
    kind: "blocked",
    code: "review_budget_exhausted",
    reason: step.failures >= maxFailures
      ? `The unattended review of ${actionKey} at ${head.slice(0, 12)} failed ${step.failures} consecutive time(s) at ${step.failure_step ?? "a step"} (budget ${maxFailures}); most recent error: ${step.last_error ?? "unknown"}.`
      : `The unattended review of ${actionKey} at ${head.slice(0, 12)} failed ${step.total_failures} time(s) in all (cap ${maxTotalFailures}); most recent error: ${step.last_error ?? "unknown"}.`,
    remedy: `Repair the cause (GitHub CLI sign-in or reachability, the push, or reviewer capacity/sandbox), then run \`arcadia production reset-repair-budget ${actionKey}\`; the next tick resumes the review where it stopped.`
  });
  const isExhausted = () => step.failures >= maxFailures || step.total_failures >= maxTotalFailures;
  if (isExhausted()) return exhausted();
  /** A consecutive failure of `stepName`; a different step's failure starts a new count. */
  const fail = (stepName: string, message: string): ReviewStepOutcome => {
    const failures = step.failure_step === stepName ? step.failures + 1 : 1;
    update({ failures, failure_step: stepName, total_failures: step.total_failures + 1, last_error: message });
    step = read();
    input.log?.(`Review step ${stepName} for ${actionKey} failed (${step.failures}/${maxFailures} consecutive, ${step.total_failures}/${maxTotalFailures} in all): ${message}`);
    return isExhausted() ? exhausted() : { kind: "waiting", reason: `The ${stepName} step failed and will be retried: ${message}` };
  };
  /** Any success ends a failure streak (a read only ends a streak of read failures). */
  const succeeded = (stepName?: string) => {
    if (step.failures > 0 && (stepName === undefined || step.failure_step === stepName)) {
      update({ failures: 0, failure_step: null, last_error: null });
      step = read();
    }
  };
  /** Between reads the last polled outcome stands, so a blocked step's escalation does not flap back to a plain wait. */
  const replay = (waiting: string): ReviewStepOutcome => {
    const last = parseOutcome(step.last_outcome_json);
    if (last?.kind === "blocked" && last.code !== "review_budget_exhausted") return last;
    return { kind: "waiting", reason: last ? `${waiting} (last: ${last.reason})` : waiting };
  };
  const rateLimitedTooLong = (): ReviewStepOutcome => ({
    kind: "blocked",
    code: "review_rate_limited",
    reason: `GitHub has rate-limited the unattended review of ${actionKey} continuously since ${step.backoff_started_at}; the tick keeps backing off.`,
    remedy: "Check the GitHub CLI account's API rate limit (`gh api rate_limit`) and what else spends it; the tick resumes on its own once GitHub answers, with no budget spent."
  });
  const rateLimited = (stepName: string, detail: string): ReviewStepOutcome | null => {
    if (!RATE_LIMITED.test(detail)) return null;
    const until = new Date(now.getTime() + rateLimitBackoffMs).toISOString();
    update({ backoff_until: until, backoff_started_at: step.backoff_started_at ?? at });
    step = read();
    input.log?.(`GitHub rate-limited the ${stepName} step for ${actionKey}; backing off until ${until}.`);
    if (now.getTime() - Date.parse(step.backoff_started_at!) >= rateLimitEscalateAfterMs) return rateLimitedTooLong();
    // A rate limit is no news about the PR: an open blocked outcome stands.
    return replay(`GitHub reported a rate limit at the ${stepName} step; no GitHub read before ${until}.`);
  };

  // Read GitHub at most once per poll interval (the producer tick runs every
  // few seconds), and not at all during a rate-limit backoff. Between polls
  // the last polled outcome stands, so a blocked step's escalation does not
  // flap back to a plain wait.
  if (step.backoff_until && now.getTime() < Date.parse(step.backoff_until)) {
    return replay(`Backing off after a GitHub rate limit; no GitHub read before ${step.backoff_until}.`);
  }
  if (step.last_polled_at && now.getTime() - Date.parse(step.last_polled_at) < pollIntervalMs) {
    return replay("Waiting for the next pull-request poll.");
  }
  update({ last_polled_at: at, backoff_until: null });
  step = read();
  const outcome = ((): ReviewStepOutcome => {
    const viewed = runCommand({
      command: "gh",
      args: ["pr", "view", url, "--json", "state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,statusCheckRollup"],
      cwd: repoRoot,
      timeoutMs: 30_000
    });
    if (viewed.status !== 0) {
      const detail = viewed.error ?? (viewed.stderr.trim() || `exit ${String(viewed.status)}`);
      return rateLimited("read", detail) ?? fail("read", `gh pr view ${url} failed: ${detail}`);
    }
    let pr: PullRequestView;
    try {
      pr = JSON.parse(viewed.stdout) as PullRequestView;
      if (typeof pr.headRefOid !== "string" || !/^[0-9a-f]{40,64}$/.test(pr.headRefOid) || typeof pr.state !== "string"
        || !Array.isArray(pr.statusCheckRollup)) throw new Error("required fields are absent or malformed");
    } catch (error) {
      return fail("read", `gh pr view ${url} returned unusable evidence: ${errorMessage(error)}`);
    }
    succeeded("read");
    if (step.backoff_started_at) {
      update({ backoff_started_at: null });
      step = read();
    }

    // The base host preservation opened the PR on (Issue #987: possibly a
    // stacked candidate branch); its Operator QA plan describes that base.
    const opened = workerPreservationReceipt(db, session)?.prBase ?? null;
    const restoreBase = opened?.kind === "stacked" && opened.tip
      ? `\`git -C ${repoRoot} push origin ${opened.tip}:refs/heads/${opened.branch}\``
      : null;
    if (pr.state.toUpperCase() !== "OPEN" || pr.headRefName !== session.branch) {
      return {
        kind: "blocked",
        code: "review_pull_request_unavailable",
        reason: `PR ${url} is ${pr.state} on ${pr.headRefName}, not an open PR for the candidate branch ${session.branch}; no verdict is requested.`,
        remedy: `Reopen ${url} for ${session.branch} (or review and land the candidate by hand); the next tick resumes.`
          + (restoreBase ? ` It is stacked on ${opened!.branch}, and GitHub closes a PR whose base branch is deleted: restore that branch first with ${restoreBase}.` : "")
      };
    }
    if (opened && typeof pr.baseRefName === "string" && pr.baseRefName !== opened.branch) {
      return {
        kind: "blocked",
        code: "review_pull_request_unavailable",
        reason: `PR ${url} is now based on ${pr.baseRefName}, but host preservation opened it on ${opened.branch} and its Operator QA plan describes that base; no verdict is requested.`,
        remedy: `Retarget it back with \`gh pr edit ${url} --base ${opened.branch}\``
          + (restoreBase ? ` (if ${opened.branch} is gone from the remote, restore it first with ${restoreBase})` : "")
          + ", or review and land the candidate by hand; the next tick resumes."
      };
    }

    if (pr.headRefOid !== head) {
      // A settlement commit landed after preservation pushed the PR: publish the
      // exact settled head (a fast-forward of the agent branch) before any
      // verdict. Anything else is a moved head and never receives a verdict.
      let descends: boolean;
      try {
        descends = isAncestor(repoRoot, pr.headRefOid, head);
      } catch (error) {
        return fail("push", `Comparing the PR head with the settled head failed: ${errorMessage(error)}`);
      }
      if (!descends) {
        return {
          kind: "blocked",
          code: "review_head_moved",
          reason: `PR ${url} head ${pr.headRefOid.slice(0, 12)} is not the settled candidate head ${head.slice(0, 12)} or an ancestor of it; a moved head never receives a verdict.`,
          remedy: `Restore ${session.branch} on the remote to ${head} (or let a new Session produce a new candidate); the next tick resumes.`
        };
      }
      const fenced = authorityChanged();
      if (fenced) return { kind: "waiting", reason: `Withheld pushing the settled head: ${fenced}.` };
      // Push exactly the settled head, and only while the local branch still is it.
      if (tryGit(repoRoot, ["rev-parse", `refs/heads/${session.branch}`])?.trim() !== head) {
        return {
          kind: "blocked",
          code: "review_head_moved",
          reason: `The local candidate branch ${session.branch} no longer points at the settled head ${head.slice(0, 12)}; nothing is pushed.`,
          remedy: `Restore ${session.branch} to ${head}; a moved head never receives a verdict.`
        };
      }
      try {
        (deps.remote ?? systemPreservationRemote).push({ repositoryPath: repoRoot, branch: session.branch, commitSha: head });
      } catch (error) {
        return fail("push", `Pushing the settled head of ${session.branch} failed: ${errorMessage(error)}`);
      }
      update({ pushed_at: at });
      succeeded();
      input.log?.(`Pushed settled head ${head.slice(0, 12)} of ${session.branch} for ${actionKey}; PR ${url} showed ${pr.headRefOid.slice(0, 12)}.`);
      return { kind: "advanced", step: "pushed", reason: `Pushed the settled head ${head.slice(0, 12)} to ${url}.` };
    }

    if (pr.isDraft && step.ready_at) {
      // The tick readied it once; someone converted it back to draft. That is
      // a person pausing the review, never something to undo every minute.
      return {
        kind: "blocked",
        code: "review_paused_as_draft",
        reason: `PR ${url} was returned to draft after the tick marked it ready at ${step.ready_at}; no reviewer runs while it is a draft.`,
        remedy: `When the candidate may be reviewed, mark it ready yourself (\`gh pr ready ${url}\`); the next tick resumes.`
      };
    }
    if (pr.isDraft) {
      const fenced = authorityChanged();
      if (fenced) return { kind: "waiting", reason: `Withheld marking the PR ready: ${fenced}.` };
      const ready = runCommand({ command: "gh", args: ["pr", "ready", url], cwd: repoRoot, timeoutMs: 30_000 });
      if (ready.status !== 0) {
        const detail = ready.error ?? (ready.stderr.trim() || `exit ${String(ready.status)}`);
        return rateLimited("ready", detail) ?? fail("ready", `gh pr ready ${url} failed: ${detail}`);
      }
      update({ ready_at: at, checks_started_at: step.checks_started_at ?? at });
      succeeded();
      input.log?.(`Marked ${url} ready for review at ${head.slice(0, 12)} for ${actionKey}.`);
      return { kind: "advanced", step: "ready", reason: `Marked ${url} ready for review.` };
    }
    if (!step.checks_started_at) {
      update({ checks_started_at: at });
      step = read();
    }

    const mergeState = pr.mergeStateStatus?.toUpperCase() ?? "";
    if (mergeState === "DIRTY") {
      return {
        kind: "blocked",
        code: "review_pull_request_unavailable",
        reason: `PR ${url} has merge conflicts (merge state DIRTY); \`arcadia qa pr\` refuses to review it.`,
        remedy: "Resolve the conflict with the base branch (a new candidate head); the tick keeps polling."
      };
    }
    const checks = classifyPullRequestChecks(pr.statusCheckRollup);
    if (checks.state === "failed") {
      const unknown = checks.unknown.length > 0
        ? ` Unknown check entry shape(s) ${checks.unknown.join(", ")}: Arcadia cannot read their state; extend normalizeStatusCheck (src/workMonitoring/pullRequests.ts) for that shape or remove the reporter.`
        : "";
      return {
        kind: "blocked",
        code: "required_checks_failed",
        reason: `Required checks on ${url} at ${head.slice(0, 12)} did not succeed: ${checks.blockers.join(" ")}`,
        remedy: `A failed check needs a fix (a new candidate head) or a GitHub re-run of the check; the tick keeps polling and reviews as soon as every check is green. No reviewer runs meanwhile.${unknown}`
      };
    }
    if (checks.state !== "green") {
      // Branch protection reports BLOCKED while required checks still run, so
      // BLOCKED only means something once they are all green.
      const waited = now.getTime() - Date.parse(step.checks_started_at!);
      if (waited >= checksDeadlineMs) {
        return {
          kind: "blocked",
          code: "required_checks_timeout",
          reason: `Required checks on ${url} at ${head.slice(0, 12)} are still not green after ${Math.round(waited / 60_000)} minute(s): ${checks.blockers.join(" ")}`,
          remedy: `Make the PR's checks run and finish (a required workflow must report on ${head.slice(0, 12)}); the tick reviews as soon as they are green, or run \`arcadia production reset-repair-budget ${actionKey}\` to restart the wait.`
        };
      }
      return { kind: "waiting", reason: `Waiting for required checks on ${url}: ${checks.blockers.join(" ")}` };
    }
    if (mergeState === "BLOCKED") {
      return {
        kind: "blocked",
        code: "review_pull_request_unavailable",
        reason: `PR ${url} is BLOCKED by branch protection although its checks are green; \`arcadia qa pr\` refuses to review it.`,
        remedy: "Satisfy or relax the branch-protection requirement that still blocks the PR (for example a required approving review); the tick keeps polling."
      };
    }

    // Checks are green on the exact settled head: the next missing verdict, one per tick.
    for (const role of INDEPENDENT_VERDICT_ROLES) {
      const latest = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
      const sameBinding = latest !== null && latest.target_head === head
        && latest.criteria_fingerprint === readiness.binding.criteriaFingerprint
        && latest.evidence_fingerprint === readiness.binding.evidenceFingerprint;
      if (sameBinding && latest.status === "passed") continue;
      const rerun = sameBinding && latest.status === "failed";
      // Only the failed attempt's own receipt can authorize re-judging the same
      // binding: the reviewer was unavailable (or the run went stale). A real
      // non-pass judgment is never re-run automatically.
      if (rerun && !retryableVerdictReceipt(latest.terminal_receipt_json)) {
        return {
          kind: "blocked",
          code: "independent_verdict_failed",
          reason: `The independent ${role} verdict on ${head.slice(0, 12)} failed; a failed verdict never integrates.`,
          remedy: `Read the ${role} report Artifact for ${url}; fix the candidate (a new head is reviewed afresh) or, after judging the failure wrong, rerun it with \`arcadia ${role === "qa" ? "qa pr" : "qa code-review"} ${url} --rerun\`.`
        };
      }
      const fenced = authorityChanged();
      if (fenced) return { kind: "waiting", reason: `Withheld the ${role} reviewer: ${fenced}.` };
      // A progress point right before the bounded reviewer run: the worker
      // re-stamps its heartbeat and tick-ceiling marker here, and the reviewer
      // timeout is well under that ceiling.
      input.heartbeat?.();
      let result: ReturnType<typeof runQaPrReviewCommand>;
      try {
        result = runQaPrReviewCommand(
          { workspace: input.workspace, pullRequest: url, role, rerun, reviewerTimeoutMs },
          { runCommand, ...(deps.selectReviewer ? { selectReviewer: deps.selectReviewer } : {}), now: () => now }
        );
      } catch (error) {
        const code = error instanceof ArcadiaError ? (error.details as { code?: unknown }).code : undefined;
        if (code === "managed_production_off") return { kind: "waiting", reason: `Withheld the ${role} reviewer: managed production is Off.` };
        if (code === "verdict_not_ready") {
          return {
            kind: "blocked",
            code: "review_head_moved",
            reason: `The ${role} reviewer refused: the PR head is no longer the candidate's ready head (${errorMessage(error)}).`,
            remedy: `Restore ${session.branch} on the remote to ${head}; a moved head never receives a verdict.`
          };
        }
        return fail(role, `${role} review of ${url} failed: ${errorMessage(error)}`);
      } finally {
        input.heartbeat?.();
      }
      const unavailable = result.data.reviewerUnavailable;
      if (unavailable) return fail(role, `${role} reviewer unavailable for ${url}: ${unavailable}`);
      succeeded();
      if (result.data.verdict !== "pass") {
        input.log?.(`Independent ${role} of ${actionKey} at ${head.slice(0, 12)}: ${result.data.verdict}.`);
        return {
          kind: "blocked",
          code: "independent_verdict_failed",
          reason: `The independent ${role} verdict on ${head.slice(0, 12)} is ${result.data.verdict}: ${result.data.summary}`,
          remedy: `Read ${result.data.reportPath}; fix the candidate (a new head is reviewed afresh) or, after judging the verdict wrong, rerun it with \`arcadia ${role === "qa" ? "qa pr" : "qa code-review"} ${url} --rerun\`.`
        };
      }
      input.log?.(`Independent ${role} of ${actionKey} at ${head.slice(0, 12)} passed${result.data.reused ? " (existing receipt)" : ""}.`);
      return { kind: "advanced", step: role, reason: `Recorded a passing independent ${role} verdict for ${head.slice(0, 12)}.` };
    }
    return { kind: "waiting", reason: "Both verdicts are recorded; the gate decides integration." };
  })();
  // The exhausted budget is re-derived before every poll; every other polled
  // outcome is replayed until the next poll.
  if (outcome.kind !== "blocked" || outcome.code !== "review_budget_exhausted") update({ last_outcome_json: JSON.stringify(outcome) });
  return outcome;
}
