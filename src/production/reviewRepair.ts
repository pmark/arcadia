import type Database from "better-sqlite3";
import { classifyAuthorityPaths, type AuthorityBoundary } from "../decisions/batchMerge.js";
import { isAncestor, tryGit } from "../git/worktrees.js";
import { runHostCommand, type QaPrReviewDependencies } from "../qa/prReview.js";
import type { AgentSession } from "../sessions/index.js";
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
 *    authority-adjacent, when the candidate's own changes touch a checked-in
 *    authority boundary (the batch-merge path classifier), or when this run
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
 * Whether the reviewer flagged the verdict authority-adjacent: a finding that
 * names authority, credentials or approval boundaries, or a failed
 * Security-and-authority / Approval-boundaries check while Correctness itself
 * did not fail (a failure about authority, not a defect that fails everything).
 */
export function verdictIsAuthorityAdjacent(findings: ReviewRepairFinding[], checks: ReviewRepairCheck[]): string | null {
  const flagged = findings.find((finding) => AUTHORITY_TEXT.test(`${finding.title} ${finding.recommendation}`));
  if (flagged) return `the reviewer's finding "${flagged.title}" concerns authority`;
  const failed = (pattern: RegExp) => checks.some((check) => pattern.test(check.name) && check.status === "fail");
  if ((failed(/security and authority/i) || failed(/approval boundar/i)) && !failed(/^correctness$/i)) {
    return "the reviewer failed the Security-and-authority or Approval-boundaries criterion";
  }
  return null;
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

/**
 * Return the failed PR to draft, then post its one comment: each once per
 * failed head, recorded on the repair row, so a restart repeats neither. The
 * policy is re-read before each side effect. Returns an error, or null.
 */
function notifyPullRequest(db: Database.Database, row: ReviewRepairRow, input: { repoRoot: string; now: Date; runCommand: RunCommand; authorized: () => string | null }): string | null {
  const url = row.pull_request_url;
  if (!url) return null;
  const mark = (column: "drafted_at" | "commented_at") =>
    db.prepare(`UPDATE production_review_repairs SET ${column} = ?, last_error = NULL, updated_at = ? WHERE request_id = ?`).run(input.now.toISOString(), input.now.toISOString(), row.request_id);
  if (!row.drafted_at) {
    const fenced = input.authorized();
    if (fenced) return `withheld returning ${url} to draft: ${fenced}`;
    const undone = input.runCommand({ command: "gh", args: ["pr", "ready", url, "--undo"], cwd: input.repoRoot, timeoutMs: 30_000 });
    if (undone.status !== 0) return `gh pr ready ${url} --undo failed: ${undone.error ?? (undone.stderr.trim() || `exit ${String(undone.status)}`)}`;
    mark("drafted_at");
  }
  if (!row.commented_at) {
    const fenced = input.authorized();
    if (fenced) return `withheld the verdict comment on ${url}: ${fenced}`;
    const commented = input.runCommand({ command: "gh", args: ["pr", "comment", url, "--body", renderFailedVerdictComment(row)], cwd: input.repoRoot, timeoutMs: 30_000 });
    if (commented.status !== 0) return `gh pr comment ${url} failed: ${commented.error ?? (commented.stderr.trim() || `exit ${String(commented.status)}`)}`;
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
    const paths = agentChangedPaths(repoRoot, session.base_revision, start);
    const boundaries: AuthorityBoundary[] = paths === null ? ["unclassifiable_path"] : paths.length > 0 ? classifyAuthorityPaths(paths) : [];
    const rounds = launchedRepairRounds(db, actionKey, policy.epoch);
    if (adjacent) {
      outcome = "gated"; reason = `The verdict is authority-adjacent (${adjacent}); a repair is never launched unattended for it.`;
    } else if (boundaries.length > 0) {
      outcome = "gated"; reason = `The candidate's own changes touch checked-in authority boundaries (${boundaries.join(", ")}); the repair loop stops for the operator.`;
    } else if (rounds >= MAX_REVIEW_REPAIR_ROUNDS) {
      outcome = "escalated"; reason = `The ${MAX_REVIEW_REPAIR_ROUNDS} repair rounds for ${actionKey} in this production run are spent, and the latest repaired head still failed.`;
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

  // Visible on GitHub before anything else: draft and one comment per failed head.
  const notifyError = notifyPullRequest(db, row, { repoRoot, now, runCommand: input.runCommand ?? runHostCommand, authorized: authorizedNow });
  if (notifyError) {
    if (row.last_error !== notifyError) {
      db.prepare("UPDATE production_review_repairs SET last_error = ?, updated_at = ? WHERE request_id = ?").run(notifyError, now.toISOString(), requestId);
      input.log?.(`Review repair for ${actionKey}: ${notifyError}; retried next tick.`);
    }
    return { kind: "waiting", reason: notifyError };
  }

  const findings = renderRepairFindings(row).join("\n");
  if (row.outcome === "gated" || row.outcome === "escalated") {
    const escalation = row.outcome === "gated" ? REVIEW_REPAIR_GATED : REVIEW_REPAIR_ROUNDS_EXHAUSTED;
    input.escalate(escalation,
      `The independent ${row.role} verdict on ${row.failed_head.slice(0, 12)} is ${row.verdict}; ${row.reason ?? "the repair loop stopped"} Findings (report ${row.report_path ?? "unavailable"}):\n${findings}`,
      `Read the report and the findings above; fix the candidate yourself (a new head is reviewed afresh), or, after judging the verdict wrong, mark ${row.pull_request_url ?? "its PR"} ready and rerun it with \`arcadia ${row.role === "qa" ? "qa pr" : "qa code-review"} ${row.pull_request_url ?? "<PR>"} --rerun\`. The PR is a draft with the verdict comment; nothing integrates meanwhile.`);
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
