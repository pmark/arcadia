import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import type { AgentSession } from "../sessions/index.js";
import { systemPreservationRemote, type CandidatePreservationReceipt, type CandidatePreservationRemote } from "../sessions/candidatePreservation.js";
import { INDEPENDENT_VERDICT_ROLES, latestRoleAttempt, type IndependentVerdictRole } from "../sessions/enrollment.js";
import { independentVerdictReadiness } from "../sessions/roleLineage.js";
import { isAncestor } from "../git/worktrees.js";
import {
  classifyPullRequestChecks,
  reviewerUnavailableReason,
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
 * 1. push the settled head when a settlement commit landed after preservation
 *    (the PR still shows the preserved commit), under `--remote-preservation`;
 * 2. `gh pr ready` the draft;
 * 3. poll required checks (read-only) until green, failed or past a deadline;
 * 4. run `arcadia qa code-review`, then `arcadia qa pr`, one reviewer per tick.
 *
 * Nothing here sleeps: every tick re-derives where the candidate stands from
 * GitHub, the role lineage and one persisted step row per exact head, so a
 * restart resumes mid-step and a replayed step is a no-op (a ready PR is not
 * readied again; a recorded verdict is reused by its per-head receipt, and an
 * interrupted one resumes its own lineage attempt). Every side effect re-reads
 * the policy first and is withheld on Off, a changed epoch or a lapsed grant.
 * Failures of GitHub, the push or the reviewer's own infrastructure consume a
 * per-head budget that survives restart; a reviewer's real non-pass judgment is
 * never retried and never integrates.
 *
 * Out of scope by design: merging the PR on GitHub and pushing the base
 * branch. Integration remains the tick's local fast-forward.
 */

export type ReviewBlockCode =
  | "review_head_moved"
  | "review_pull_request_unavailable"
  | "required_checks_failed"
  | "required_checks_timeout"
  | "review_budget_exhausted"
  | "independent_verdict_failed";

export const REVIEW_BLOCK_CODES: ReadonlySet<string> = new Set<ReviewBlockCode>([
  "review_head_moved",
  "review_pull_request_unavailable",
  "required_checks_failed",
  "required_checks_timeout",
  "review_budget_exhausted",
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
  pollIntervalMs?: number;
  checksDeadlineMs?: number;
  maxFailures?: number;
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
  failures: number;
  last_error: string | null;
  retry_role: string | null;
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
      last_error TEXT,
      retry_role TEXT,
      last_outcome_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_production_review_steps_action ON production_review_steps(action_key);
  `);
}

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
 * budget, checks deadline and poll for the Action. The row itself stays, so a
 * reviewer-infrastructure failure is still known to be retryable rather than
 * read as a real failed verdict.
 */
export function resetReviewSteps(db: Database.Database, actionKey: string): number {
  ensureProductionReviewStepTable(db);
  return db.prepare(`UPDATE production_review_steps
    SET failures = 0, last_error = NULL, checks_started_at = NULL, last_polled_at = NULL
    WHERE action_key = ? AND (failures > 0 OR checks_started_at IS NOT NULL)`).run(actionKey).changes;
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
  mergeStateStatus: string | null;
  statusCheckRollup: PullRequestCheckRun[];
}

function parseOutcome(json: string | null): ReviewStepOutcome | null {
  if (!json) return null;
  try { return JSON.parse(json) as ReviewStepOutcome; } catch { return null; }
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
  const pollIntervalMs = deps.pollIntervalMs ?? PRODUCTION_CONTROL_DEADLINES.reviewPollIntervalMs;
  const checksDeadlineMs = deps.checksDeadlineMs ?? PRODUCTION_CONTROL_DEADLINES.requiredChecksDeadlineMs;
  const maxFailures = deps.maxFailures ?? PRODUCTION_CONTROL_DEADLINES.maxReviewStepFailures;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  ensureProductionReviewStepTable(db);

  const applicability = reviewApplicability(db, session, now);
  if (!applicability.applicable) return { kind: "not_applicable", reason: applicability.reason };
  const url = applicability.pullRequestUrl;
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok") return { kind: "not_applicable", reason: "The production policy is unreadable." };
  const epoch = policyRead.policy.epoch;
  /** Re-read before every side effect: Off, a new epoch or a lapsed grant withholds it. */
  const authorityChanged = (): string | null => {
    const current = readProductionPolicySafely(db);
    if (current.status !== "ok" || current.policy.desiredState !== "active") return "managed production is Off";
    if (current.policy.epoch !== epoch) return `the production epoch changed (${epoch} -> ${current.policy.epoch})`;
    const authorized = policyAuthorizesPullRequestReadiness(current.policy, actionKey, now);
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
    reason: `The unattended review of ${actionKey} at ${head.slice(0, 12)} failed ${step.failures} time(s) (budget ${maxFailures}); most recent error: ${step.last_error ?? "unknown"}.`,
    remedy: `Repair the cause (GitHub CLI sign-in or reachability, the push, or reviewer capacity/sandbox), then run \`arcadia production reset-repair-budget ${actionKey}\`; the next tick resumes the review where it stopped.`
  });
  if (step.failures >= maxFailures) return exhausted();
  const fail = (message: string, retryRole?: IndependentVerdictRole): ReviewStepOutcome => {
    update({ failures: step.failures + 1, last_error: message, ...(retryRole ? { retry_role: retryRole } : {}) });
    step = read();
    input.log?.(`Review step for ${actionKey} failed (${step.failures}/${maxFailures}): ${message}`);
    return step.failures >= maxFailures ? exhausted() : { kind: "waiting", reason: `A review step failed and will be retried: ${message}` };
  };

  // Read GitHub at most once per poll interval: the producer tick runs every
  // few seconds. Between polls the last polled outcome stands, so a blocked
  // step's escalation does not flap back to a plain wait.
  if (step.last_polled_at && now.getTime() - Date.parse(step.last_polled_at) < pollIntervalMs) {
    const last = parseOutcome(step.last_outcome_json);
    if (last?.kind === "blocked") return last;
    return { kind: "waiting", reason: last ? `Waiting for the next pull-request poll (last: ${last.reason})` : "Waiting for the next pull-request poll." };
  }
  update({ last_polled_at: at });
  step = read();
  const outcome = ((): ReviewStepOutcome => {
    const viewed = runCommand({
      command: "gh",
      args: ["pr", "view", url, "--json", "state,isDraft,headRefName,headRefOid,mergeStateStatus,statusCheckRollup"],
      cwd: repoRoot,
      timeoutMs: 30_000
    });
    if (viewed.status !== 0) return fail(`gh pr view ${url} failed: ${viewed.error ?? (viewed.stderr.trim() || `exit ${String(viewed.status)}`)}`);
    let pr: PullRequestView;
    try {
      pr = JSON.parse(viewed.stdout) as PullRequestView;
      if (typeof pr.headRefOid !== "string" || !/^[0-9a-f]{40,64}$/.test(pr.headRefOid) || typeof pr.state !== "string"
        || !Array.isArray(pr.statusCheckRollup)) throw new Error("required fields are absent or malformed");
    } catch (error) {
      return fail(`gh pr view ${url} returned unusable evidence: ${errorMessage(error)}`);
    }

    if (pr.state.toUpperCase() !== "OPEN" || pr.headRefName !== session.branch) {
      return {
        kind: "blocked",
        code: "review_pull_request_unavailable",
        reason: `PR ${url} is ${pr.state} on ${pr.headRefName}, not an open PR for the candidate branch ${session.branch}; no verdict is requested.`,
        remedy: `Reopen ${url} for ${session.branch} (or review and land the candidate by hand); the next tick resumes.`
      };
    }

    if (pr.headRefOid !== head) {
      // A settlement commit landed after preservation pushed the PR: publish the
      // exact settled head (a fast-forward of the agent branch) before any
      // verdict. Anything else is a moved head and never receives a verdict.
      if (!isAncestor(repoRoot, pr.headRefOid, head)) {
        return {
          kind: "blocked",
          code: "review_head_moved",
          reason: `PR ${url} head ${pr.headRefOid.slice(0, 12)} is not the settled candidate head ${head.slice(0, 12)} or an ancestor of it; a moved head never receives a verdict.`,
          remedy: `Restore ${session.branch} on the remote to ${head} (or let a new Session produce a new candidate); the next tick resumes.`
        };
      }
      const fenced = authorityChanged();
      if (fenced) return { kind: "waiting", reason: `Withheld pushing the settled head: ${fenced}.` };
      try {
        (deps.remote ?? systemPreservationRemote).push({ repositoryPath: repoRoot, branch: session.branch });
      } catch (error) {
        return fail(`Pushing the settled head of ${session.branch} failed: ${errorMessage(error)}`);
      }
      update({ pushed_at: at });
      input.log?.(`Pushed settled head ${head.slice(0, 12)} of ${session.branch} for ${actionKey}; PR ${url} showed ${pr.headRefOid.slice(0, 12)}.`);
      return { kind: "advanced", step: "pushed", reason: `Pushed the settled head ${head.slice(0, 12)} to ${url}.` };
    }

    if (pr.isDraft) {
      const fenced = authorityChanged();
      if (fenced) return { kind: "waiting", reason: `Withheld marking the PR ready: ${fenced}.` };
      const ready = runCommand({ command: "gh", args: ["pr", "ready", url], cwd: repoRoot, timeoutMs: 30_000 });
      if (ready.status !== 0) return fail(`gh pr ready ${url} failed: ${ready.error ?? (ready.stderr.trim() || `exit ${String(ready.status)}`)}`);
      update({ ready_at: at, checks_started_at: step.checks_started_at ?? at });
      input.log?.(`Marked ${url} ready for review at ${head.slice(0, 12)} for ${actionKey}.`);
      return { kind: "advanced", step: "ready", reason: `Marked ${url} ready for review.` };
    }
    if (!step.checks_started_at) {
      update({ checks_started_at: at });
      step = read();
    }

    const checks = classifyPullRequestChecks(pr.statusCheckRollup);
    if (checks.state === "failed") {
      return {
        kind: "blocked",
        code: "required_checks_failed",
        reason: `Required checks on ${url} at ${head.slice(0, 12)} did not succeed: ${checks.blockers.join(" ")}`,
        remedy: "A failed check needs a fix (a new candidate head) or a GitHub re-run of the check; the tick keeps polling and reviews as soon as every check is green. No reviewer runs meanwhile."
      };
    }
    if (["DIRTY", "BLOCKED"].includes(pr.mergeStateStatus?.toUpperCase() ?? "")) {
      return {
        kind: "blocked",
        code: "review_pull_request_unavailable",
        reason: `PR ${url} merge state is ${String(pr.mergeStateStatus)}; \`arcadia qa pr\` refuses to review it.`,
        remedy: "Resolve the PR's conflict or branch-protection block; the tick keeps polling."
      };
    }
    if (checks.state !== "green") {
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

    // Checks are green on the exact settled head: the next missing verdict, one per tick.
    for (const role of INDEPENDENT_VERDICT_ROLES) {
      const latest = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
      const sameBinding = latest !== null && latest.target_head === head
        && latest.criteria_fingerprint === readiness.binding.criteriaFingerprint
        && latest.evidence_fingerprint === readiness.binding.evidenceFingerprint;
      if (sameBinding && latest.status === "passed") continue;
      const rerun = sameBinding && latest.status === "failed";
      if (rerun && step.retry_role !== role) {
        return {
          kind: "blocked",
          code: "independent_verdict_failed",
          reason: `The independent ${role} verdict on ${head.slice(0, 12)} failed; a failed verdict never integrates.`,
          remedy: `Read the ${role} report Artifact for ${url}; fix the candidate (a new head is reviewed afresh) or, after judging the failure wrong, rerun it with \`arcadia ${role === "qa" ? "qa pr" : "qa code-review"} ${url} --rerun\`.`
        };
      }
      const fenced = authorityChanged();
      if (fenced) return { kind: "waiting", reason: `Withheld the ${role} reviewer: ${fenced}.` };
      input.heartbeat?.();
      let result: ReturnType<typeof runQaPrReviewCommand>;
      try {
        result = runQaPrReviewCommand(
          { workspace: input.workspace, pullRequest: url, role, rerun },
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
        return fail(`${role} review of ${url} failed: ${errorMessage(error)}`, role);
      } finally {
        input.heartbeat?.();
      }
      const unavailable = reviewerUnavailableReason(result.data);
      if (unavailable) return fail(`${role} reviewer unavailable for ${url}: ${unavailable}`, role);
      if (result.data.verdict !== "pass") {
        input.log?.(`Independent ${role} of ${actionKey} at ${head.slice(0, 12)}: ${result.data.verdict}.`);
        return {
          kind: "blocked",
          code: "independent_verdict_failed",
          reason: `The independent ${role} verdict on ${head.slice(0, 12)} is ${result.data.verdict}: ${result.data.summary}`,
          remedy: `Read ${result.data.reportPath}; fix the candidate (a new head is reviewed afresh) or, after judging the verdict wrong, rerun it with \`arcadia ${role === "qa" ? "qa pr" : "qa code-review"} ${url} --rerun\`.`
        };
      }
      if (step.retry_role === role) update({ retry_role: null });
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
