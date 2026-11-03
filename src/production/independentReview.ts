import type Database from "better-sqlite3";
import { appendJourneyLog, appendReviewRepairJourneyLog } from "./journeyLog.js";
import { classifyRecoverySignals, OPERATOR_QA_PLAN_CRITERION } from "./recoverySignals.js";
import { ArcadiaError } from "../cli/errors.js";
import type { AgentSession } from "../sessions/index.js";
import { systemPreservationRemote, type CandidatePreservationReceipt, type CandidatePreservationRemote } from "../sessions/candidatePreservation.js";
import { INDEPENDENT_VERDICT_ROLES, latestRoleAttempt, roleAttemptsOnHead, type IndependentVerdictRole } from "../sessions/enrollment.js";
import { independentVerdictGate, independentVerdictReadiness, MAX_VARIANCE_REVIEW_ATTEMPTS, MAX_VERDICT_ATTEMPTS, verdictAttemptLimit, type VerdictGate } from "../sessions/roleLineage.js";
import { ensureReviewRepairTable, getReviewRepair, requiredChecksRepairRequestId, reviewRepairRequestId } from "../sessions/reviewRepair.js";
import { isAncestor, tryGit } from "../git/worktrees.js";
import { redactSecrets } from "../sessions/validationEvidence.js";
import { candidateChangeGate, SETTLEMENT_RECORD_PATH } from "./candidateChangeGate.js";
import { consumedCompletionDrafts } from "./workerMerge.js";
import {
  classifyPullRequestChecks,
  readPullRequestChecks,
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
 * which `arcadia qa pr` derives from deterministic evidence alone, or that it
 * was pure reviewer variance (no finding but the gate's refused not-applicable
 * claims, no criterion judged fail; also derived deterministically, Issue
 * #1018): a variance verdict is re-judged at most
 * `MAX_VARIANCE_REVIEW_ATTEMPTS - 1` more times per verdict kind per exact head,
 * counted from the durable lineage attempts, then stops on one
 * `independent_verdict_failed` entry that says the reruns are spent. A
 * reviewer's real non-pass judgment is never retried automatically and never
 * integrates.
 *
 * Every step, the push included, requires `policyAuthorizesPullRequestReadiness`
 * (`--remote-preservation` and a current Decision 0058 integration grant).
 * Out of scope by design: merging the PR and pushing the base branch.
 * Integration is the tick's local fast-forward, or, under the grant's
 * `mergeThroughPullRequest` opt-in, the worker merge (workerMerge.ts).
 */

/**
 * Attempts in all (the first review and its automatic reruns) one
 * verdict kind may spend on one exact head while its non-pass is pure reviewer
 * variance: the operator's 2026-10-06 choice (Issue #1018), i.e. at most two
 * reruns. A new head restarts the count.
 */
export { MAX_VARIANCE_REVIEW_ATTEMPTS };

export type ReviewBlockCode =
  | "review_head_moved"
  | "review_pull_request_unavailable"
  | "review_paused_as_draft"
  | "required_checks_failed"
  | "required_checks_timeout"
  | "review_budget_exhausted"
  | "review_attempts_exhausted"
  | "review_rate_limited"
  | "independent_verdict_failed";

export const REVIEW_BLOCK_CODES: ReadonlySet<string> = new Set<ReviewBlockCode>([
  "review_head_moved",
  "review_pull_request_unavailable",
  "review_paused_as_draft",
  "required_checks_failed",
  "required_checks_timeout",
  "review_budget_exhausted",
  "review_attempts_exhausted",
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
  /**
   * `failedRole` is set only for a reviewer's real non-pass judgment of this exact
   * head (never reviewer unavailability or variance): the trigger of the review
   * repair loop (src/production/reviewRepair.ts).
   */
  | { kind: "blocked"; code: ReviewBlockCode; reason: string; remedy: string; failedRole?: IndependentVerdictRole; checkFailure?: RequiredChecksFailure };

/**
 * The evidence behind a `required_checks_failed` outcome: every gating check
 * on the exact head that is not a completed success, as GitHub reported it.
 * The review repair loop (src/production/reviewRepair.ts) judges from it
 * whether the failure is the candidate's own; nothing here judges that.
 */
export interface RequiredChecksFailure {
  head: string;
  pullRequestUrl: string;
  /** The PR's base revision, against which an inherited failure is told apart. */
  baseRefOid: string | null;
  checks: Array<{ name: string; status: string | null; conclusion: string | null; url: string | null; unknown: boolean }>;
  /** The review step's own remedy for these checks, kept in the repair loop's escalation. */
  remedy?: string;
}

/** The non-success gating checks of a rollup, as {@link RequiredChecksFailure} records them. */
function nonSuccessChecks(rollup: ReadonlyArray<PullRequestCheckRun>): RequiredChecksFailure["checks"] {
  return readPullRequestChecks(rollup).gating
    .filter((check) => check.shape === "unknown" || check.status?.toUpperCase() !== "COMPLETED" || check.conclusion?.toUpperCase() !== "SUCCESS")
    .map((check) => ({ name: check.name, status: check.status, conclusion: check.conclusion, url: check.url, unknown: check.shape === "unknown" }));
}

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
  /** That base branch's tip now; for a stacked base it must still be the tip preservation chose. */
  baseRefOid?: string;
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

/** The variance reason a failed lineage attempt's own receipt records, or null (a real judgment, an unavailable reviewer, a stale run, an older receipt). */
function varianceFromReceipt(json: string | null): string | null {
  if (!json) return null;
  try {
    const receipt = JSON.parse(json) as { variance?: unknown; stale?: unknown };
    return receipt.stale !== true && typeof receipt.variance === "string" && receipt.variance.length > 0 ? receipt.variance : null;
  } catch {
    return null;
  }
}

/**
 * The role whose latest verdict on exactly this binding is a reviewer's real
 * non-pass judgment (failed, not reviewer unavailability, not a stale run, not
 * variance), or null. Code review first, as the reviewers run.
 */
function realFailedVerdictRole(db: Database.Database, readiness: { requirement: { requirementId: string; inputRevision: string }; binding: { criteriaFingerprint: string; evidenceFingerprint: string } }, head: string): IndependentVerdictRole | null {
  for (const role of INDEPENDENT_VERDICT_ROLES) {
    const latest = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
    if (!latest || latest.status !== "failed" || latest.target_head !== head
      || latest.criteria_fingerprint !== readiness.binding.criteriaFingerprint || latest.evidence_fingerprint !== readiness.binding.evidenceFingerprint) continue;
    if (retryableVerdictReceipt(latest.terminal_receipt_json) || varianceFromReceipt(latest.terminal_receipt_json) !== null) continue;
    return role;
  }
  return null;
}

/**
 * The real failed verdict (see `realFailedVerdictRole`) on a candidate's current
 * ready head, with the lineage attempt that recorded it, or null.
 */
export function realFailedVerdict(db: Database.Database, input: { session: AgentSession; repoRoot: string }):
  { role: IndependentVerdictRole; head: string; attempt: NonNullable<ReturnType<typeof latestRoleAttempt>>; developerRequestId: string } | null {
  const readiness = independentVerdictReadiness(db, input);
  if (!readiness.ready) return null;
  const head = readiness.binding.targetHead;
  const role = realFailedVerdictRole(db, readiness, head);
  if (!role) return null;
  const attempt = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
  return attempt ? { role, head, attempt, developerRequestId: readiness.developer.request_id } : null;
}

/* ------------------------------------------------------------------------ */
/* A QA verdict whose only failure is the host-written Operator QA plan.      */
/* ------------------------------------------------------------------------ */

/** Text that makes a verdict authority-adjacent (Decision 0098); shared with the repair loop's authority judgement. */
export const AUTHORITY_TEXT = /\b(authority|authori[sz]ation|approval[- ]boundar|credential|secret|permission|privilege|branch protection)/i;

/**
 * A finding about the Operator QA plan: the reviewer's title names the plan or
 * one of its steps ("Operator QA plan uses ...", "Operator QA step 4 ..."). A
 * finding with any other title concerns something else and keeps the verdict
 * blocking, whatever else it says.
 */
const PLAN_FINDING_TITLE = /^operator qa (?:plan|procedure|step)\b/i;
const OPERATOR_QA_PLAN_CHECK_NAME = "Operator QA plan";

/** Issue filings the worker attempts per Action and head before it stops asking GitHub. */
export const MAX_QA_PLAN_ISSUE_ATTEMPTS = 3;

export interface QaPlanSoleFailure {
  /** The failed QA lineage attempt the waiver rests on. */
  attempt: NonNullable<ReturnType<typeof latestRoleAttempt>>;
  head: string;
  pullRequestUrl: string | null;
  summary: string;
  reportPath: string | null;
  /** The failing Operator QA plan check's evidence, as the reviewer wrote it. */
  planEvidence: string;
  /** The one numbered plan step the reviewer named. */
  step: string;
  /** The reviewer's findings, at most one; their titles name the plan. */
  findings: Array<{ severity: string; title: string; evidence: string; recommendation: string }>;
}

type VerdictReadinessBinding = { requirement: { requirementId: string; inputRevision: string }; binding: { targetHead: string; criteriaFingerprint: string; evidenceFingerprint: string } };

/** Severities a plan-only finding may carry; blocker, high and anything unknown keep the verdict blocking. */
const WAIVABLE_SEVERITIES: ReadonlySet<string> = new Set(["low", "medium"]);

/**
 * Claims about the candidate's code or data, which the plan check cannot
 * excuse. Strong words trip anywhere. Weak words ("incorrect", "broken",
 * "removed", "fails to", "accepts") trip when they sit within a short span of
 * a subject that is the candidate's code or data; "the operator QA procedure
 * incorrectly claims" has no such subject. Conservative on purpose: a real
 * plan-only verdict that trips simply takes the existing repair path.
 */
const STRONG_CLAIM = /\b(?:data[- ]?loss|drops?|dropped|dropping|deletes?|deleted|deleting|corrupt\w*|crash\w*|vulnerab\w*|inject\w*|leak\w*|overwrit\w*|regress(?:es|ed|ing)|deadlock\w*|expos(?:es|ed|ing|ure)|unsafe|insecure|exploit\w*|malicious|race condition|users? table)\b/i;
const WEAK_WORD = String.raw`(?:removes?|removed|incorrect\w*|broken|breaks?|faulty|wrong|accepts?|allows?|permits?|ignores?|bypass\w*|violat\w*|truncat\w*|missing|lacks?|not (?:implemented|handled|enforced|validated|refused|rejected)|(?:does|do|did) not (?:work|handle|refuse|reject|validate|enforce|implement|compile|pass)|(?:fails?|failed|failing) (?:to|when|on|for) (?!(?:show|establish|demonstrate|prove|observe|state|name|identify|point|instruct|say|mention|tell|describe|reflect|cover)\b))`;
const CODE_SUBJECT = String.raw`(?:candidate'?s?|patch|implementation|production code|source code|code|migration|schema|database|data|stored|guard|function|handler|module)`;
const WEAK_CLAIM = [new RegExp(String.raw`\b${CODE_SUBJECT}\b([^.;\n]{0,60}?)\b${WEAK_WORD}`, "gi"), new RegExp(String.raw`\b${WEAK_WORD}([^.;\n]{0,40}?)\b${CODE_SUBJECT}\b`, "gi")];
/** Defect words, tripped in a finding or the plan check's evidence only: "bug fix" is ordinary in a summary. */
const DEFECT_WORD = /\b(?:bugs?|buggy|defects?|defective)\b/i;

/** The claim about the candidate's code or data a text makes, or null. `strict` texts (findings, plan evidence) also trip on defect words. */
export function candidateClaim(text: string, strict = false): string | null {
  const strong = STRONG_CLAIM.exec(text);
  if (strong) return strong[0];
  if (strict) { const defect = DEFECT_WORD.exec(text); if (defect) return defect[0]; }
  // No plan-wording exemption: "the code at step 4 is broken" is still a claim about the code.
  for (const pattern of WEAK_CLAIM) {
    const hit = text.match(pattern)?.[0];
    if (hit) return hit;
  }
  return null;
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10", eleventh: "11", twelfth: "12"
};
const NUM = String.raw`(?:\d+|${Object.keys(NUMBER_WORDS).join("|")})`;
const SEP = String.raw`\s*(?:,|and|&|or|through|to|-|–|—)\s*`;
const numbersIn = (text: string) => (text.toLowerCase().match(new RegExp(NUM, "g")) ?? []).map((token) => NUMBER_WORDS[token] ?? String(Number(token)));

/**
 * Numbered plan steps a text names: "Step 4", "Steps 4 and 6", "Step #4 and
 * Step #6", "step four", "third and fifth steps", "1-5", and numbered list
 * items. Criteria are counted separately ("acceptance criteria 2 and 4").
 */
function namedSteps(text: string): { steps: Set<string>; criteria: Set<string>; wholePlan: boolean } {
  const steps = new Set<string>();
  const criteria = new Set<string>();
  const list = String.raw`${NUM}(?:${SEP}(?:steps?\s*)?#?\s*${NUM})*`;
  for (const match of text.matchAll(new RegExp(String.raw`\bsteps?\s*#?\s*(${list})`, "gi"))) for (const n of numbersIn(match[1])) steps.add(n);
  for (const match of text.matchAll(new RegExp(String.raw`\b(${list})\s+steps?\b`, "gi"))) for (const n of numbersIn(match[1])) steps.add(n);
  for (const match of text.matchAll(/^\s*(\d+)[.)]\s/gm)) steps.add(String(Number(match[1])));
  for (const match of text.matchAll(new RegExp(String.raw`\bcriteri(?:on|a)\s*#?\s*(${list})`, "gi"))) for (const n of numbersIn(match[1])) criteria.add(n);
  const wholePlan = /\b(?:every|each|all|none|any|both|neither|several|multiple|most|many|few|some|numerous|whole|entire)\b[^.\n]{0,30}\b(?:steps?|procedure|plan|inspections?|instructions?)\b/i.test(text)
    || (text.match(/^\s*(?:[-*\u2022]|[a-z][.)])\s/gim) ?? []).length >= 2;
  return { steps, criteria, wholePlan };
}

/**
 * The report half of {@link qaPlanSoleFailure}: pure over the persisted QA
 * report context, so a recorded verdict can be replayed. `reason` says which
 * condition refused it.
 */
export function judgeQaPlanReport(raw: unknown, input: { head: string; actionKey: string; requestId: string; at: string }):
  { ok: true; failure: Omit<QaPlanSoleFailure, "attempt"> } | { ok: false; reason: string } {
  const refuse = (reason: string) => ({ ok: false as const, reason });
  const context = (raw ?? {}) as {
    role?: unknown; verdict?: unknown; summary?: unknown; reportPath?: unknown; reviewerUnavailable?: unknown; varianceReason?: unknown;
    candidate?: { headSha?: unknown; url?: unknown }; findings?: unknown; checks?: unknown; residualRisks?: unknown;
    effectiveness?: { deterministicGateReasons?: unknown; deterministicGateVerdict?: unknown };
  };
  const { head } = input;
  if (context.role !== "qa" || context.verdict !== "fail" || context.candidate?.headSha !== head) return refuse("not a failed QA report for this head");
  if (context.reviewerUnavailable || context.varianceReason) return refuse("reviewer unavailability or variance");
  // The deterministic gate (merge state, stale evidence, missing checks, ...) must have recorded nothing.
  const gate = context.effectiveness;
  if (!gate || !Array.isArray(gate.deterministicGateReasons) || gate.deterministicGateReasons.length !== 0
    || !(gate.deterministicGateVerdict === undefined || gate.deterministicGateVerdict === null || gate.deterministicGateVerdict === "pass")) return refuse("the deterministic gate recorded a reason or is absent");
  if (!Array.isArray(context.checks) || context.checks.length === 0 || !Array.isArray(context.findings)) return refuse("no checks or findings list");
  const checks = (context.checks as Array<Record<string, unknown>>).map((check) => ({
    criterion: typeof check.criterion === "string" ? check.criterion : check.name === OPERATOR_QA_PLAN_CHECK_NAME ? OPERATOR_QA_PLAN_CRITERION : String(check.name),
    name: String(check.name),
    status: String(check.status),
    evidence: typeof check.evidence === "string" ? check.evidence : ""
  }));
  // The recovery-signal classifier owns the sole-failure shape (Decision 0169).
  const signals = classifyRecoverySignals({ reviewRepairs: [{
    requestId: input.requestId, actionKey: input.actionKey, round: 0, role: "qa", verdict: "fail", failedChecks: checks, outcome: "pending", at: input.at
  }] });
  if (signals.length !== 1 || signals[0].failureClass !== "sole_failure") return refuse("the failed checks are not exactly the Operator QA plan");
  // The classifier reads checks only; findings and prose are read separately.
  const found = context.findings as Array<Record<string, unknown>>;
  if (found.length > 1) return refuse("more than one finding");
  const findings: QaPlanSoleFailure["findings"] = [];
  for (const finding of found) {
    const title = typeof finding?.title === "string" ? finding.title.trim() : "";
    const severity = typeof finding?.severity === "string" ? finding.severity.trim().toLowerCase() : "";
    if (!PLAN_FINDING_TITLE.test(title)) return refuse("a finding is not titled as about the plan");
    if (!WAIVABLE_SEVERITIES.has(severity)) return refuse(`a finding has severity ${severity || "unknown"}`);
    findings.push({ severity, title, evidence: String(finding.evidence ?? ""), recommendation: String(finding.recommendation ?? "") });
  }
  const plan = checks.find((check) => check.criterion === OPERATOR_QA_PLAN_CRITERION)!;
  const summary = typeof context.summary === "string" ? context.summary : "";
  const risks = Array.isArray(context.residualRisks) ? context.residualRisks.map(String) : [];
  const prose = [plan.evidence, summary, ...risks, ...findings.flatMap((finding) => [finding.title, finding.evidence, finding.recommendation])];
  if (prose.some((text) => AUTHORITY_TEXT.test(text))) return refuse("authority text");
  const strictProse = [plan.evidence, ...findings.flatMap((finding) => [finding.title, finding.evidence, finding.recommendation])];
  const claim = [...prose.map((text) => candidateClaim(text, strictProse.includes(text))), ...strictProse.map((text) => candidateClaim(text, true))].find(Boolean);
  if (claim) return refuse(`a claim about the candidate's code or data: ${claim}`);
  // "At most one numbered step": across the plan evidence and the finding.
  const steps = new Set<string>();
  const criteria = new Set<string>();
  for (const text of [plan.evidence, ...findings.flatMap((finding) => [finding.title, finding.evidence, finding.recommendation])]) {
    const named = namedSteps(text);
    if (named.wholePlan) return refuse("the text speaks of all or every plan step");
    for (const step of named.steps) steps.add(step);
    for (const criterion of named.criteria) criteria.add(criterion);
  }
  if (steps.size !== 1) return refuse(steps.size === 0 ? "no numbered plan step is named, so no host-written plan step was checked" : `more than one plan step (${[...steps].join(", ")})`);
  if (criteria.size > 1) return refuse(`more than one acceptance criterion (${[...criteria].join(", ")})`);
  return { ok: true, failure: {
    head,
    pullRequestUrl: typeof context.candidate?.url === "string" ? context.candidate.url : null,
    summary: summary || "(no summary recorded)",
    reportPath: typeof context.reportPath === "string" ? context.reportPath : null,
    planEvidence: plan.evidence, findings, step: [...steps][0]
  } };
}

/**
 * Decision 0169: the QA verdict on this exact binding failed ONLY the
 * host-written Operator QA plan, which no repair Session can change, and
 * only about ONE plan step ("one operator check step unverified"). Returns
 * its facts, or null when there is any doubt, in which case the existing
 * blocking and repair path applies. Null when: the lineage attempt is not a
 * failed QA verdict on exactly this binding, is reviewer unavailability or
 * variance, its persisted report cannot be read or does not name this head,
 * the plan was refused as unavailable, the verdict is not `fail`, the
 * deterministic gate recorded any reason, the failed checks are not exactly
 * the Operator QA plan check (judged by `classifyRecoverySignals`, so a
 * not-checked plan, an unlisted check or any other non-pass blocks), the
 * candidate is on Decision 0098's gate list (authority paths, launch and
 * repair-loop code, test weakening), there is more than one finding, a
 * finding is `blocker`/`high`/unknown severity or is not titled as about the
 * plan, any finding, the plan evidence, the summary or a residual risk
 * makes a claim about the candidate's code or data, anything touches
 * authority, or more than one plan step is named. Never mutates anything.
 */
export function qaPlanSoleFailure(db: Database.Database, session: AgentSession, readiness: VerdictReadinessBinding, head: string, repoRoot: string): QaPlanSoleFailure | null {
  const latest = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, "qa");
  if (!latest || latest.status !== "failed" || latest.target_head !== head
    || latest.criteria_fingerprint !== readiness.binding.criteriaFingerprint || latest.evidence_fingerprint !== readiness.binding.evidenceFingerprint) return null;
  if (retryableVerdictReceipt(latest.terminal_receipt_json) || varianceFromReceipt(latest.terminal_receipt_json) !== null) return null;
  // A plan Arcadia refused to render fails the criterion for a reason a person must fix.
  const preserved = workerPreservationReceipt(db, session);
  if (!preserved || preserved.qaPlanRefusal) return null;
  // Decision 0169 did not lift Decision 0098's gate list: the same gate the repair loop applies.
  const start = tryGit(repoRoot, ["rev-parse", "--verify", `${head}^1`]);
  if (!start || !isAncestor(repoRoot, session.base_revision, start) || candidateChangeGate(repoRoot, session.base_revision, start) !== null) return null;
  // Only a settled head: the commit on top of the candidate's own work writes governed settlement records
  // (and consumes its completion draft) and nothing else, as the worker merge requires.
  const settlement = tryGit(repoRoot, ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", start, head]);
  const settled = settlement?.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
  let consumed = new Set<string>();
  try { consumed = consumedCompletionDrafts(repoRoot, session.base_revision, start, head); } catch { return null; }
  if (settlement === null || settled.length === 0 || !settled.every((file) => consumed.has(file) || SETTLEMENT_RECORD_PATH.test(file))) return null;
  try {
    const decisionId = (JSON.parse(latest.terminal_receipt_json ?? "{}") as { decisionId?: unknown }).decisionId;
    if (typeof decisionId !== "string") return null;
    const row = db.prepare("SELECT context_json FROM review_items WHERE id = ?").get(decisionId) as { context_json: string } | undefined;
    if (!row) return null;
    const judged = judgeQaPlanReport(JSON.parse(row.context_json), { head, actionKey: `${session.project_slug}/${session.action_id}`, requestId: latest.request_id, at: latest.created_at });
    return judged.ok ? { attempt: latest, ...judged.failure } : null;
  } catch {
    return null;
  }
}

/** {@link qaPlanSoleFailure} for the candidate's current ready head, or null. */
export function qaPlanSoleFailureOnHead(db: Database.Database, input: { session: AgentSession; repoRoot: string }): QaPlanSoleFailure | null {
  const readiness = independentVerdictReadiness(db, input);
  return readiness.ready ? qaPlanSoleFailure(db, input.session, readiness, readiness.binding.targetHead, input.repoRoot) : null;
}

export interface QaPlanWaiverRow {
  action_key: string;
  target_head: string;
  session_id: string;
  verdict_request_id: string;
  pull_request_url: string | null;
  /** What the operator-unverified record says, verbatim. */
  record: string;
  issue_url: string | null;
  issue_attempts: number;
  /** The tick time (ISO) of the latest filing attempt; one attempt per tick. */
  issue_last_attempt_at: string | null;
  issue_error: string | null;
  created_at: string;
  updated_at: string;
}

export function ensureQaPlanWaiverTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_qa_plan_waivers (
      action_key TEXT NOT NULL,
      target_head TEXT NOT NULL,
      session_id TEXT NOT NULL,
      verdict_request_id TEXT NOT NULL,
      pull_request_url TEXT,
      record TEXT NOT NULL,
      issue_url TEXT,
      issue_attempts INTEGER NOT NULL DEFAULT 0,
      issue_last_attempt_at TEXT,
      issue_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (action_key, target_head)
    );
  `);
}

export function getQaPlanWaiver(db: Database.Database, actionKey: string, head: string): QaPlanWaiverRow | null {
  ensureQaPlanWaiverTable(db);
  return (db.prepare("SELECT * FROM production_qa_plan_waivers WHERE action_key = ? AND target_head = ?").get(actionKey, head) as QaPlanWaiverRow | undefined) ?? null;
}

const oneLine = (text: string, limit = 400) => {
  const flat = redactSecrets(text).replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().replaceAll("`", "'").replaceAll("@", "@​");
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}...`;
};

/** The operator-unverified record: written to the waiver row, the journey log, the worker log and the Issue. */
export function qaPlanUnverifiedRecord(actionKey: string, failure: Pick<QaPlanSoleFailure, "head" | "planEvidence" | "step">): string {
  return `Operator QA plan unverified for ${actionKey} at ${failure.head}: independent QA failed only the host-written Operator QA plan check and named one numbered plan step, `
    + `so one operator check step (Step ${failure.step}) went unverified and QA no longer blocks this head (Decision 0169). QA's other recorded checks passed; that does not by itself establish the candidate's code is correct. Reviewer's evidence: ${oneLine(failure.planEvidence)}`;
}

const issueMarker = (actionKey: string, head: string) => `qa-plan-unverified:${actionKey}:${head}`;

/** `owner/name` from a GitHub pull-request URL, or null. */
function repoOfPullRequest(url: string | null): string | null {
  return url ? /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/\d+/.exec(url)?.[1] ?? null : null;
}

function issueBody(actionKey: string, failure: QaPlanSoleFailure, record: string): string {
  return [
    record,
    "",
    `- **Action:** \`${actionKey}\``,
    `- **Head:** \`${failure.head}\``,
    `- **Pull request:** ${failure.pullRequestUrl ?? "unavailable"}`,
    `- **QA report Artifact:** \`${failure.reportPath ?? "unavailable"}\``,
    `- **QA summary:** ${oneLine(failure.summary, 600)}`,
    `- **QA findings (${failure.findings.length}; titled as about the plan, severity low or medium, not otherwise verified):**`,
    ...(failure.findings.length > 0
      ? failure.findings.map((finding) => `  - [${finding.severity}] ${oneLine(finding.title, 200)}: ${oneLine(finding.evidence, 800)} Recommendation: ${oneLine(finding.recommendation, 400)}`)
      : ["  - none recorded"]),
    "",
    "The host renders the Operator QA plan (src/sessions/operatorQaPlan.ts, no model wrote it), so a repair Session cannot change it; Decision 0169 chose to spend no repair rounds on it. "
      + "Verify the plan's operator step by hand if it matters for this change, or fix the renderer. Read the findings above: a finding titled as about the plan could still hide a defect.",
    "",
    `<!-- ${issueMarker(actionKey, failure.head)} -->`
  ].join("\n");
}

/**
 * Record, once per Action and exact head, that QA's only failure was the
 * Operator QA plan, then ask GitHub for one Issue through the injected
 * runner. The record is written before anything else and is what makes the
 * waiver visible; a failure to file is logged and retried (at most once per
 * tick, at most {@link MAX_QA_PLAN_ISSUE_ATTEMPTS} in all) but never changes
 * the verdict outcome. A replay files no second Issue, and an Issue that
 * already carries the marker (a crash after filing) is adopted. Once the head
 * lands nothing asks again, so an Issue that could not be filed before then
 * stays unfiled and only the row, the journey entry and the log remain.
 * Never throws.
 */
export function ensureQaPlanWaiver(db: Database.Database, input: {
  session: AgentSession;
  failure: QaPlanSoleFailure;
  now: Date;
  runCommand?: IndependentReviewDeps["runCommand"];
  cwd: string;
  log?: (message: string) => void;
}): QaPlanWaiverRow | null {
  const { session, failure } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  try {
    ensureQaPlanWaiverTable(db);
    const at = input.now.toISOString();
    const record = qaPlanUnverifiedRecord(actionKey, failure);
    const inserted = db.prepare(`INSERT INTO production_qa_plan_waivers
        (action_key, target_head, session_id, verdict_request_id, pull_request_url, record, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(action_key, target_head) DO NOTHING`)
      .run(actionKey, failure.head, session.id, failure.attempt.request_id, failure.pullRequestUrl, record, at, at).changes === 1;
    if (inserted) {
      input.log?.(record);
      appendJourneyLog(db, { actionKey, source: "review_repair", kind: "qa_plan_unverified", message: record,
        remedy: "Verify the plan's operator step by hand if it matters, or fix src/sessions/operatorQaPlan.ts; the filed Issue tracks it.", at });
    }
    let row = getQaPlanWaiver(db, actionKey, failure.head)!;
    if (row.issue_url !== null || row.issue_attempts >= MAX_QA_PLAN_ISSUE_ATTEMPTS || row.issue_last_attempt_at === at) return row;
    db.prepare("UPDATE production_qa_plan_waivers SET issue_attempts = issue_attempts + 1, issue_last_attempt_at = ?, updated_at = ? WHERE action_key = ? AND target_head = ?").run(at, at, actionKey, failure.head);
    let error: string | null = null;
    let url: string | null = null;
    try {
      const run = input.runCommand ?? runHostCommand;
      const repo = repoOfPullRequest(failure.pullRequestUrl);
      if (!repo) throw new Error("no GitHub repository could be derived from the pull request URL");
      const marker = issueMarker(actionKey, failure.head);
      // A search is a failure point of its own, so it runs only on a retry (an earlier attempt may have
      // created the Issue before the row was updated); the marker is verified client-side from the body.
      let existing: string | null = null;
      if (row.issue_attempts >= 1) {
        const found = run({ command: "gh", args: ["issue", "list", "--repo", repo, "--state", "all", "--search", `"${marker}" in:body`, "--json", "number,url,body", "--limit", "5"], cwd: input.cwd, timeoutMs: 30_000 });
        if (found.status !== 0) throw new Error(`could not check for an existing Issue: ${found.error ?? (found.stderr.trim() || `gh issue list exit ${String(found.status)}`)}`);
        let listed: Array<{ url?: unknown; body?: unknown }>;
        try { listed = JSON.parse(found.stdout || "[]") as typeof listed; } catch { throw new Error("could not check for an existing Issue: unreadable gh issue list output"); }
        const match = Array.isArray(listed) ? listed.find((entry) => typeof entry?.url === "string" && typeof entry.body === "string" && entry.body.includes(`<!-- ${marker} -->`)) : undefined;
        existing = typeof match?.url === "string" ? match.url : null;
      }
      if (existing !== null) url = existing;
      else {
        const result = run({
          command: "gh",
          args: ["issue", "create", "--repo", repo, "--title", `QA verdict failed only the Operator QA plan: ${actionKey} at ${failure.head.slice(0, 12)}`, "--body", issueBody(actionKey, failure, record)],
          cwd: input.cwd, timeoutMs: 30_000
        });
        if (result.status === 0) url = result.stdout.trim().split("\n").at(-1)?.trim() || "(filed; GitHub returned no URL)";
        else error = result.error ?? (result.stderr.trim() || `exit ${String(result.status)}`);
      }
    } catch (thrown) {
      error = errorMessage(thrown);
    }
    db.prepare("UPDATE production_qa_plan_waivers SET issue_url = ?, issue_error = ?, updated_at = ? WHERE action_key = ? AND target_head = ?")
      .run(url, error, at, actionKey, failure.head);
    row = getQaPlanWaiver(db, actionKey, failure.head)!;
    if (error !== null) input.log?.(`Filing the Issue for the unverified Operator QA plan of ${actionKey} at ${failure.head.slice(0, 12)} failed (attempt ${row.issue_attempts} of ${MAX_QA_PLAN_ISSUE_ATTEMPTS}); the verdict outcome is unchanged: ${error}`);
    else input.log?.(`Filed ${url} for the unverified Operator QA plan of ${actionKey} at ${failure.head.slice(0, 12)}.`);
    return row;
  } catch (thrown) {
    input.log?.(`Recording the unverified Operator QA plan of ${actionKey} at ${failure.head.slice(0, 12)} failed: ${errorMessage(thrown)}`);
    return null;
  }
}

/**
 * {@link independentVerdictGate} with Decision 0169's one exception: when the
 * only missing verdict is a QA verdict that failed solely on the host-written
 * Operator QA plan ({@link qaPlanSoleFailure}) and code review is current and
 * passing, QA does not block that head. The unverified step is recorded (and
 * its Issue requested) BEFORE the gate reports satisfied; if it cannot be
 * recorded, the gate stays unsatisfied. Anything else returns the base gate.
 */
export function independentVerdictGateWithQaPlanWaiver(db: Database.Database, input: {
  session: AgentSession;
  repoRoot: string;
  now: Date;
  runCommand?: IndependentReviewDeps["runCommand"];
  log?: (message: string) => void;
}): VerdictGate {
  const base = independentVerdictGate(db, input);
  if (base.satisfied || base.code !== "awaiting_independent_verdicts" || base.missing.length !== 1 || base.missing[0] !== "qa: failed") return base;
  const readiness = independentVerdictReadiness(db, input);
  if (!readiness.ready || readiness.binding.targetHead !== base.head) return base;
  const failure = qaPlanSoleFailure(db, input.session, readiness, readiness.binding.targetHead, input.repoRoot);
  if (!failure) return base;
  const code = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, "code-review");
  if (!code || code.status !== "passed") return base;
  const recorded = ensureQaPlanWaiver(db, { session: input.session, failure, now: input.now, runCommand: input.runCommand, cwd: input.repoRoot, log: input.log });
  if (!recorded) return base;
  return { satisfied: true, binding: readiness.binding, verdicts: { "code-review": code, qa: failure.attempt } };
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
  // A candidate a review repair superseded is never readied, reviewed or
  // integrated again: its PR is a draft until the repair's PR closes it.
  let superseded: string | null | undefined = null;
  try {
    superseded = (db.prepare("SELECT superseded_by_session_id FROM session_exit_receipts WHERE session_id = ? AND outcome = 'accepted_completion'")
      .get(session.id) as { superseded_by_session_id: string | null } | undefined)?.superseded_by_session_id;
  } catch { /* a database without exit receipts has no supersession */ }
  if (superseded) return { kind: "not_applicable", reason: `The candidate was superseded by review repair Session ${superseded}; its PR never integrates.` };
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
      args: ["pr", "view", url, "--json", "state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid,mergeStateStatus,statusCheckRollup"],
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

    // The worker returns a PR to draft itself when it records a real failed
    // verdict on it (src/production/reviewRepair.ts), so a draft whose exact
    // head carries one reports that verdict, never a person pausing the review;
    // so does a PR closed or merged after its verdict failed (the repair loop
    // stops for the operator on it).
    const failedOnHead = pr.isDraft || pr.state.toUpperCase() !== "OPEN" ? realFailedVerdictRole(db, readiness, head) : null;
    if (failedOnHead) {
      return {
        kind: "blocked",
        code: "independent_verdict_failed",
        failedRole: failedOnHead,
        reason: `The independent ${failedOnHead} verdict on ${head.slice(0, 12)} failed; a failed verdict never integrates, and ${url} is ${pr.isDraft ? "a draft" : pr.state}.`,
        remedy: `Read the ${failedOnHead} report Artifact for ${url}; fix the candidate (a new head is reviewed afresh) or, after judging the verdict wrong, mark the PR ready and rerun it with \`arcadia ${failedOnHead === "qa" ? "qa pr" : "qa code-review"} ${url} --rerun\`.`
      };
    }

    // The repair loop returned this PR to draft itself for red required checks
    // it attributed to the candidate's own change, and its repair has not
    // launched yet (a held launch): while those checks are still red that is
    // the same failure, never a person pausing the review.
    if ((pr.isDraft || pr.state.toUpperCase() !== "OPEN") && classifyPullRequestChecks(pr.statusCheckRollup).state === "failed") {
      ensureReviewRepairTable(db);
      const checksRepair = getReviewRepair(db, requiredChecksRepairRequestId(session.id, head));
      if (checksRepair && checksRepair.outcome === "pending" && checksRepair.drafted_at !== null && checksRepair.repair_session_id === null) {
        return {
          kind: "blocked",
          code: "required_checks_failed",
          checkFailure: { head, pullRequestUrl: url, baseRefOid: typeof pr.baseRefOid === "string" ? pr.baseRefOid : null, checks: nonSuccessChecks(pr.statusCheckRollup) },
          reason: `Required checks on ${url} at ${head.slice(0, 12)} failed in the candidate's own change; the review repair loop returned it to draft and its repair waits to launch.`,
          remedy: "No operator step is needed while the repair can launch; the escalation names anything that holds it."
        };
      }
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
    // A stacked base is an ordinary agent branch: if its tip moved (onto this
    // candidate's own commits, say), GitHub's diff from it is no longer this
    // candidate's whole change, and the reviewers judge that diff.
    if (opened?.kind === "stacked" && opened.tip && typeof pr.baseRefOid === "string" && pr.baseRefOid !== opened.tip) {
      return {
        kind: "blocked",
        code: "review_pull_request_unavailable",
        reason: `PR ${url}'s stacked base ${opened.branch} moved from ${opened.tip.slice(0, 12)}, the tip host preservation opened it on, to ${pr.baseRefOid.slice(0, 12)}; `
          + "the PR's diff is no longer the candidate's own change, so no verdict is requested.",
        remedy: `Restore ${opened.branch} on the remote to ${opened.tip} (it is the previous candidate's branch; Arcadia never moves it, and moving it back is an operator decision), `
          + "or review and land the candidate by hand; the next tick resumes."
      };
    }

    /**
     * Whether the review repair loop itself returned this PR to draft on this
     * exact head (its unlaunched repair row records the draft) for a failed
     * verdict that is no longer current only because it was judged under an
     * earlier criteria binding (a `JUDGEMENT_REVISION` bump): same head, same
     * evidence, same requirement input. Never a person's pause.
     */
    const workerDraftedSupersededVerdict = (): boolean => {
      const superseded = INDEPENDENT_VERDICT_ROLES.some((role) => {
        const latest = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
        return latest !== null && latest.status === "failed" && latest.target_head === head
          && latest.evidence_fingerprint === readiness.binding.evidenceFingerprint
          && latest.criteria_fingerprint !== readiness.binding.criteriaFingerprint;
      });
      if (!superseded) return false;
      ensureReviewRepairTable(db);
      const repair = getReviewRepair(db, reviewRepairRequestId(session.id, head));
      return repair !== null && repair.drafted_at !== null && repair.repair_session_id === null;
    };

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

    /**
     * Whether the repair loop drafted this PR for red required checks that are
     * green now, before its repair launched: that repair is released (it can
     * never launch) and the PR is readied again, never left as a person's pause.
     */
    const releasedGreenChecksDraft = (): boolean => {
      if (!pr.isDraft || classifyPullRequestChecks(pr.statusCheckRollup).state === "failed") return false;
      ensureReviewRepairTable(db);
      const released = db.prepare(`UPDATE production_review_repairs SET outcome = 'released', reason = ?, updated_at = ?
        WHERE request_id = ? AND outcome = 'pending' AND repair_session_id IS NULL AND drafted_at IS NOT NULL`)
        .run(`The required checks on ${head.slice(0, 12)} are no longer failing; this repair is never launched.`, at, requiredChecksRepairRequestId(session.id, head)).changes > 0;
      if (released) appendReviewRepairJourneyLog(db, requiredChecksRepairRequestId(session.id, head), at);
      if (released) input.log?.(`Released the pending required-checks repair for ${actionKey} at ${head.slice(0, 12)}: its checks are no longer failing.`);
      const row = getReviewRepair(db, requiredChecksRepairRequestId(session.id, head));
      return row !== null && row.outcome === "released" && row.drafted_at !== null && row.repair_session_id === null;
    };

    if (pr.isDraft && step.ready_at && !workerDraftedSupersededVerdict() && !releasedGreenChecksDraft()) {
      // The tick readied it once; someone converted it back to draft. That is
      // a person pausing the review, never something to undo every minute.
      // The one exception is the repair loop's own return to draft for a
      // failed verdict judged under an earlier judgement revision: that
      // verdict is no longer current, so the PR is readied for its re-review.
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
        checkFailure: { head, pullRequestUrl: url, baseRefOid: typeof pr.baseRefOid === "string" ? pr.baseRefOid : null, checks: nonSuccessChecks(pr.statusCheckRollup), remedy: unknown.trim() || undefined },
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

    /** Variance verdicts this role has recorded on this exact head: the durable count behind the rerun bound. */
    const varianceAttempts = (role: IndependentVerdictRole): number =>
      roleAttemptsOnHead(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role, head)
        .filter((attempt) => attempt.status === "failed" && varianceFromReceipt(attempt.terminal_receipt_json) !== null).length;
    const failedVerdict = (role: IndependentVerdictRole): ReviewStepOutcome => ({
      kind: "blocked",
      code: "independent_verdict_failed",
      failedRole: role,
      reason: `The independent ${role} verdict on ${head.slice(0, 12)} failed; a failed verdict never integrates.`,
      remedy: `Read the ${role} report Artifact for ${url}; fix the candidate (a new head is reviewed afresh) or, after judging the failure wrong, rerun it with \`arcadia ${role === "qa" ? "qa pr" : "qa code-review"} ${url} --rerun\`.`
    });
    const variancesSpent = (role: IndependentVerdictRole, spent: number): ReviewStepOutcome => {
      const last = roleAttemptsOnHead(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role, head)
        .filter((attempt) => attempt.status === "failed").map((attempt) => varianceFromReceipt(attempt.terminal_receipt_json)).filter((reason) => reason !== null).at(-1);
      return {
        kind: "blocked",
        code: "independent_verdict_failed",
        reason: `The independent ${role} verdict on ${head.slice(0, 12)} was not a pass on ${spent} of ${MAX_VARIANCE_REVIEW_ATTEMPTS} attempts, each reviewer variance only (no finding and no criterion judged fail); the automatic reruns are spent and a failed verdict never integrates. Last reason: ${last ?? "unknown"}`,
        remedy: `Read the ${role} report Artifact for ${url}; fix the candidate (a new head is reviewed afresh) or, after judging the verdict wrong, rerun it by hand with \`arcadia ${role === "qa" ? "qa pr" : "qa code-review"} ${url} --rerun\`.`
      };
    };

    // Checks are green on the exact settled head: the next missing verdict, one per tick.
    for (const role of INDEPENDENT_VERDICT_ROLES) {
      const latest = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
      const sameBinding = latest !== null && latest.target_head === head
        && latest.criteria_fingerprint === readiness.binding.criteriaFingerprint
        && latest.evidence_fingerprint === readiness.binding.evidenceFingerprint;
      if (sameBinding && latest.status === "passed") continue;
      // Decision 0169: a QA verdict whose only failure is the host-written
      // Operator QA plan is neither rerun nor repaired; the gate reads it as
      // not blocking once the unverified step is recorded.
      if (role === "qa" && sameBinding && latest.status === "failed") {
        const planOnly = qaPlanSoleFailure(db, session, readiness, head, repoRoot);
        if (planOnly) {
          ensureQaPlanWaiver(db, { session, failure: planOnly, now, runCommand, cwd: repoRoot, log: input.log });
          continue;
        }
      }
      const rerun = sameBinding && latest.status === "failed";
      // Only the failed attempt's own receipt can authorize re-judging the same
      // binding: the reviewer was unavailable (or the run went stale), or the
      // verdict was pure reviewer variance and its bounded reruns are not
      // spent. A real non-pass judgment is never re-run automatically.
      let automaticRerun: { attempt: number; reason: string } | null = null;
      if (rerun && !retryableVerdictReceipt(latest.terminal_receipt_json)) {
        const variance = varianceFromReceipt(latest.terminal_receipt_json);
        const spent = variance === null ? 0 : varianceAttempts(role);
        if (variance === null || spent >= MAX_VARIANCE_REVIEW_ATTEMPTS) {
          return variance === null ? failedVerdict(role) : variancesSpent(role, spent);
        }
        automaticRerun = { attempt: spent + 1, reason: variance };
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
        if (code === "review_execution_claimed") {
          return { kind: "waiting", reason: `The ${role} reviewer is already executing or has an uncertain execution claim; preserve its claim and wait for canonical evidence without spending the failure budget.` };
        }
        if (code === "managed_production_off") return { kind: "waiting", reason: `Withheld the ${role} reviewer: managed production is Off.` };
        if (code === "verdict_not_ready") {
          return {
            kind: "blocked",
            code: "review_head_moved",
            reason: `The ${role} reviewer refused: the PR head is no longer the candidate's ready head (${errorMessage(error)}).`,
            remedy: `Restore ${session.branch} on the remote to ${head}; a moved head never receives a verdict.`
          };
        }
        if (code === "attempt_limit_exhausted") {
          // The lineage budget is spent for this requirement input revision:
          // no retry can succeed, so it is named for the operator, never
          // counted as a transient step failure (whose reset cannot help).
          const limit = verdictAttemptLimit(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
          return {
            kind: "blocked",
            code: "review_attempts_exhausted",
            reason: `The independent ${role} of ${actionKey} at ${head.slice(0, 12)} cannot start: this Action's ${role} verdict attempts are spent (${limit} of ${limit}: ${MAX_VERDICT_ATTEMPTS} verdicts, not counting reviewer-unavailable attempts, per requirement input revision, every head and rerun counted); no reviewer runs unattended.`,
            remedy: `Read the earlier ${role} report Artifacts for ${url}; revise the Action through a governed Plan amendment (a new requirement input revision restarts the budget), or decide the candidate yourself. \`arcadia production reset-repair-budget\` does not restore lineage attempts.`
          };
        }
        return fail(role, `${role} review of ${url} failed: ${errorMessage(error)}`);
      } finally {
        input.heartbeat?.();
        // Named once, and only when the rerun's lineage attempt was really
        // allocated (a different attempt row than the variance verdict's): a
        // failure before allocation (GitHub, the policy fence) repeats nothing.
        if (automaticRerun) {
          const allocated = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
          if (allocated && allocated.request_id !== latest?.request_id) {
            input.log?.(`Automatic rerun of the independent ${role} of ${actionKey} at ${head.slice(0, 12)}: attempt ${automaticRerun.attempt} of ${MAX_VARIANCE_REVIEW_ATTEMPTS}; the previous verdict was ${automaticRerun.reason}`);
          }
        }
      }
      const unavailable = result.data.reviewerUnavailable;
      if (unavailable) return fail(role, `${role} reviewer unavailable for ${url}: ${unavailable}`);
      succeeded();
      if (result.data.verdict !== "pass") {
        input.log?.(`Independent ${role} of ${actionKey} at ${head.slice(0, 12)}: ${result.data.verdict}.`);
        // The lineage attempt's own receipt, finished last, is the durable fact
        // (a stale or unfinished run records no variance): the same one the
        // next tick reads, so a restart cannot disagree with this decision.
        const recorded = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
        const variance = recorded?.status === "failed" && recorded.target_head === head ? varianceFromReceipt(recorded.terminal_receipt_json) : null;
        if (variance !== null) {
          const spent = varianceAttempts(role);
          if (spent >= MAX_VARIANCE_REVIEW_ATTEMPTS) return variancesSpent(role, spent);
          return {
            kind: "advanced",
            step: role,
            reason: `The independent ${role} verdict on ${head.slice(0, 12)} was ${result.data.verdict} on attempt ${spent} of ${MAX_VARIANCE_REVIEW_ATTEMPTS}, ${variance} `
              + `Automatic rerun ${spent + 1} of ${MAX_VARIANCE_REVIEW_ATTEMPTS} follows on a later tick.`
          };
        }
        const planOnly = role === "qa" ? qaPlanSoleFailure(db, session, readiness, head, repoRoot) : null;
        if (planOnly) {
          ensureQaPlanWaiver(db, { session, failure: planOnly, now, runCommand, cwd: repoRoot, log: input.log });
          return {
            kind: "advanced",
            step: role,
            reason: `The independent qa verdict on ${head.slice(0, 12)} failed only the host-written Operator QA plan: no repair round is spent, one operator check step is recorded as unverified and an Issue is requested.`
          };
        }
        return {
          kind: "blocked",
          code: "independent_verdict_failed",
          failedRole: role,
          reason: `The independent ${role} verdict on ${head.slice(0, 12)} is ${result.data.verdict}: ${result.data.summary}`,
          remedy: `Read ${result.data.reportPath}; fix the candidate (a new head is reviewed afresh) or, after judging the verdict wrong, rerun it with \`arcadia ${role === "qa" ? "qa pr" : "qa code-review"} ${url} --rerun\`.`
        };
      }
      input.log?.(`Independent ${role} of ${actionKey} at ${head.slice(0, 12)} passed${result.data.reused ? " (existing receipt)" : ""}${automaticRerun ? ` on automatic rerun ${automaticRerun.attempt} of ${MAX_VARIANCE_REVIEW_ATTEMPTS}` : ""}.`);
      return {
        kind: "advanced",
        step: role,
        reason: `Recorded a passing independent ${role} verdict for ${head.slice(0, 12)}${automaticRerun ? ` on automatic rerun ${automaticRerun.attempt} of ${MAX_VARIANCE_REVIEW_ATTEMPTS} (the previous verdict was ${automaticRerun.reason})` : ""}.`
      };
    }
    return { kind: "waiting", reason: "Both verdicts are recorded; the gate decides integration." };
  })();
  // The exhausted budget is re-derived before every poll; every other polled
  // outcome is replayed until the next poll.
  if (outcome.kind !== "blocked" || outcome.code !== "review_budget_exhausted") update({ last_outcome_json: JSON.stringify(outcome) });
  return outcome;
}
