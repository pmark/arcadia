import type Database from "better-sqlite3";
import { classifyAuthorityPaths, type AuthorityBoundary } from "../decisions/batchMerge.js";
import { isAncestor, tryGit } from "../git/worktrees.js";
import { runHostCommand, type QaPrReviewDependencies } from "../qa/prReview.js";
import type { AgentSession } from "../sessions/index.js";
import { INDEPENDENT_VERDICT_ROLES, latestRoleAttempt } from "../sessions/enrollment.js";
import { getSessionExitReceipt } from "../sessions/reconciliation.js";
import { MAX_VERDICT_ATTEMPTS } from "../sessions/roleLineage.js";
import type { GuardedLaunchInput, GuardedLaunchResult } from "../sessions/launch.js";
import {
  ensureReviewRepairTable,
  getReviewRepair,
  launchedRepairRounds,
  MAX_REVIEW_REPAIR_ROUNDS,
  renderRepairFindings,
  reviewRepairRequestId,
  type ReviewRepairCheck,
  type ReviewRepairFinding,
  type ReviewRepairOutcome,
  type ReviewRepairRow
} from "../sessions/reviewRepair.js";
import { realFailedVerdict } from "./independentReview.js";
import { policyAuthorizesPullRequestReadiness, readProductionPolicySafely } from "./policy.js";

/**
 * The production worker's review repair loop.
 *
 * When an independent code review or QA of a managed candidate's exact
 * settled head records a reviewer's real non-pass judgment (never reviewer
 * unavailability or variance), the tick used to record it and stop. Under an
 * Active production policy whose scope names the Action, with remote
 * preservation and a current Decision 0058 integration grant (exactly what the
 * unattended review itself requires), this step instead:
 *
 * 1. returns the failed PR to draft and posts ONE comment with the verdict, the
 *    reviewer's ordered findings and what happens next, once per failed head,
 *    so nobody merges a candidate whose review failed;
 * 2. stops for the operator (one escalation) when the verdict is
 *    authority-adjacent (any failed Security-and-authority or
 *    Approval-boundaries check, or a finding about authority), when the
 *    candidate is on Decision 0098's gate list (checked-in authority paths,
 *    launch-authority and repair-loop code, deleted or skipped tests, a changed
 *    check threshold), when no verdict attempt is left to review a repaired
 *    head, when its PR is no longer open, or when this run
 *    already spent its {@link MAX_REVIEW_REPAIR_ROUNDS} repair rounds for the
 *    Action;
 * 3. otherwise launches a repair Session for the same Action through the
 *    ordinary guarded standing-policy launch, on a NEW branch cut from the
 *    failed candidate's work before its completion settlement, with the
 *    findings in its brief. The failed candidate's accepted exit is superseded
 *    in the same transaction, so terminal recovery and the pointer hold follow
 *    the repair; the repaired head is preserved, settled under a fresh Ask,
 *    pushed, re-reviewed from scratch and integrated by the unchanged steps.
 *
 * Authority: launching a Session for an in-scope Action is existing standing
 * production authority (Decision 0072 delegation and the scope); Decision 0098
 * chose bounded review-repair (at most three rounds, receipted, gated) for
 * operator launches, and this applies the same bound to the worker. Nothing
 * here merges, pushes a base or widens any scope.
 */

type RunCommand = NonNullable<QaPrReviewDependencies["runCommand"]>;

export const REVIEW_REPAIR_ROUNDS_EXHAUSTED = "review_repair_rounds_exhausted";
export const REVIEW_REPAIR_GATED = "review_repair_gated";
export const REVIEW_REPAIR_ESCALATIONS: ReadonlySet<string> = new Set([REVIEW_REPAIR_ROUNDS_EXHAUSTED, REVIEW_REPAIR_GATED]);

export type ReviewRepairStep =
  | { kind: "not_applicable"; reason: string }
  | { kind: "launched"; sessionId: string; round: number; reason: string }
  | { kind: "stopped"; escalation: string; reason: string }
  | { kind: "waiting"; reason: string };

export interface ReviewRepairInput {
  db: Database.Database;
  repoRoot: string;
  /** The failed candidate's (terminal, accepted) Session. */
  session: AgentSession;
  now: Date;
  log?: (message: string) => void;
  /** `gh` for the draft and the comment; the review step's own runner. */
  runCommand?: RunCommand;
  /** The guarded standing-policy launch, carrying the repair. */
  launch: (repair: NonNullable<GuardedLaunchInput["repair"]>) => GuardedLaunchResult;
  /** Records (deduped) the one operator escalation when the loop stops. */
  escalate: (kind: string, message: string, remedy: string) => void;
}

/** Paths the candidate's own commits change, with the completion Ask records themselves left out. */
function agentChangedPaths(repoRoot: string, from: string, to: string): string[] | null {
  const output = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", `${from}...${to}`]);
  if (output === null) return null;
  return output.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith(".arcadia/asks/"));
}

const AUTHORITY_TEXT = /\b(authority|authori[sz]ation|approval[- ]boundar|credential|secret|permission|privilege|branch protection)/i;

/**
 * Whether the reviewer flagged the verdict authority-adjacent (Decision 0098:
 * "the review flags authority"): a finding that names authority, credentials
 * or approval boundaries, or ANY failed Security-and-authority or
 * Approval-boundaries check, whatever else failed with it.
 */
export function verdictIsAuthorityAdjacent(findings: ReviewRepairFinding[], checks: ReviewRepairCheck[]): string | null {
  const flagged = findings.find((finding) => AUTHORITY_TEXT.test(`${finding.title} ${finding.recommendation}`));
  if (flagged) return `the reviewer's finding "${flagged.title}" concerns authority`;
  const failed = checks.find((check) => /security and authority|approval boundar/i.test(check.name) && check.status === "fail");
  if (failed) return `the reviewer failed the ${failed.name} criterion`;
  return null;
}

/**
 * Launch-authority and loop code the batch-merge classifier does not name:
 * Decision 0098's gate list includes "launch-authority code" and the code
 * implementing this loop and its gates, so a candidate changing any of it is
 * never repaired unattended.
 */
export const REPAIR_GATED_PATHS: readonly string[] = [
  "src/sessions/launch.ts",
  "src/sessions/enrollment.ts",
  "src/sessions/roleLineage.ts",
  "src/sessions/operatorLaunch.ts",
  "src/sessions/reviewRepair.ts",
  "src/production/reviewRepair.ts",
  "src/production/policy.ts",
  "src/production/workerMerge.ts",
  "src/production/independentReview.ts"
];

const TEST_PATH = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const SKIPPED_TEST = /\b(?:describe|it|test|suite)\.(?:skip|only|todo)\b|\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(|\bit\.fails\b/;
const THRESHOLD_FILE = /(^|\/)(vitest|vite|jest|playwright)\.config\.[cm]?[jt]s$|(^|\/)(package\.json|\.c8rc(\.json)?|\.nycrc(\.json)?|codecov\.ya?ml)$|(^|\/)\.github\//i;
const THRESHOLD_LINE = /threshold|coverage|minimum|maxWorkers|timeout|retries|bail/i;

/**
 * The rest of Decision 0098's gate list over the candidate's own change
 * (`from...to`): deleted test files, an added skip/only/todo marker, or a
 * changed line about a check threshold in test or CI configuration. Each
 * entry names what it found; unreadable Git is itself a gate.
 */
export function testWeakeningGates(repoRoot: string, from: string, to: string): string[] {
  const reasons: string[] = [];
  const deleted = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--diff-filter=D", "--name-only", `${from}...${to}`]);
  const patch = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", "-U0", `${from}...${to}`]);
  if (deleted === null || patch === null) return ["the candidate's diff could not be read"];
  const deletedTests = deleted.split("\n").map((line) => line.trim()).filter((file) => file && TEST_PATH.test(file));
  if (deletedTests.length > 0) reasons.push(`it deletes test files (${deletedTests.join(", ")})`);
  let file = "";
  const skipped = new Set<string>();
  const thresholds = new Set<string>();
  for (const line of patch.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) { file = header[1]; continue; }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+") && TEST_PATH.test(file) && SKIPPED_TEST.test(line)) skipped.add(file);
    if ((line.startsWith("+") || line.startsWith("-")) && THRESHOLD_FILE.test(file) && THRESHOLD_LINE.test(line)) thresholds.add(file);
  }
  if (skipped.size > 0) reasons.push(`it adds a skipped or focused test (${[...skipped].join(", ")})`);
  if (thresholds.size > 0) reasons.push(`it changes a check threshold or test/CI configuration (${[...thresholds].join(", ")})`);
  return reasons;
}

/** Every gate on the candidate's own change, as one reason, or null. */
function changeGate(repoRoot: string, from: string, to: string): string | null {
  const paths = agentChangedPaths(repoRoot, from, to);
  if (paths === null) return "the candidate's changed paths could not be read";
  const boundaries: AuthorityBoundary[] = paths.length > 0 ? classifyAuthorityPaths(paths) : [];
  const launchCode = paths.filter((file) => REPAIR_GATED_PATHS.includes(file));
  const reasons: string[] = [];
  if (boundaries.length > 0) reasons.push(`it touches checked-in authority boundaries (${boundaries.join(", ")})`);
  if (launchCode.length > 0) reasons.push(`it changes launch-authority or repair-loop code (${launchCode.join(", ")})`);
  reasons.push(...testWeakeningGates(repoRoot, from, to));
  return reasons.length > 0 ? reasons.join("; ") : null;
}

/** Verdict attempts each role still has for this requirement input; a repair round needs one of each. */
function verdictAttemptsRemaining(db: Database.Database, attempt: { requirement_id: string; input_revision: string }): { role: string; remaining: number } {
  let tightest = { role: "code-review", remaining: MAX_VERDICT_ATTEMPTS };
  for (const role of INDEPENDENT_VERDICT_ROLES) {
    const latest = latestRoleAttempt(db, attempt.requirement_id, attempt.input_revision, role);
    const remaining = MAX_VERDICT_ATTEMPTS - (latest?.ordinal ?? 0);
    if (remaining < tightest.remaining) tightest = { role, remaining };
  }
  return tightest;
}

function reviewContext(db: Database.Database, receiptJson: string | null): {
  verdict: string; summary: string; reportPath: string | null; findings: ReviewRepairFinding[]; checks: ReviewRepairCheck[];
} {
  let decisionId: string | null = null;
  let verdict = "fail";
  try {
    const receipt = JSON.parse(receiptJson ?? "{}") as { decisionId?: unknown; verdict?: unknown };
    decisionId = typeof receipt.decisionId === "string" ? receipt.decisionId : null;
    if (typeof receipt.verdict === "string") verdict = receipt.verdict;
  } catch { /* unknown below */ }
  const row = decisionId ? db.prepare("SELECT context_json FROM review_items WHERE id = ?").get(decisionId) as { context_json: string } | undefined : undefined;
  try {
    const context = JSON.parse(row?.context_json ?? "{}") as { verdict?: string; summary?: string; reportPath?: string; findings?: ReviewRepairFinding[]; checks?: ReviewRepairCheck[] };
    return {
      verdict: context.verdict ?? verdict,
      summary: context.summary ?? "(no summary recorded)",
      reportPath: context.reportPath ?? null,
      findings: Array.isArray(context.findings) ? context.findings : [],
      checks: Array.isArray(context.checks) ? context.checks.filter((check) => check.status !== "pass" && check.status !== "not-applicable") : []
    };
  } catch {
    return { verdict, summary: "(the reviewer's report could not be read)", reportPath: null, findings: [], checks: [] };
  }
}

function workerPullRequestUrl(db: Database.Database, sessionId: string): string | null {
  try {
    const row = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?")
      .get(`worker-tick-preserve-${sessionId}`) as { receipt_json: string } | undefined;
    return row ? (JSON.parse(row.receipt_json) as { pullRequestUrl?: string | null }).pullRequestUrl ?? null : null;
  } catch {
    return null;
  }
}

/** The one PR comment for a failed head: the verdict, the ordered findings and what the worker does next. */
export function renderFailedVerdictComment(row: ReviewRepairRow): string {
  const next = row.outcome === "escalated"
    ? `**Do not merge: escalated to the operator.** ${row.reason ?? `The ${MAX_REVIEW_REPAIR_ROUNDS} repair rounds for this Action are spent.`}`
    : row.outcome === "gated"
      ? `**Do not merge: escalated to the operator.** ${row.reason ?? "A gate stops the repair loop."}`
      : `**Do not merge: the repair loop will push a fixed head (round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS})** on a new branch and pull request for this Action; that head is reviewed again from scratch.`;
  return [
    `Arcadia worker: the independent ${row.role} verdict on \`${row.failed_head}\` is **${row.verdict}**, so this candidate is returned to draft and never integrates.`,
    "",
    `Summary: ${row.summary}`,
    "",
    `Findings, in the reviewer's order (report Artifact \`${row.report_path ?? "unavailable"}\` in the Arcadia workspace):`,
    ...renderRepairFindings(row),
    "",
    next
  ].join("\n");
}

/** Consecutive draft/comment failures on one failed PR before the loop stops for the operator. */
export const MAX_NOTIFY_FAILURES = 5;

const commandError = (result: { status: number | null; error?: string | null; stderr: string }) =>
  result.error ?? (result.stderr.trim() || `exit ${String(result.status)}`);

/**
 * Return the failed PR to draft, then post its one comment: each once per
 * failed head, recorded on the repair row, so a restart repeats neither. The
 * policy is re-read before each side effect. A PR that is no longer open is
 * a gated stop (a merged one most of all). Returns an error, or null.
 */
function notifyPullRequest(db: Database.Database, row: ReviewRepairRow, input: { repoRoot: string; now: Date; runCommand: RunCommand; authorized: () => string | null }): string | null {
  const url = row.pull_request_url;
  if (!url || row.notify_failures >= MAX_NOTIFY_FAILURES) return null;
  const at = input.now.toISOString();
  const mark = (column: "drafted_at" | "commented_at") =>
    db.prepare(`UPDATE production_review_repairs SET ${column} = ?, last_error = NULL, notify_failures = 0, updated_at = ? WHERE request_id = ?`).run(at, at, row.request_id);
  if (!row.drafted_at) {
    const viewed = input.runCommand({ command: "gh", args: ["pr", "view", url, "--json", "state"], cwd: input.repoRoot, timeoutMs: 30_000 });
    if (viewed.status !== 0) return `gh pr view ${url} failed: ${commandError(viewed)}`;
    let state = "UNKNOWN";
    try { state = String((JSON.parse(viewed.stdout) as { state?: unknown }).state ?? "UNKNOWN").toUpperCase(); } catch { /* UNKNOWN */ }
    if (state !== "OPEN") {
      const reason = state === "MERGED"
        ? `PR ${url} was MERGED although its independent ${row.role} verdict failed; the failed head may already be on the base.`
        : `PR ${url} is ${state}, so the worker cannot return it to draft or comment on it.`;
      db.prepare("UPDATE production_review_repairs SET outcome = 'gated', reason = ?, notify_failures = ?, updated_at = ? WHERE request_id = ? AND repair_session_id IS NULL")
        .run(reason, MAX_NOTIFY_FAILURES, at, row.request_id);
      return null;
    }
    const fenced = input.authorized();
    if (fenced) return `withheld returning ${url} to draft: ${fenced}`;
    const undone = input.runCommand({ command: "gh", args: ["pr", "ready", url, "--undo"], cwd: input.repoRoot, timeoutMs: 30_000 });
    if (undone.status !== 0) return `gh pr ready ${url} --undo failed: ${commandError(undone)}`;
    mark("drafted_at");
  }
  if (!row.commented_at) {
    const fenced = input.authorized();
    if (fenced) return `withheld the verdict comment on ${url}: ${fenced}`;
    const commented = input.runCommand({ command: "gh", args: ["pr", "comment", url, "--body", renderFailedVerdictComment(row)], cwd: input.repoRoot, timeoutMs: 30_000 });
    if (commented.status !== 0) return `gh pr comment ${url} failed: ${commandError(commented)}`;
    mark("commented_at");
  }
  return null;
}

/**
 * One review repair step for a terminal candidate whose exact head carries a
 * real failed verdict. Called by the tick only when terminal recovery refused
 * that candidate on `independent_verdict_failed` and no Session holds the
 * repository. At most one launch.
 */
export function attemptReviewRepair(input: ReviewRepairInput): ReviewRepairStep {
  const { db, repoRoot, session, now } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const exit = getSessionExitReceipt(db, session.id);
  if (exit?.outcome !== "accepted_completion" || exit.superseded_by_session_id !== null) {
    return { kind: "not_applicable", reason: `The candidate's exit is ${exit ? `${exit.outcome}${exit.superseded_by_session_id ? `, superseded by ${exit.superseded_by_session_id}` : ""}` : "unrecorded"}, not an unsuperseded accepted completion.` };
  }
  const failed = realFailedVerdict(db, { session, repoRoot });
  if (!failed) return { kind: "not_applicable", reason: "No real failed independent verdict is recorded on the candidate's current head." };
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok" || policyRead.policy.desiredState !== "active" || !policyRead.policy.scope) {
    return { kind: "not_applicable", reason: "Managed production is not Active." };
  }
  const policy = policyRead.policy;
  const scope = policy.scope!;
  if (!scope.projects.includes(session.project_slug) || !scope.plans.includes(`${session.project_slug}/${session.plan_slug}`) || !scope.actions.includes(actionKey)) {
    return { kind: "not_applicable", reason: `${actionKey} is outside the Active production scope.` };
  }
  const authorizedNow = (): string | null => {
    const current = readProductionPolicySafely(db);
    if (current.status !== "ok" || current.policy.desiredState !== "active") return "managed production is Off";
    if (current.policy.epoch !== policy.epoch) return `the production epoch changed (${policy.epoch} -> ${current.policy.epoch})`;
    const authorized = policyAuthorizesPullRequestReadiness(current.policy, actionKey, now);
    return authorized.authorized ? null : authorized.reason;
  };
  const unauthorized = authorizedNow();
  if (unauthorized) return { kind: "not_applicable", reason: `The worker may not repair this candidate: ${unauthorized}` };

  ensureReviewRepairTable(db);
  const requestId = reviewRepairRequestId(session.id, failed.head);
  let row = getReviewRepair(db, requestId);
  if (!row) {
    const context = reviewContext(db, failed.attempt.terminal_receipt_json);
    const start = tryGit(repoRoot, ["rev-parse", "--verify", `${failed.head}^1`]);
    if (!start || !isAncestor(repoRoot, session.base_revision, start)) {
      return { kind: "not_applicable", reason: `The failed head ${failed.head.slice(0, 12)} has no pre-settlement parent descending from the candidate's base ${session.base_revision.slice(0, 12)}.` };
    }
    let outcome: ReviewRepairOutcome = "pending";
    let reason: string | null = null;
    const adjacent = verdictIsAuthorityAdjacent(context.findings, context.checks);
    const gate = adjacent ? null : changeGate(repoRoot, session.base_revision, start);
    const rounds = launchedRepairRounds(db, actionKey, policy.epoch);
    if (adjacent) {
      outcome = "gated"; reason = `The verdict is authority-adjacent (${adjacent}); a repair is never launched unattended for it.`;
    } else if (gate) {
      outcome = "gated"; reason = `The candidate is on Decision 0098's gate list: ${gate}. The repair loop stops for the operator.`;
    } else if (rounds >= MAX_REVIEW_REPAIR_ROUNDS) {
      outcome = "escalated"; reason = `The ${MAX_REVIEW_REPAIR_ROUNDS} repair rounds for ${actionKey} in this production run (epoch ${policy.epoch}) are spent, and the latest repaired head still failed.`;
    }
    const at = now.toISOString();
    db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
        start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome, reason,
        last_error, drafted_at, commented_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?) ON CONFLICT(request_id) DO NOTHING`)
      .run(requestId, actionKey, policy.epoch, Math.min(rounds + 1, MAX_REVIEW_REPAIR_ROUNDS), session.id, session.branch, failed.head, start,
        workerPullRequestUrl(db, session.id), failed.role, context.verdict, context.summary, context.reportPath,
        JSON.stringify(context.findings), JSON.stringify(context.checks), outcome, reason, at, at);
    row = getReviewRepair(db, requestId)!;
    input.log?.(`Review repair for ${actionKey} at ${failed.head.slice(0, 12)}: ${outcome === "pending" ? `round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS}` : `${outcome}: ${reason}`}.`);
  }
  // Re-judged every tick while pending: the repaired head needs a fresh code
  // review and QA, and the role lineage bounds both per requirement input.
  if (row.outcome === "pending") {
    const verdicts = verdictAttemptsRemaining(db, failed.attempt);
    if (verdicts.remaining < 1) {
      const reason = `No independent ${verdicts.role} attempt remains for this Action input (${MAX_VERDICT_ATTEMPTS} per role), so a repaired head could never be reviewed.`;
      db.prepare("UPDATE production_review_repairs SET outcome = 'escalated', reason = ?, updated_at = ? WHERE request_id = ? AND repair_session_id IS NULL")
        .run(reason, now.toISOString(), requestId);
      row = getReviewRepair(db, requestId)!;
      input.log?.(`Review repair for ${actionKey} at ${failed.head.slice(0, 12)}: escalated: ${reason}`);
    }
  }

  // Visible on GitHub before anything else: draft and one comment per failed head.
  const notifyError = notifyPullRequest(db, row, { repoRoot, now, runCommand: input.runCommand ?? runHostCommand, authorized: authorizedNow });
  row = getReviewRepair(db, requestId)!;
  if (notifyError) {
    const failures = row.notify_failures + 1;
    const exhausted = failures >= MAX_NOTIFY_FAILURES;
    db.prepare(`UPDATE production_review_repairs SET last_error = ?, notify_failures = ?, updated_at = ?${exhausted ? ", outcome = CASE WHEN repair_session_id IS NULL THEN 'gated' ELSE outcome END, reason = ?" : ""} WHERE request_id = ?`)
      .run(...[notifyError, failures, now.toISOString(), ...(exhausted ? [`The failed PR could not be returned to draft and commented on after ${failures} attempts: ${notifyError}`] : []), requestId]);
    if (row.last_error !== notifyError || exhausted) input.log?.(`Review repair for ${actionKey}: ${notifyError}; ${exhausted ? "stopping for the operator" : "retried next tick"}.`);
    row = getReviewRepair(db, requestId)!;
    if (!exhausted) return { kind: "waiting", reason: notifyError };
  }

  const findings = renderRepairFindings(row).join("\n");
  if (row.outcome === "gated" || row.outcome === "escalated") {
    const escalation = row.outcome === "gated" ? REVIEW_REPAIR_GATED : REVIEW_REPAIR_ROUNDS_EXHAUSTED;
    input.escalate(escalation,
      `The independent ${row.role} verdict on ${row.failed_head.slice(0, 12)} is ${row.verdict}; ${row.reason ?? "the repair loop stopped"} Findings (report ${row.report_path ?? "unavailable"}):\n${findings}`,
      `Read the report and the findings above; fix the candidate yourself (a new head is reviewed afresh), or, after judging the verdict wrong, mark ${row.pull_request_url ?? "its PR"} ready and rerun it with \`arcadia ${row.role === "qa" ? "qa pr" : "qa code-review"} ${row.pull_request_url ?? "<PR>"} --rerun\`. Nothing integrates meanwhile.`);
    return { kind: "stopped", escalation, reason: row.reason ?? row.outcome };
  }
  if (row.outcome !== "pending") return { kind: "not_applicable", reason: `The repair for this failed head is already ${row.outcome}.` };

  const result = input.launch({
    requestId,
    failedSessionId: session.id,
    actionId: session.action_id,
    failedWorktreePath: session.worktree_path,
    startRevision: row.start_revision,
    baseRevision: session.base_revision,
    supersedesDevelopmentAttempt: failed.developerRequestId
  });
  input.log?.(`Launched repair Session ${result.session.id} for ${actionKey} (round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS}) from ${row.start_revision.slice(0, 12)}, the work under head ${row.failed_head.slice(0, 12)} before its completion settlement.`);
  return { kind: "launched", sessionId: result.session.id, round: row.round, reason: `Repair round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS} launched.` };
}

/**
 * Close each failed PR whose repair Session now has its own PR, with one
 * comment pointing at it, so the superseded head can never be merged by
 * mistake. Per Action under the same authority as the review step, re-read
 * per PR; a failure is retried next tick (logged once per error).
 */
export function closeSupersededPullRequests(db: Database.Database, input: { repoRoot: string; projectSlug: string; now: Date; runCommand?: RunCommand; log?: (message: string) => void }): number {
  ensureReviewRepairTable(db);
  const rows = db.prepare(`SELECT * FROM production_review_repairs
    WHERE outcome = 'launched' AND closed_at IS NULL AND pull_request_url IS NOT NULL AND repair_session_id IS NOT NULL AND action_key LIKE ?`)
    .all(`${input.projectSlug}/%`) as ReviewRepairRow[];
  let closed = 0;
  for (const row of rows) {
    const repairUrl = workerPullRequestUrl(db, row.repair_session_id!);
    if (!repairUrl) continue;
    const policy = readProductionPolicySafely(db);
    if (policy.status !== "ok" || policy.policy.desiredState !== "active" || !policyAuthorizesPullRequestReadiness(policy.policy, row.action_key, input.now).authorized) continue;
    const result = (input.runCommand ?? runHostCommand)({
      command: "gh",
      args: ["pr", "close", row.pull_request_url!, "--comment", `Superseded by ${repairUrl} (review repair round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS}); do not merge. The failed head \`${row.failed_head}\` never integrates.`],
      cwd: input.repoRoot,
      timeoutMs: 30_000
    });
    const at = input.now.toISOString();
    if (result.status !== 0) {
      const error = `gh pr close ${row.pull_request_url} failed: ${commandError(result)}`;
      if (row.last_error !== error) input.log?.(`Could not close the superseded PR for ${row.action_key}: ${error}; retried next tick.`);
      db.prepare("UPDATE production_review_repairs SET last_error = ?, updated_at = ? WHERE request_id = ?").run(error, at, row.request_id);
      continue;
    }
    db.prepare("UPDATE production_review_repairs SET closed_at = ?, last_error = NULL, updated_at = ? WHERE request_id = ?").run(at, at, row.request_id);
    input.log?.(`Closed ${row.pull_request_url} for ${row.action_key}: superseded by the repair PR ${repairUrl}.`);
    closed += 1;
  }
  return closed;
}
