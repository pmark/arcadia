import type Database from "better-sqlite3";
import { classifyAuthorityPaths, type AuthorityBoundary } from "../decisions/batchMerge.js";
import { isAncestor, tryGit } from "../git/worktrees.js";
import { runHostCommand, type QaPrReviewDependencies } from "../qa/prReview.js";
// A leaf module: importing these through prReview.js can see them undefined at
// load time through an import cycle (prReview -> ... -> reviewRepair).
import {
  CODE_REVIEW_PR_CRITERIA,
  NOT_APPLICABLE_CHECK_NAME,
  QA_PR_REVIEW_CRITERIA,
  REFUSED_NOT_APPLICABLE_FINDING_TITLE,
  REFUSED_NOT_APPLICABLE_RECOMMENDATION
} from "../qa/reviewCriteria.js";
import type { AgentSession } from "../sessions/index.js";
import { INDEPENDENT_VERDICT_ROLES, latestRoleAttempt } from "../sessions/enrollment.js";
import { getSessionExitReceipt } from "../sessions/reconciliation.js";
import { independentVerdictReadiness, MAX_VERDICT_ATTEMPTS } from "../sessions/roleLineage.js";
import type { GuardedLaunchInput, GuardedLaunchResult } from "../sessions/launch.js";
import {
  ensureReviewRepairTable,
  getReviewRepair,
  getSessionRepair,
  launchedRepairRounds,
  MAX_REVIEW_REPAIR_ROUNDS,
  renderRepairFindings,
  REQUIRED_CHECKS_ROLE,
  requiredChecksRepairRequestId,
  reviewRepairRequestId,
  type ReviewRepairCheck,
  type ReviewRepairFinding,
  type ReviewRepairOutcome,
  type ReviewRepairRow
} from "../sessions/reviewRepair.js";
import { realFailedVerdict, type RequiredChecksFailure } from "./independentReview.js";
import { policyAuthorizesPullRequestReadiness, readProductionPolicySafely, type ProductionPolicyRecord } from "./policy.js";

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
  /**
   * Launch guards the caller enforces (a provider sign-in hold, an exhausted
   * repair budget), asked before the pre-launch PR read so a launch that is
   * already forbidden spends no GitHub call: a reason withholds the launch.
   * The launch callback re-checks them.
   */
  canLaunch?: () => string | null;
  /** The guarded standing-policy launch, carrying the repair. */
  launch: (repair: NonNullable<GuardedLaunchInput["repair"]>) => GuardedLaunchResult;
  /** Records (deduped) the one operator escalation when the loop stops. */
  escalate: (kind: string, message: string, remedy: string) => void;
  /**
   * Set when the trigger is red required checks on the candidate's exact head
   * (`required_checks_failed`) rather than a reviewer's failed verdict.
   */
  checkFailure?: RequiredChecksFailure;
}

/** Paths the candidate's own commits change, with the completion Ask records themselves left out. */
function agentChangedPaths(repoRoot: string, from: string, to: string): string[] | null {
  const output = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", `${from}...${to}`]);
  if (output === null) return null;
  return output.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith(".arcadia/asks/"));
}

const AUTHORITY_TEXT = /\b(authority|authori[sz]ation|approval[- ]boundar|credential|secret|permission|privilege|branch protection)/i;

/** The authority criteria (prReview's VARIANCE_EXCLUDED_CRITERIA minus Correctness): any non-pass of one is never repaired unattended. */
const AUTHORITY_CRITERION = /^(security and authority|approval boundaries)$/i;
const isAuthorityCriterion = (name: string) => AUTHORITY_CRITERION.test(name.trim());
const KNOWN_CRITERIA: ReadonlySet<string> = new Set([...CODE_REVIEW_PR_CRITERIA, ...QA_PR_REVIEW_CRITERIA].map((criterion) => criterion.name));

/**
 * The criterion names a deterministic refused not-applicable finding refused,
 * or null when the finding is not that finding. It must be exactly what
 * src/qa/prReview.ts writes: its title prefix, its fixed recommendation, and
 * only known criterion names, so a reviewer-authored finding that borrows the
 * title is judged like any other finding.
 */
function refusedNotApplicableCriteria(finding: ReviewRepairFinding): string[] | null {
  const prefix = `${REFUSED_NOT_APPLICABLE_FINDING_TITLE}: `;
  if (!finding.title.startsWith(prefix) || finding.recommendation !== REFUSED_NOT_APPLICABLE_RECOMMENDATION) return null;
  const names = finding.title.slice(prefix.length).split(", ").map((name) => name.trim());
  return names.length > 0 && names.every((name) => KNOWN_CRITERIA.has(name)) ? names : null;
}

/**
 * Whether the reviewer flagged the verdict authority-adjacent (Decision 0098:
 * "the review flags authority"): a finding that names authority, credentials
 * or approval boundaries; a deterministic refusal of a not-applicable claim on
 * Security and authority or Approval boundaries; or ANY non-pass (failed,
 * not-checked or not-applicable) Security-and-authority or Approval-boundaries
 * check, whatever else failed with it.
 */
export function verdictIsAuthorityAdjacent(findings: ReviewRepairFinding[], checks: ReviewRepairCheck[]): string | null {
  for (const finding of findings) {
    const refused = refusedNotApplicableCriteria(finding);
    if (refused) {
      // Its title lists criterion names, not the reviewer's words: judge the names.
      const authority = refused.find(isAuthorityCriterion);
      if (authority) return `the deterministic patch check refused the reviewer's not-applicable claim on the ${authority} criterion`;
      continue;
    }
    if (AUTHORITY_TEXT.test(`${finding.title} ${finding.recommendation}`)) return `the reviewer's finding "${finding.title}" concerns authority`;
  }
  // A not-applicable authority criterion is no flag when the deterministic
  // Not-applicable claims check ran and passed (the claim was verified against
  // the patch); with that check missing or not passed it still gates.
  const naVerified = checks.some((check) => check.name === NOT_APPLICABLE_CHECK_NAME && check.status === "pass");
  const failed = checks.find((check) => isAuthorityCriterion(check.name) && check.status !== "pass" && !(check.status === "not-applicable" && naVerified));
  if (failed) return `the reviewer did not pass the ${failed.name} criterion (${failed.status})`;
  return null;
}

/**
 * Whether a repair Session could change the verdict: some reviewer finding
 * or failed criterion beyond the deterministic refusal of the reviewer's
 * not-applicable claims. That refusal alone judges the reviewer's claim, not
 * the candidate's work, so a repair round could only spend a Session on it.
 */
export function verdictIsRepairable(findings: ReviewRepairFinding[], checks: ReviewRepairCheck[]): boolean {
  return findings.some((finding) => refusedNotApplicableCriteria(finding) === null)
    || checks.some((check) => check.status === "fail" && check.name !== NOT_APPLICABLE_CHECK_NAME);
}

/** Why an unrepairable verdict ({@link verdictIsRepairable} false) stops the loop. */
export function unrepairableReason(findings: ReviewRepairFinding[], checks: ReviewRepairCheck[]): string {
  const refusal = findings.some((finding) => refusedNotApplicableCriteria(finding) !== null)
    || checks.some((check) => check.name === NOT_APPLICABLE_CHECK_NAME && check.status === "fail");
  return refusal
    ? "The verdict's only failure is the deterministic patch check refusing the reviewer's not-applicable claims; a repair Session cannot change the reviewer's claim, so the repair loop stops for the operator."
    : "The verdict records no reviewer finding or failed criterion a repair could address (an empty or unreadable report, or only not-checked criteria), so the repair loop stops for the operator.";
}

/**
 * Launch-authority and loop code the batch-merge classifier does not name:
 * Decision 0098's gate list includes "launch-authority code" and the code
 * implementing this loop and its gates, so a candidate changing any of it is
 * never repaired unattended. An entry ending in "/" gates the whole tree:
 * every module under `src/sessions/` prepares, launches, briefs, reconciles
 * or settles Sessions.
 */
export const REPAIR_GATED_PATHS: readonly string[] = [
  "src/sessions/",
  "src/production/reviewRepair.ts",
  "src/production/policy.ts",
  "src/production/workerMerge.ts",
  "src/production/independentReview.ts"
];

const isRepairGatedPath = (file: string) => REPAIR_GATED_PATHS.some((entry) => entry.endsWith("/") ? file.startsWith(entry) : file === entry);

const TEST_PATH = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
/**
 * A skipped, conditional, focused, to-do or expected-failure test in any of
 * the runners' spellings: a modifier anywhere in a member chain that starts
 * at describe/it/test/suite/bench (`it.skipIf(c)(...)`,
 * `test.concurrent.skip(...)`, `describe.sequential.only(...)`,
 * `test.fails(...)`, `describe.each(...).skip`), the x/f prefixes, and a
 * runtime skip (`ctx.skip()` with or without a condition, `this.skip()`, any
 * bare `.skip()`). A preceding `.` or word character never starts the chain,
 * so a regex `RE.test(x)` is neither a test nor a skip.
 */
const SKIPPED_TEST = /(?<![.\w])(?:describe|it|test|suite|bench)(?:\.\w+|\([^\n]*?\))*\.(?:skip|only|todo|fails|skipIf|runIf)\b|\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(|\bctx\.skip\(|\.skip\(\s*\)/;
/** One test case: `it(`, `test(`, or either with a modifier chain (`it.each(...)(` counts once). */
const TEST_CASE = /(?<![.\w])(?:it|test)(?:\.\w+)*\s*\(/g;
const THRESHOLD_FILE = /(^|\/)(vitest|vite|jest|playwright)\.config\.[cm]?[jt]s$|(^|\/)(package\.json|\.c8rc(\.json)?|\.nycrc(\.json)?|codecov\.ya?ml)$|(^|\/)\.github\//i;
const THRESHOLD_LINE = /threshold|coverage|minimum|maxWorkers|timeout|retries|bail/i;

const countCases = (content: string | null) => (content ?? "").match(TEST_CASE)?.length ?? 0;

/**
 * The rest of Decision 0098's gate list over the candidate's own change
 * (`from...to`): deleted test files, fewer test cases in a surviving test
 * file, an added skip/only/todo/fails/conditional marker, or a changed line
 * about a check threshold in test or CI configuration. Each entry names what
 * it found; unreadable Git is itself a gate.
 */
export function testWeakeningGates(repoRoot: string, from: string, to: string): string[] {
  const reasons: string[] = [];
  const mergeBase = tryGit(repoRoot, ["merge-base", from, to]);
  const deleted = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--diff-filter=D", "--name-only", `${from}...${to}`]);
  const modified = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--diff-filter=M", "--name-only", `${from}...${to}`]);
  const patch = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--no-color", "--no-ext-diff", "-U0", `${from}...${to}`]);
  if (!mergeBase || deleted === null || modified === null || patch === null) return ["the candidate's diff could not be read"];
  const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
  const deletedTests = lines(deleted).filter((file) => TEST_PATH.test(file));
  if (deletedTests.length > 0) reasons.push(`it deletes test files (${deletedTests.join(", ")})`);
  const fewer = lines(modified).filter((file) => TEST_PATH.test(file)).flatMap((file) => {
    const before = countCases(tryGit(repoRoot, ["show", `${mergeBase}:${file}`]));
    const after = countCases(tryGit(repoRoot, ["show", `${to}:${file}`]));
    return after < before ? [`${file}: ${before} -> ${after}`] : [];
  });
  if (fewer.length > 0) reasons.push(`it removes test cases (${fewer.join(", ")})`);
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

/**
 * Every Decision 0098 gate on a candidate's own change (`from...to`), as one
 * reason, or null: checked-in authority paths, launch-authority and
 * repair-loop code, and the test-weakening gates. Applied to the failed
 * candidate before a repair launches and to a repair's own candidate before
 * it is readied or reviewed.
 */
export function candidateChangeGate(repoRoot: string, from: string, to: string): string | null {
  const paths = agentChangedPaths(repoRoot, from, to);
  if (paths === null) return "the candidate's changed paths could not be read";
  const boundaries: AuthorityBoundary[] = paths.length > 0 ? classifyAuthorityPaths(paths) : [];
  const launchCode = paths.filter(isRepairGatedPath);
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
  /** `checks` plus the passed deterministic Not-applicable claims check, which only the authority judgement reads. */
  judgedChecks: ReviewRepairCheck[];
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
    const naPassed = Array.isArray(context.checks) ? context.checks.filter((check) => check.name === NOT_APPLICABLE_CHECK_NAME && check.status === "pass") : [];
    const stored = Array.isArray(context.checks)
      ? context.checks.filter((check) => check.status !== "pass" && (check.status !== "not-applicable" || isAuthorityCriterion(check.name)))
      : [];
    return {
      judgedChecks: [...stored, ...naPassed],
      verdict: context.verdict ?? verdict,
      summary: context.summary ?? "(no summary recorded)",
      reportPath: context.reportPath ?? null,
      findings: Array.isArray(context.findings) ? context.findings : [],
      // Every non-pass check, except a not-applicable one that is not an authority
      // criterion: a not-applicable Security-and-authority or Approval-boundaries
      // check gates (verdictIsAuthorityAdjacent), as it is never variance in prReview.
      checks: Array.isArray(context.checks)
        ? context.checks.filter((check) => check.status !== "pass" && (check.status !== "not-applicable" || isAuthorityCriterion(check.name)))
        : []
    };
  } catch {
    return { verdict, summary: "(the reviewer's report could not be read)", reportPath: null, findings: [], checks: [], judgedChecks: [] };
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
    row.role === REPAIR_CANDIDATE_GATE_ROLE
      ? `Arcadia worker: this repair candidate \`${row.failed_head}\` is on Decision 0098's gate list, so it stays a draft, is not reviewed and never integrates unattended.`
      : row.role === REQUIRED_CHECKS_ROLE
        ? `Arcadia worker: required checks on \`${row.failed_head}\` **${row.verdict}** in the candidate's own change (they pass on the base), so this candidate is returned to draft and never integrates.`
        : `Arcadia worker: the independent ${row.role} verdict on \`${row.failed_head}\` is **${row.verdict}**, so this candidate is returned to draft and never integrates.`,
    "",
    `Summary: ${row.summary}`,
    "",
    row.role === REQUIRED_CHECKS_ROLE
      ? "Failing tests, from the failed CI logs (`gh run view --log-failed`, bounded):"
      : `Findings, in the reviewer's order (report Artifact \`${row.report_path ?? "unavailable"}\` in the Arcadia workspace):`,
    ...(row.role === REQUIRED_CHECKS_ROLE ? ["```text", ...renderRepairFindings(row), "```"] : renderRepairFindings(row)),
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
    const viewed = input.runCommand({ command: "gh", args: ["pr", "view", url, "--json", "state,isDraft"], cwd: input.repoRoot, timeoutMs: 30_000 });
    if (viewed.status !== 0) return `gh pr view ${url} failed: ${commandError(viewed)}`;
    let state = "UNKNOWN";
    let isDraft = false;
    try {
      const view = JSON.parse(viewed.stdout) as { state?: unknown; isDraft?: unknown };
      state = String(view.state ?? "UNKNOWN").toUpperCase();
      isDraft = view.isDraft === true;
    } catch { /* UNKNOWN */ }
    if (state !== "OPEN") {
      const reason = state === "MERGED"
        ? `PR ${url} was MERGED although its independent ${row.role} verdict failed; the failed head may already be on the base.`
        : `PR ${url} is ${state}, so the worker cannot return it to draft or comment on it.`;
      db.prepare("UPDATE production_review_repairs SET outcome = 'gated', reason = ?, notify_failures = ?, updated_at = ? WHERE request_id = ? AND repair_session_id IS NULL")
        .run(reason, MAX_NOTIFY_FAILURES, at, row.request_id);
      return null;
    }
    if (!isDraft) {
      const fenced = input.authorized();
      if (fenced) return `withheld returning ${url} to draft: ${fenced}`;
      const undone = input.runCommand({ command: "gh", args: ["pr", "ready", url, "--undo"], cwd: input.repoRoot, timeoutMs: 30_000 });
      if (undone.status !== 0) return `gh pr ready ${url} --undo failed: ${commandError(undone)}`;
    }
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
  if (input.checkFailure) return attemptChecksRepair(input, input.checkFailure);
  const { db, repoRoot, session, now } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const exit = getSessionExitReceipt(db, session.id);
  if (exit?.outcome !== "accepted_completion" || exit.superseded_by_session_id !== null) {
    return { kind: "not_applicable", reason: `The candidate's exit is ${exit ? `${exit.outcome}${exit.superseded_by_session_id ? `, superseded by ${exit.superseded_by_session_id}` : ""}` : "unrecorded"}, not an unsuperseded accepted completion.` };
  }
  // Only a reviewer's real non-pass that is still the latest verdict of its
  // role, on the current requirement input, head, criteria and evidence: a
  // repair whose Session never started is set aside by the lineage, so a
  // pending repair is re-judged from the same facts every tick.
  const failed = realFailedVerdict(db, { session, repoRoot });
  if (!failed) {
    releaseStalePendingRepair(db, { session, repoRoot, now, log: input.log });
    return { kind: "not_applicable", reason: "No real failed independent verdict is recorded on the candidate's current head." };
  }
  const authority = repairAuthority(db, session, now);
  if ("notApplicable" in authority) return { kind: "not_applicable", reason: authority.notApplicable };
  const { policy, authorizedNow } = authority;

  ensureReviewRepairTable(db);
  const requestId = reviewRepairRequestId(session.id, failed.head);
  let row = getReviewRepair(db, requestId);
  // A row that never launched was judged on one verdict attempt. A newer failed
  // verdict on the same head (a reviewer rerun) is judged afresh from its own
  // context; a NULL record counts as different once the attempt is newer than
  // the row. A launched, escalated or released row is never re-judged.
  const verdictRequestId = failed.attempt.request_id;
  const rejudge = row !== null && (row.outcome === "gated" || row.outcome === "pending") && row.repair_session_id === null
    && row.verdict_request_id !== verdictRequestId
    && (row.verdict_request_id !== null || failed.attempt.created_at > row.created_at);
  if (!row || rejudge) {
    const context = reviewContext(db, failed.attempt.terminal_receipt_json);
    const start = row ? row.start_revision : tryGit(repoRoot, ["rev-parse", "--verify", `${failed.head}^1`]);
    if (!start || !isAncestor(repoRoot, session.base_revision, start)) {
      return { kind: "not_applicable", reason: `The failed head ${failed.head.slice(0, 12)} has no pre-settlement parent descending from the candidate's base ${session.base_revision.slice(0, 12)}.` };
    }
    let outcome: ReviewRepairOutcome = "pending";
    let reason: string | null = null;
    const adjacent = verdictIsAuthorityAdjacent(context.findings, context.judgedChecks);
    const gate = adjacent ? null : candidateChangeGate(repoRoot, session.base_revision, start);
    const rounds = launchedRepairRounds(db, actionKey, policy.epoch);
    if (adjacent) {
      outcome = "gated"; reason = `The verdict is authority-adjacent (${adjacent}); a repair is never launched unattended for it.`;
    } else if (gate) {
      outcome = "gated"; reason = `The candidate is on Decision 0098's gate list: ${gate}. The repair loop stops for the operator.`;
    } else if (!verdictIsRepairable(context.findings, context.checks)) {
      outcome = "gated"; reason = unrepairableReason(context.findings, context.checks);
    } else if (rounds >= MAX_REVIEW_REPAIR_ROUNDS) {
      outcome = "escalated"; reason = `The ${MAX_REVIEW_REPAIR_ROUNDS} repair rounds for ${actionKey} in this production run (epoch ${policy.epoch}) are spent, and the latest repaired head still failed.`;
    }
    const at = now.toISOString();
    if (!row) {
      db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
          start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome, reason,
          last_error, drafted_at, commented_at, created_at, updated_at, verdict_request_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`)
        .run(requestId, actionKey, policy.epoch, Math.min(rounds + 1, MAX_REVIEW_REPAIR_ROUNDS), session.id, session.branch, failed.head, start,
          workerPullRequestUrl(db, session.id), failed.role, context.verdict, context.summary, context.reportPath,
          JSON.stringify(context.findings), JSON.stringify(context.checks), outcome, reason, at, at, verdictRequestId);
    } else {
      // Fenced on never having launched; the new verdict is commented afresh.
      db.prepare(`UPDATE production_review_repairs SET policy_epoch = ?, round = ?, role = ?, verdict = ?, summary = ?, report_path = ?, findings_json = ?,
          failed_checks_json = ?, outcome = ?, reason = ?, verdict_request_id = ?, last_error = NULL, notify_failures = 0, drafted_at = NULL, commented_at = NULL, updated_at = ?
        WHERE request_id = ? AND outcome IN ('gated', 'pending') AND repair_session_id IS NULL`)
        .run(policy.epoch, Math.min(rounds + 1, MAX_REVIEW_REPAIR_ROUNDS), failed.role, context.verdict, context.summary, context.reportPath,
          JSON.stringify(context.findings), JSON.stringify(context.checks), outcome, reason, verdictRequestId, at, requestId);
    }
    row = getReviewRepair(db, requestId)!;
    input.log?.(`Review repair for ${actionKey} at ${failed.head.slice(0, 12)}${rejudge ? " re-judged from a newer verdict" : ""}: ${outcome === "pending" ? `round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS}` : `${outcome}: ${reason}`}.`);
  }
  return finishRepairStep(input, row, {
    policyEpoch: policy.epoch,
    authorizedNow,
    requirement: failed.attempt,
    developerRequestId: failed.developerRequestId,
    describe: (r) => `The independent ${r.role} verdict on ${r.failed_head.slice(0, 12)} is ${r.verdict};`,
    findingsLabel: (r) => `Findings (report ${r.report_path ?? "unavailable"})`,
    stoppedRemedy: (r) => `Read the report and the findings above; fix the candidate yourself (a new head is reviewed afresh), or, after judging the verdict wrong, mark ${r.pull_request_url ?? "its PR"} ready and rerun it with \`arcadia ${r.role === "qa" ? "qa pr" : "qa code-review"} ${r.pull_request_url ?? "<PR>"} --rerun\`. Nothing integrates meanwhile.`
  });
}

/** What differs between a failed-verdict repair and a red-required-checks repair in their shared last steps. */
interface RepairStepContext {
  policyEpoch: number;
  authorizedNow: () => string | null;
  /** The requirement input whose verdict attempts a repaired head would need. */
  requirement: { requirement_id: string; input_revision: string };
  developerRequestId: string;
  /** The failure in one clause, ending with ";". */
  describe: (row: ReviewRepairRow) => string;
  findingsLabel: (row: ReviewRepairRow) => string;
  /** The operator remedy when the loop stops on a gated or escalated row. */
  stoppedRemedy: (row: ReviewRepairRow) => string;
}

/**
 * The steps every repair row shares once it is decided: re-judging a pending
 * row under a new production epoch and against the remaining verdict
 * attempts, returning the PR to draft with its one comment, stopping once for
 * the operator, or launching the one repair Session.
 */
function finishRepairStep(input: ReviewRepairInput, decided: ReviewRepairRow, context: RepairStepContext): ReviewRepairStep {
  const { db, repoRoot, session, now } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const requestId = decided.request_id;
  let row = decided;
  // A pending row decided under an earlier production run (epoch) is
  // re-judged against THIS run's round count before it can launch, so a new
  // run never exceeds its own bound; fenced on the row never having launched.
  if (row.outcome === "pending" && row.policy_epoch !== context.policyEpoch) {
    const rounds = launchedRepairRounds(db, actionKey, context.policyEpoch);
    const exhausted = rounds >= MAX_REVIEW_REPAIR_ROUNDS;
    db.prepare(`UPDATE production_review_repairs SET policy_epoch = ?, round = ?, outcome = ?, reason = ?, updated_at = ?
      WHERE request_id = ? AND outcome = 'pending' AND repair_session_id IS NULL`)
      .run(context.policyEpoch, Math.min(rounds + 1, MAX_REVIEW_REPAIR_ROUNDS), exhausted ? "escalated" : "pending",
        exhausted ? `The ${MAX_REVIEW_REPAIR_ROUNDS} repair rounds for ${actionKey} in this production run (epoch ${context.policyEpoch}) are spent, and the latest repaired head still failed.` : null,
        now.toISOString(), requestId);
    row = getReviewRepair(db, requestId)!;
    input.log?.(`Review repair for ${actionKey} at ${row.failed_head.slice(0, 12)} re-judged under production epoch ${context.policyEpoch}: ${row.outcome === "pending" ? `round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS}` : row.outcome}.`);
  }
  // Re-judged every tick while pending: the repaired head needs a fresh code
  // review and QA, and the role lineage bounds both per requirement input.
  if (row.outcome === "pending") {
    const verdicts = verdictAttemptsRemaining(db, context.requirement);
    if (verdicts.remaining < 1) {
      const reason = `No independent ${verdicts.role} attempt remains for this Action input (${MAX_VERDICT_ATTEMPTS} per role), so a repaired head could never be reviewed.`;
      db.prepare("UPDATE production_review_repairs SET outcome = 'escalated', reason = ?, updated_at = ? WHERE request_id = ? AND repair_session_id IS NULL")
        .run(reason, now.toISOString(), requestId);
      row = getReviewRepair(db, requestId)!;
      input.log?.(`Review repair for ${actionKey} at ${row.failed_head.slice(0, 12)}: escalated: ${reason}`);
    }
  }

  // Visible on GitHub before anything else: draft and one comment per failed head.
  const notifyError = notifyPullRequest(db, row, { repoRoot, now, runCommand: input.runCommand ?? runHostCommand, authorized: context.authorizedNow });
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
      `${context.describe(row)} ${row.reason ?? "the repair loop stopped"} ${context.findingsLabel(row)}:\n${findings}`,
      context.stoppedRemedy(row));
    return { kind: "stopped", escalation, reason: row.reason ?? row.outcome };
  }
  if (row.outcome !== "pending") return { kind: "not_applicable", reason: `The repair for this failed head is already ${row.outcome}.` };

  const withheld = input.canLaunch?.() ?? null;
  if (withheld) return { kind: "waiting", reason: withheld };
  // The PR was read while drafting; a person may have closed or merged it
  // since. Re-read it right before the launch: a failed PR no longer open is
  // a gated stop, never a repair.
  if (row.pull_request_url) {
    const viewed = (input.runCommand ?? runHostCommand)({ command: "gh", args: ["pr", "view", row.pull_request_url, "--json", "state"], cwd: repoRoot, timeoutMs: 30_000 });
    if (viewed.status !== 0) {
      // The same bounded accounting as drafting and commenting.
      const error = `gh pr view ${row.pull_request_url} failed before the repair launch: ${commandError(viewed)}`;
      const failures = row.notify_failures + 1;
      const exhausted = failures >= MAX_NOTIFY_FAILURES;
      const reason = `The failed PR's state could not be read before the repair launch after ${failures} attempts: ${error}`;
      db.prepare(`UPDATE production_review_repairs SET last_error = ?, notify_failures = ?, updated_at = ?${exhausted ? ", outcome = 'gated', reason = ?" : ""}
        WHERE request_id = ? AND repair_session_id IS NULL`).run(...[error, failures, now.toISOString(), ...(exhausted ? [reason] : []), requestId]);
      if (row.last_error !== error || exhausted) input.log?.(`Review repair for ${actionKey}: ${error}; ${exhausted ? "stopping for the operator" : "retried next tick"}.`);
      if (!exhausted) return { kind: "waiting", reason: error };
      input.escalate(REVIEW_REPAIR_GATED,
        `${context.describe(row)} ${reason} ${context.findingsLabel(row)}:\n${findings}`,
        `Check that the GitHub CLI can read ${row.pull_request_url}, then decide the candidate yourself; nothing integrates meanwhile.`);
      return { kind: "stopped", escalation: REVIEW_REPAIR_GATED, reason };
    }
    let state = "UNKNOWN";
    try { state = String((JSON.parse(viewed.stdout) as { state?: unknown }).state ?? "UNKNOWN").toUpperCase(); } catch { /* UNKNOWN */ }
    if (state !== "OPEN") {
      const reason = state === "MERGED"
        ? `PR ${row.pull_request_url} was MERGED although ${row.role === REQUIRED_CHECKS_ROLE ? "its required checks failed" : `its independent ${row.role} verdict failed`}; the failed head may already be on the base.`
        : `PR ${row.pull_request_url} is ${state}: the failed PR is no longer open, so the repair loop stops for the operator.`;
      db.prepare("UPDATE production_review_repairs SET outcome = 'gated', reason = ?, updated_at = ? WHERE request_id = ? AND outcome = 'pending' AND repair_session_id IS NULL")
        .run(reason, now.toISOString(), requestId);
      input.escalate(REVIEW_REPAIR_GATED,
        `${context.describe(row)} ${reason} ${context.findingsLabel(row)}:\n${findings}`,
        `Check ${row.pull_request_url} and the base branch; the worker launches no repair for a PR that is no longer open. Nothing integrates meanwhile.`);
      return { kind: "stopped", escalation: REVIEW_REPAIR_GATED, reason };
    }
  }

  const result = input.launch({
    requestId,
    failedSessionId: session.id,
    actionId: session.action_id,
    failedWorktreePath: session.worktree_path,
    failedHead: row.failed_head,
    startRevision: row.start_revision,
    baseRevision: session.base_revision,
    supersedesDevelopmentAttempt: context.developerRequestId
  });
  input.log?.(`Launched repair Session ${result.session.id} for ${actionKey} (round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS}) from ${row.start_revision.slice(0, 12)}, the work under head ${row.failed_head.slice(0, 12)} before its completion settlement.`);
  return { kind: "launched", sessionId: result.session.id, round: row.round, reason: `Repair round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS} launched.` };
}

/* ------------------------------------------------------------------------ */
/* Red required checks attributed to the candidate's own change.             */
/* ------------------------------------------------------------------------ */

/** Bounds on the CI evidence carried into the PR comment, the escalation and the repair brief. */
const MAX_CHECK_FINDINGS = 10;
const MAX_EVIDENCE_LINES = 12;
const MAX_EVIDENCE_CHARS = 1_500;

// Control characters are exactly what this strips from CI logs; `gh run view
// --log-failed` prints ESC as the two characters `^[` when not on a terminal.
// eslint-disable-next-line no-control-regex
const ANSI = /(?:\u001b|\^\[)\[[0-9;?]*[A-Za-z]/g;
const LOG_TIMESTAMP = /^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
/** Vitest's per-test failure header: `FAIL  <file> > <suite> > <test>`. */
const FAILED_TEST = /\bFAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+>\s+(.+?)\s*$/;
const FAILURE_BLOCK_END = /^\s*⎯|\bFAIL\s+\S+\.(?:test|spec)\.|^\s*Test Files\b/;

/**
 * CI log text is untrusted data (test names and assertion values are whatever
 * the code under test printed): neutralized before it reaches a PR comment, a
 * ping or a repair brief, so it can neither mention anyone (`@`), open or
 * close code spans (backticks), nor carry control characters.
 */
export function neutralizeCiText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replaceAll("`", "'").replaceAll("@", "@\u200b");
}

export interface FailingTest {
  check: string;
  file: string;
  name: string;
  /** The assertion, expected/received and location lines that follow the header, bounded. */
  evidence: string;
}

/**
 * The failing vitest tests in `gh run view --log-failed` output, per job (the
 * log's first tab-separated column is the job, i.e. the check's name). Lines
 * without a job column continue the previous job's output.
 */
export function parseFailedTestLog(log: string): FailingTest[] {
  const byJob = new Map<string, string[]>();
  let job = "";
  for (const raw of log.split("\n")) {
    const parts = raw.split("\t");
    const text = (parts.length >= 3 ? parts.slice(2).join("\t") : raw).replace(ANSI, "").replace(LOG_TIMESTAMP, "");
    if (parts.length >= 3) job = parts[0];
    if (!job) continue;
    const lines = byJob.get(job) ?? [];
    lines.push(text);
    byJob.set(job, lines);
  }
  const tests: FailingTest[] = [];
  for (const [check, lines] of byJob) {
    const seen = new Set<string>();
    lines.forEach((line, index) => {
      const match = FAILED_TEST.exec(line);
      if (!match) return;
      const key = `${match[1]}\n${match[2]}`;
      if (seen.has(key)) return;
      seen.add(key);
      const evidence: string[] = [];
      for (const next of lines.slice(index + 1, index + 60)) {
        if (FAILURE_BLOCK_END.test(next)) break;
        if (next.trim()) evidence.push(next.trim());
        if (evidence.length >= MAX_EVIDENCE_LINES) break;
      }
      const text = neutralizeCiText(evidence.join(" | "));
      tests.push({ check, file: neutralizeCiText(match[1]), name: neutralizeCiText(match[2]), evidence: text.length > MAX_EVIDENCE_CHARS ? `${text.slice(0, MAX_EVIDENCE_CHARS - 1)}…` : text });
    });
  }
  return tests;
}

export type ChecksJudgement =
  | { kind: "waiting"; reason: string }
  | { kind: "judged"; repairable: boolean; reason: string | null; summary: string; findings: ReviewRepairFinding[]; checks: ReviewRepairCheck[] };

const runIdOf = (url: string | null) => /\/actions\/runs\/(\d+)/.exec(url ?? "")?.[1] ?? null;

/**
 * Whether red required checks on a candidate's exact head are the candidate's
 * own failure, which the repair loop may repair. Conservative and
 * deterministic, from GitHub's own records only:
 *
 * 1. every non-success check finished: none is still running (wait), and each
 *    is a plain FAILURE, or CANCELLED inside a workflow run that has a
 *    FAILURE (a downstream gate job cancelled by it). A timeout, startup
 *    failure, action-required, stale, conflicting or unreadable check is
 *    infrastructure, never repaired;
 * 2. a failing check is the candidate's own only if the same check passed on
 *    the PR's base revision; one that failed, was cancelled or is missing
 *    there is inherited from the base and never triggers a repair;
 * 3. an own failing check must be attributed: its failed log names a failing
 *    test in a file the candidate itself changed. An own check with no such
 *    test (a test the candidate did not touch, a lint or build failure) may
 *    be a flake or an interaction and never triggers a repair on its own.
 *
 * A repair runs when at least one failing check is own and attributed;
 * inherited and unattributed failures are named beside it, never hidden.
 * Any GitHub read that fails stops the loop for the operator.
 */
export function judgeRequiredChecksFailure(input: {
  failure: RequiredChecksFailure;
  /** Paths the candidate's own commits change (base...pre-settlement work). */
  changedPaths: readonly string[];
  repoRoot: string;
  runCommand: RunCommand;
}): ChecksJudgement {
  const { failure, runCommand } = input;
  const stop = (reason: string, summary = `Required checks on ${failure.head.slice(0, 12)} failed.`): Extract<ChecksJudgement, { kind: "judged" }> =>
    ({ kind: "judged", repairable: false, reason, summary, findings: [], checks: failure.checks.map((check) => ({ name: check.name, status: (check.conclusion ?? check.status ?? "unknown").toLowerCase(), evidence: check.url ?? "" })) });
  const running = failure.checks.filter((check) => !check.unknown && check.status?.toUpperCase() !== "COMPLETED");
  if (running.length > 0) return { kind: "waiting", reason: `Required checks still running beside a failure: ${running.map((check) => check.name).join(", ")}.` };
  const failed = failure.checks.filter((check) => !check.unknown && check.conclusion?.toUpperCase() === "FAILURE");
  const failedRuns = new Set(failed.map((check) => runIdOf(check.url)).filter((id): id is string => id !== null));
  const infrastructure = failure.checks.filter((check) => !failed.includes(check)
    && !(check.conclusion?.toUpperCase() === "CANCELLED" && failedRuns.has(runIdOf(check.url) ?? "")));
  if (failed.length === 0 || infrastructure.length > 0) {
    const names = (infrastructure.length > 0 ? infrastructure : failure.checks).map((check) => `${check.name} (${check.unknown ? "unreadable" : (check.conclusion ?? check.status ?? "unknown").toLowerCase()})`);
    return stop(`A required check did not fail on a test: ${names.join(", ")}; that is CI infrastructure or an unreadable check, never repaired unattended.`);
  }
  const repository = /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(failure.pullRequestUrl)?.[1];
  if (!repository || !failure.baseRefOid) return stop("The PR's repository or base revision is unknown, so an inherited failure cannot be told apart.");
  const baseRead = runCommand({ command: "gh", args: ["api", `repos/${repository}/commits/${failure.baseRefOid}/check-runs?per_page=100`], cwd: input.repoRoot, timeoutMs: 30_000 });
  let baseRuns: Array<{ name?: unknown; status?: unknown; conclusion?: unknown }> = [];
  try {
    if (baseRead.status !== 0) throw new Error(commandError(baseRead));
    const parsed = JSON.parse(baseRead.stdout) as { check_runs?: unknown };
    if (!Array.isArray(parsed.check_runs)) throw new Error("no check_runs array");
    baseRuns = parsed.check_runs as typeof baseRuns;
  } catch (error) {
    return stop(`The base revision ${failure.baseRefOid.slice(0, 12)}'s checks could not be read (${error instanceof Error ? error.message : String(error)}), so an inherited failure cannot be told apart.`);
  }
  const passedOnBase = (name: string) => {
    const same = baseRuns.filter((run) => run.name === name);
    return same.length > 0 && same.every((run) => String(run.status).toLowerCase() === "completed" && String(run.conclusion).toLowerCase() === "success");
  };
  // A same-named check still queued or running on the base is no verdict
  // either way: wait for it rather than calling the failure inherited.
  const unsettled = failed.flatMap((check) => baseRuns.filter((run) => run.name === check.name && String(run.status).toLowerCase() !== "completed")
    .map((run) => `${check.name} is still ${String(run.status).toLowerCase()} on the base ${failure.baseRefOid!.slice(0, 12)}`));
  if (unsettled.length > 0) return { kind: "waiting", reason: `Waiting for the base's checks before judging the failure: ${[...new Set(unsettled)].join("; ")}.` };
  const own = failed.filter((check) => passedOnBase(check.name));
  const inherited = failed.filter((check) => !own.includes(check));
  const base = failure.baseRefOid.slice(0, 12);
  const inheritedChecks: ReviewRepairCheck[] = inherited.map((check) => ({ name: check.name, status: "inherited", evidence: `also not passing on the base ${base}; not this candidate's to fix (${check.url ?? "no URL"})` }));
  if (own.length === 0) {
    return { ...stop(`Every failing required check (${inherited.map((check) => check.name).join(", ")}) also fails or did not pass on the base ${base}: the failure is inherited from the base, so no repair is launched.`), checks: inheritedChecks };
  }
  const tests: FailingTest[] = [];
  for (const runId of [...new Set(own.map((check) => runIdOf(check.url)).filter((id): id is string => id !== null))]) {
    const log = runCommand({ command: "gh", args: ["run", "view", runId, "-R", repository, "--log-failed"], cwd: input.repoRoot, timeoutMs: 60_000 });
    if (log.status !== 0) return stop(`The failed log of CI run ${runId} could not be read (${commandError(log)}), so the failure cannot be attributed to the candidate.`);
    tests.push(...parseFailedTestLog(log.stdout).filter((test) => own.some((check) => check.name === test.check)));
  }
  const changed = new Set(input.changedPaths);
  const attributed = tests.filter((test) => changed.has(test.file));
  const ownChecks: ReviewRepairCheck[] = own.map((check) => {
    const mine = attributed.filter((test) => test.check === check.name);
    return mine.length > 0
      ? { name: check.name, status: "fail", evidence: `passes on the base ${base}; fails in ${[...new Set(mine.map((test) => test.file))].join(", ")}, which the candidate changed (${check.url ?? "no URL"})` }
      : { name: check.name, status: "unattributed", evidence: `passes on the base ${base}; its failed log names no failing test in a file the candidate changed (${check.url ?? "no URL"})` };
  });
  const findings: ReviewRepairFinding[] = tests.slice(0, MAX_CHECK_FINDINGS).map((test) => ({
    severity: "blocker",
    title: `${test.check}: ${test.file} > ${test.name}`,
    evidence: test.evidence || "(no assertion lines in the failed log)",
    recommendation: changed.has(test.file)
      ? "Make this test pass by fixing the candidate's code or the test's own defect; never skip, delete or weaken it."
      : "This test file is not one the candidate changed: confirm the candidate's change caused it before fixing it."
  }));
  const checks = [...ownChecks, ...inheritedChecks];
  const summary = `Required check(s) ${own.map((check) => check.name).join(", ")} failed on ${failure.head.slice(0, 12)} and pass on the base ${base}`
    + (attributed.length > 0 ? `; failing tests in files the candidate changed: ${[...new Set(attributed.map((test) => test.file))].join(", ")}.` : ".")
    + (inherited.length > 0 ? ` Also red, inherited from the base (not this candidate's to fix): ${inherited.map((check) => check.name).join(", ")}.` : "");
  if (attributed.length === 0) {
    return { kind: "judged", repairable: false, summary, findings, checks,
      reason: "No failing test in the failed CI logs is in a file the candidate changed (a flake, an interaction or a non-test failure is possible), so no repair is launched unattended." };
  }
  return { kind: "judged", repairable: true, reason: null, summary, findings, checks };
}

/**
 * One repair step for a terminal candidate whose required checks failed on its
 * exact head (`required_checks_failed` with its evidence): the same bounded
 * loop as a failed verdict, under the same authority, rounds and gates, but
 * only for a failure {@link judgeRequiredChecksFailure} attributes to the
 * candidate's own change. Judged once per head (its row records the
 * judgement); an inherited or unattributed failure stops once for the
 * operator without touching the PR.
 */
function attemptChecksRepair(input: ReviewRepairInput, failure: RequiredChecksFailure): ReviewRepairStep {
  const { db, repoRoot, session, now } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const exit = getSessionExitReceipt(db, session.id);
  if (exit?.outcome !== "accepted_completion" || exit.superseded_by_session_id !== null) {
    return { kind: "not_applicable", reason: `The candidate's exit is ${exit ? `${exit.outcome}${exit.superseded_by_session_id ? `, superseded by ${exit.superseded_by_session_id}` : ""}` : "unrecorded"}, not an unsuperseded accepted completion.` };
  }
  const readiness = independentVerdictReadiness(db, { session, repoRoot });
  if (!readiness.ready) return { kind: "not_applicable", reason: `The candidate is not ready for verdicts: ${readiness.reasons.join(" ")}` };
  const head = readiness.binding.targetHead;
  if (head !== failure.head) return { kind: "not_applicable", reason: `The failed checks were read on ${failure.head.slice(0, 12)}, not the candidate's current head ${head.slice(0, 12)}.` };
  const authority = repairAuthority(db, session, now);
  if ("notApplicable" in authority) return { kind: "not_applicable", reason: authority.notApplicable };
  const { policy, authorizedNow } = authority;

  ensureReviewRepairTable(db);
  const requestId = requiredChecksRepairRequestId(session.id, head);
  let row = getReviewRepair(db, requestId);
  if (!row) {
    const start = tryGit(repoRoot, ["rev-parse", "--verify", `${head}^1`]);
    if (!start || !isAncestor(repoRoot, session.base_revision, start)) {
      return { kind: "not_applicable", reason: `The failed head ${head.slice(0, 12)} has no pre-settlement parent descending from the candidate's base ${session.base_revision.slice(0, 12)}.` };
    }
    let outcome: ReviewRepairOutcome = "pending";
    let reason: string | null = null;
    const rounds = launchedRepairRounds(db, actionKey, policy.epoch);
    const judgement = judgeRequiredChecksFailure({ failure, changedPaths: agentChangedPaths(repoRoot, session.base_revision, start) ?? [], repoRoot, runCommand: input.runCommand ?? runHostCommand });
    if (judgement.kind === "waiting") return { kind: "waiting", reason: judgement.reason };
    const judged = judgement;
    // Not the candidate's own failure (inherited, unattributed, infrastructure):
    // the repair loop never decides it. The row only caches the judgement for
    // this head ('released', never launched) so GitHub is read once; the
    // review step's ordinary required_checks_failed handling stands and clears
    // when the checks go green.
    const gate = judgement.repairable ? candidateChangeGate(repoRoot, session.base_revision, start) : null;
    if (!judgement.repairable) {
      outcome = "released"; reason = judgement.reason;
    } else if (gate) {
      outcome = "gated"; reason = `The candidate is on Decision 0098's gate list: ${gate}. The repair loop stops for the operator.`;
    } else if (rounds >= MAX_REVIEW_REPAIR_ROUNDS) {
      outcome = "escalated"; reason = `The ${MAX_REVIEW_REPAIR_ROUNDS} repair rounds for ${actionKey} in this production run (epoch ${policy.epoch}) are spent, and the latest repaired head still failed.`;
    }
    // Only a failure attributed to the candidate drafts and comments on its PR.
    const touchesPullRequest = judged.repairable && !gate;
    const at = now.toISOString();
    db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
        start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome, reason,
        last_error, drafted_at, commented_at, created_at, updated_at, verdict_request_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?, NULL) ON CONFLICT(request_id) DO NOTHING`)
      .run(requestId, actionKey, policy.epoch, Math.min(rounds + 1, MAX_REVIEW_REPAIR_ROUNDS), session.id, session.branch, head, start,
        touchesPullRequest ? workerPullRequestUrl(db, session.id) ?? failure.pullRequestUrl : null, REQUIRED_CHECKS_ROLE,
        // The candidate's own failing checks when judged; every failing check otherwise.
        `failed (${(judged?.repairable ? judged.checks.filter((check) => check.status === "fail" || check.status === "unattributed").map((check) => check.name)
          : failure.checks.filter((check) => check.conclusion?.toUpperCase() === "FAILURE").map((check) => check.name)).join(", ") || "see checks"})`,
        judged?.summary ?? `Required checks on ${head.slice(0, 12)} failed on ${failure.pullRequestUrl}.`,
        JSON.stringify(judged?.findings ?? []), JSON.stringify(judged?.checks ?? failure.checks.map((check) => ({ name: check.name, status: (check.conclusion ?? check.status ?? "unknown").toLowerCase(), evidence: check.url ?? "" }))),
        outcome, reason, at, at);
    row = getReviewRepair(db, requestId)!;
    input.log?.(`Required-checks repair for ${actionKey} at ${head.slice(0, 12)}: ${outcome === "pending" ? `round ${row.round} of ${MAX_REVIEW_REPAIR_ROUNDS}` : outcome === "released" ? `not the candidate's own failure, no repair: ${reason}` : `${outcome}: ${reason}`}.`);
  }
  if (row.outcome === "released") return { kind: "not_applicable", reason: `No unattended repair for these red checks: ${row.reason ?? "released"}` };
  return finishRepairStep(input, row, {
    policyEpoch: policy.epoch,
    authorizedNow,
    requirement: { requirement_id: readiness.requirement.requirementId, input_revision: readiness.requirement.inputRevision },
    developerRequestId: readiness.developer.request_id,
    describe: (r) => `Required checks on ${r.failed_head.slice(0, 12)} of ${failure.pullRequestUrl} are ${r.verdict};`,
    findingsLabel: () => "Failing checks and tests (from the CI logs)",
    stoppedRemedy: () => `${failure.remedy ? `${failure.remedy} ` : ""}Read the failing checks on ${failure.pullRequestUrl}; fix the candidate yourself (a new head is checked and reviewed afresh), or, for a failure inherited from the base or a flaky check, fix the base or re-run the check on GitHub. The tick resumes the review once every required check is green; nothing integrates meanwhile.`
  });
}

/** The Active production authority a repair needs, or why it does not apply. */
function repairAuthority(db: Database.Database, session: AgentSession, now: Date):
  { policy: ProductionPolicyRecord; authorizedNow: () => string | null } | { notApplicable: string } {
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok" || policyRead.policy.desiredState !== "active" || !policyRead.policy.scope) {
    return { notApplicable: "Managed production is not Active." };
  }
  const policy = policyRead.policy;
  const scope = policy.scope!;
  if (!scope.projects.includes(session.project_slug) || !scope.plans.includes(`${session.project_slug}/${session.plan_slug}`) || !scope.actions.includes(actionKey)) {
    return { notApplicable: `${actionKey} is outside the Active production scope.` };
  }
  const authorizedNow = (): string | null => {
    const current = readProductionPolicySafely(db);
    if (current.status !== "ok" || current.policy.desiredState !== "active") return "managed production is Off";
    if (current.policy.epoch !== policy.epoch) return `the production epoch changed (${policy.epoch} -> ${current.policy.epoch})`;
    const authorized = policyAuthorizesPullRequestReadiness(current.policy, actionKey, now);
    return authorized.authorized ? null : authorized.reason;
  };
  const unauthorized = authorizedNow();
  if (unauthorized) return { notApplicable: `The worker may not repair this candidate: ${unauthorized}` };
  return { policy, authorizedNow };
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

/**
 * A pending repair (decided, not launched) whose failed verdict no longer
 * stands on the candidate's current head (an operator's passing rerun, a new
 * head, an amended Action input) is released, fenced on its never having
 * been bound to a Session: it can never launch later. Read-only otherwise.
 */
export function releaseStalePendingRepair(db: Database.Database, input: { session: AgentSession; repoRoot: string; now: Date; log?: (message: string) => void }): boolean {
  const { session } = input;
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_review_repairs'").get() === undefined) return false;
  const pending = db.prepare(`SELECT * FROM production_review_repairs
    WHERE failed_session_id = ? AND outcome = 'pending' AND repair_session_id IS NULL AND role <> ?`).all(session.id, REQUIRED_CHECKS_ROLE) as ReviewRepairRow[];
  if (pending.length === 0) return false;
  const failed = realFailedVerdict(db, { session, repoRoot: input.repoRoot });
  let released = false;
  for (const row of pending) {
    if (failed && failed.head === row.failed_head) continue;
    const changed = db.prepare(`UPDATE production_review_repairs SET outcome = 'released', reason = ?, updated_at = ?
      WHERE request_id = ? AND outcome = 'pending' AND repair_session_id IS NULL`)
      .run(`The failed verdict on ${row.failed_head.slice(0, 12)} no longer stands (a newer verdict, head or Action input); this repair is never launched.`, input.now.toISOString(), row.request_id).changes;
    if (changed > 0) {
      released = true;
      input.log?.(`Released the pending review repair for ${row.action_key} at ${row.failed_head.slice(0, 12)}: its failed verdict no longer stands.`);
    }
  }
  return released;
}

/** The `role` of a repair row recording a gated repair candidate rather than a failed verdict. */
export const REPAIR_CANDIDATE_GATE_ROLE = "repair-gate";

/**
 * A repair Session's own candidate, checked before it is readied, reviewed or
 * integrated: the same Decision 0098 gates as the failed candidate, over the
 * repair's whole change (its base revision to its settlement's parent), so a
 * repair that deletes or skips the test the reviewer complained about, or
 * touches authority paths, stops for the operator exactly like a failed
 * verdict (PR kept a draft with one comment, one escalation) and is never
 * reviewed. Returns the gate's reason, or null when the candidate is not a
 * repair or passes every gate. Idempotent per repair Session and head.
 */
export function gateRepairCandidate(db: Database.Database, input: {
  repoRoot: string;
  session: AgentSession;
  head: string;
  now: Date;
  log?: (message: string) => void;
  runCommand?: RunCommand;
  escalate: (kind: string, message: string, remedy: string) => void;
}): string | null {
  const { session, head, now } = input;
  const repair = getSessionRepair(db, session.id);
  if (!repair) return null;
  const parent = tryGit(input.repoRoot, ["rev-parse", "--verify", `${head}^1`]);
  // Both the whole candidate (base -> repaired work) and the repair's own
  // change over the failed work it started from: a test only the failed
  // candidate added, then deleted by the repair, nets out of the first diff.
  const gates = parent
    ? [candidateChangeGate(input.repoRoot, session.base_revision, parent), candidateChangeGate(input.repoRoot, repair.start_revision, parent)]
      .filter((reason): reason is string => reason !== null)
    : ["the repair candidate's settlement parent could not be read"];
  const gate = gates.length > 0 ? [...new Set(gates)].join("; ") : null;
  if (!gate) return null;
  ensureReviewRepairTable(db);
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const requestId = reviewRepairRequestId(session.id, head);
  const reason = `The review repair candidate (round ${repair.round} of ${MAX_REVIEW_REPAIR_ROUNDS}) is on Decision 0098's gate list: ${gate}. It is not reviewed or integrated unattended.`;
  const at = now.toISOString();
  db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
      start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome, reason,
      last_error, drafted_at, commented_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gated', ?, ?, ?, ?, NULL, 'gated', ?, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(request_id) DO UPDATE SET summary = excluded.summary, reason = excluded.reason, updated_at = excluded.updated_at
      WHERE production_review_repairs.repair_session_id IS NULL AND production_review_repairs.outcome = 'gated'
        AND production_review_repairs.reason IS NOT excluded.reason`)
    .run(requestId, actionKey, repair.policy_epoch, repair.round, session.id, session.branch, head, parent ?? head,
      workerPullRequestUrl(db, session.id), REPAIR_CANDIDATE_GATE_ROLE, gate, repair.report_path, repair.findings_json, repair.failed_checks_json, reason, at, at);
  let row = getReviewRepair(db, requestId)!;
  const policy = readProductionPolicySafely(db);
  const epoch = policy.status === "ok" ? policy.policy.epoch : null;
  /** Re-read before each side effect, like the repair step's own: Off, a new epoch or a lapsed grant withholds it. */
  const authorized = (): string | null => {
    const current = readProductionPolicySafely(db);
    if (current.status !== "ok" || current.policy.desiredState !== "active") return "managed production is Off";
    if (current.policy.epoch !== epoch) return `the production epoch changed (${String(epoch)} -> ${current.policy.epoch})`;
    const allowed = policyAuthorizesPullRequestReadiness(current.policy, actionKey, now);
    return allowed.authorized ? null : allowed.reason;
  };
  if (policy.status === "ok" && row.notify_failures < MAX_NOTIFY_FAILURES) {
    const error = notifyPullRequest(db, row, { repoRoot: input.repoRoot, now, runCommand: input.runCommand ?? runHostCommand, authorized });
    row = getReviewRepair(db, requestId)!;
    if (error) {
      // The same bounded accounting as the repair step: past the bound the
      // draft/comment is no longer retried; the escalation below stands.
      const failures = row.notify_failures + 1;
      db.prepare("UPDATE production_review_repairs SET last_error = ?, notify_failures = ?, updated_at = ? WHERE request_id = ?").run(error, failures, at, requestId);
      if (row.last_error !== error || failures >= MAX_NOTIFY_FAILURES) {
        input.log?.(`Review repair candidate gate for ${actionKey}: ${error}; ${failures >= MAX_NOTIFY_FAILURES ? `not retried after ${failures} attempts` : "retried next tick"}.`);
      }
      row = getReviewRepair(db, requestId)!;
    }
  }
  input.escalate(REVIEW_REPAIR_GATED,
    `${reason} The original findings it was repairing (report ${repair.report_path ?? "unavailable"}):\n${renderRepairFindings(repair).join("\n")}`,
    `Inspect the repair candidate ${session.branch} at ${head}; fix it yourself (a new head is reviewed afresh) or land the change by hand after review. Its PR${row.pull_request_url ? ` ${row.pull_request_url}` : ""} stays a draft; nothing integrates meanwhile.`);
  return reason;
}
