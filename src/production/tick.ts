import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import { attemptAutoSettlePendingCompletion } from "../ask/autoSettleBeforeDispatch.js";
import { listUnsettledAgentAskProposals, recordCommittedCompletionSettlement, settleAgentAsk } from "../ask/settlement.js";
import { surfaceMergedAgentAsks, type MergedAskSurfacing } from "../ask/surfaceMergedAsks.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { type ProviderCapacityObservation } from "../codingAgents/capacity.js";
import { describeClaudeUsageRefreshState, readClaudeUsageRefreshState, type ClaudeUsageRefreshState } from "../codingAgents/availability.js";
import type { ProviderSignInStatus } from "../codingAgents/signIn.js";
import { runWorkPlanCommand } from "../commands/work.js";
import { writeTransaction } from "../db/connection.js";
import { getProjectBySlug, getProjectMetadata, getReviewItem, getWorkItemByDocRef, listActionableReviewItems, updateReviewItemStatus } from "../db/repositories.js";
import { OPERATOR_PING_MESSAGE_MAX, queueOperatorPing } from "../ping/operatorPing.js";
import { planStepsForWorkItem } from "../execution/skills.js";
import { listProjectsInSchedulingOrder, recordFailedRun, runSchedulingPass, type BoardFactory, type SchedulingPassResult } from "../scheduling/scheduler.js";
import { getSchedulingProject } from "../scheduling/store.js";
import { git, isAncestor, projectCheckoutFor, resolveBaseBranch, tryGit } from "../git/worktrees.js";
import type { DispatchBlocker } from "../docs/dispatch.js";
import type { OperatorGateItem } from "../docs/operatorGate.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { latestCandidateSettlementCommit, listPendingTerminalCandidates, operatorHeldEscalation, pendingTerminalCandidateFor } from "./terminalCandidates.js";
import { activeActionScopeGate, policyAuthorizesRemotePreservation, PRODUCTION_CONTROL_DEADLINES, SCOPE_HELD_CODE, readProductionPolicySafely, resolveWorkItemPolicyIdentity, SIGN_IN_FAILURE_HOLD_MS, selectPolicyPermittedProfileName } from "./policy.js";
import { decodeStringArray } from "../projects/setup.js";
import {
  ensureRedAlertTables,
  observeAdmission,
  observeReconcileFailure,
  observeReconcileSuccess,
  observeRepairBudget,
  observeScopeDriftForProject,
  raiseScopeSuccessorHeld,
  observeStall,
  safelyRaiseRedAlerts
} from "./redAlerts.js";
import { canonicalPath, getRepositoryLease, resolveProjectTransition, systemTmux, type AgentSession, type ProjectTransition, type TmuxAdapter } from "../sessions/index.js";
import { launchGuardedHostSession, resumedSessionSupersededAskIds } from "../sessions/launch.js";
import { formatLaunchFailure } from "../sessions/launchFailure.js";
import { clearPreservationRefusal } from "../sessions/preservationRefusalBudget.js";
import { COMPLETION_REFUSED_REPEATEDLY_ESCALATION, COMPLETION_VALIDATION_UNAVAILABLE_ESCALATION, draftedCompletionRefusalSubject, draftedCompletionTimeoutSubject, findAcceptedTerminalCompletion, findCandidateSettledCompletion, PROVIDER_SIGN_IN_FAILURE_PREFIX, getSessionContinuation, reconcileSessionExit } from "../sessions/reconciliation.js";
import { refreshPreservedPullRequestBody, systemPreservationRemote, type CandidatePreservationReceipt, type CandidatePreservationRemote } from "../sessions/candidatePreservation.js";
import { discoverDocs } from "../docs/discover.js";
import { observeSessionActivity } from "./stallDetection.js";
import { appendJourneyLog, ensureActionJourneyLogTable } from "./journeyLog.js";
import { enforceSessionLifetime } from "./sessionLifetime.js";
import {
  BUDGET_EXHAUSTED_ESCALATION_KIND,
  decideTokenCeilingBreach,
  describeBudgetExhausted,
  resolveSessionTokenCeiling,
  sessionTokenCeilingBreach
} from "./sessionTokenCeiling.js";
import { sessionLogPath } from "../sessions/sessionRecording.js";
import { readSessionProbeNonce } from "../sessions/sessionProbeCommand.js";
import {
  describeEnvironmentWalls,
  observeSessionCapability,
  type SessionCapabilityObservation,
  ENVIRONMENT_WALL_ESCALATION_KIND,
  SESSION_PROBE_TOKEN_BUDGET,
  sessionTokensFromLog,
  type EnvironmentWall
} from "./sessionCapability.js";
import { activateNextPlan } from "../dispatch/planActivationApply.js";
import { concludeOperatorLaunchExit, operatorLaunchForExit, preserveOperatorLaunchExit, retryOperatorLaunchPublications } from "./operatorLaunchHandoff.js";
import { candidateLandingCommand, handoffIntegrated, integrateSessionCandidate, operatorMergeCommand, preserveSessionCandidate, type IntegrateSessionDeps, type PreservationStep, type PreserveSessionDeps, type SessionHandoffResult } from "./sessionHandoff.js";
import type { CompletionValidationOptions } from "../sessions/completionValidation.js";
import { createId } from "../utils/id.js";
import { independentVerdictGate, requirementIdentity, runHelperAttempt, type VerdictGate } from "../sessions/roleLineage.js";
import {
  advanceIndependentReview,
  ensureProductionReviewStepTable,
  REVIEW_BLOCK_CODES,
  resetReviewSteps,
  reviewApplicability,
  type IndependentReviewDeps,
  type RequiredChecksFailure,
  type ReviewStepOutcome
} from "./independentReview.js";
import { getReviewRepair, requiredChecksRepairRequestId } from "../sessions/reviewRepair.js";
import { attemptReviewRepair, closeSupersededPullRequests, gateRepairCandidate, releaseMergedReviewRepairs, releaseStalePendingRepair, REVIEW_REPAIR_ESCALATIONS } from "./reviewRepair.js";

/**
 * The continuous half of managed production: on every worker tick, while the
 * standing policy is Active, reconcile any repository whose Session died
 * without being observed, flag (never reconcile) a live Session whose tmux
 * has stopped showing any real progress, admit and launch the next eligible
 * Action for every other eligible repository, and independently notice when a
 * repository's base branch moved for a reason this tick did not itself cause
 * (a human or another host merged its PR). This module owns none of the primitives it
 * calls -- admission, launch, and reconciliation are exactly the same calls a
 * human-triggered `arcadia advance`/`session launch` already makes -- it only
 * decides, once per tick, which repository each of those calls applies to,
 * and remembers how many times a repository has failed in a row so a broken
 * Action stops retrying instead of looping forever on tokens.
 */

export interface ManagedProductionTickOptions {
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  now?: Date;
  tmux?: TmuxAdapter;
  /** Test-only override for the standing-policy provider capacity observation. */
  capacityObservation?: ProviderCapacityObservation;
  /**
   * Last recorded outcome of the read-only Claude usage refresh (Decision
   * 0130). Defaults to the host snapshot (and to null under test). Used only
   * to name why a stale/unknown reading refused a launch.
   */
  claudeUsageRefreshState?: () => ClaudeUsageRefreshState | null;
  /** Test-only override for where a newly launched agent worktree is created. */
  agentWorktreeRoot?: string;
  /** Test-only override for the provider sign-in preflight; defaults to `checkProviderSignIn`. */
  providerSignIn?: (provider: string, workspace: string) => ProviderSignInStatus | null;
  /**
   * Pre-launch Session capability preflight (workspace write, host validation,
   * preservation). Any wall refuses the launch before a Session is prepared, so
   * no tokens are spent. The worker supplies `probeWorkerCapability`; absent,
   * no preflight runs.
   */
  workerCapability?: (workspace: string) => EnvironmentWall[];
  /**
   * Re-stamp the preservation transport heartbeat between per-Project steps.
   * The tick blocks the event loop for minutes, so the worker's own 5s timer
   * cannot fire while it runs; this is how the 15s freshness window survives.
   */
  heartbeat?: () => void;
  log?: (message: string) => void;
  /** Override how a Project's GitHub board is reached; tests pass an in-memory board. */
  boardFactory?: BoardFactory;
  /** Test overrides for the terminal-session preservation/integration handoff. */
  handoff?: { preserve?: PreserveSessionDeps; integrate?: IntegrateSessionDeps; completionValidation?: CompletionValidationOptions };
  /**
   * Overrides for the unattended review of a preserved candidate PR (the
   * GitHub CLI and reviewer runner, the reviewer selection, deadlines). The
   * push of a settled head reuses `handoff.preserve.remote` unless `remote`
   * is given here.
   */
  review?: IndependentReviewDeps;
  /**
   * The current time, re-read after long steps (a reviewer run) so a grant
   * that expired meanwhile is honored. Defaults to `now` when one is given
   * (deterministic tests), else the wall clock.
   */
  clock?: () => Date;
}

export interface BaseBranchAdvanceObservation {
  changed: boolean;
  previousSha: string | null;
  newSha: string;
  baseBranch: string;
}

export type ManagedProductionLaunchOutcome =
  | "launched"
  | "reused"
  | "auto_settled"
  | "refused"
  | "failed"
  | "repair_budget_exhausted"
  | "skipped";

export interface ManagedProductionLaunchAttempt {
  attempted: boolean;
  outcome: ManagedProductionLaunchOutcome;
  reason: string;
  actionKey: string | null;
}

export interface ManagedProductionTickProjectResult {
  projectSlug: string;
  repositoryRoot: string | null;
  baseBranchAdvance: BaseBranchAdvanceObservation | null;
  /** Merged Agent Asks this tick surfaced as pending approvals; null when base-branch observation did not run or failed. */
  askSurfacing?: MergedAskSurfacing | null;
  reconciled: Array<{ sessionId: string; outcome: string }>;
  handoff: SessionHandoffResult | null;
  launch: ManagedProductionLaunchAttempt | null;
}

/** Superseded terminal candidates already reported by this worker process (Issue #1158). */
const reportedSupersededTerminalCandidates = new Set<string>();

/**
 * A terminal Session no longer holds the repository lease. Rediscover its
 * unfinished handoff from the existing exit, preservation and settlement
 * receipts, without creating a replacement Session or a second retry store.
 * A refusal remains visible on every tick until the exact candidate and a
 * current integration Grant allow the existing fast-forward path to finish.
 */
function recoverTerminalHandoff(
  db: Database.Database,
  workspace: string,
  repoRoot: string,
  projectSlug: string,
  now: Date,
  preserveDeps: PreserveSessionDeps,
  integrateDeps: IntegrateSessionDeps,
  log?: (message: string) => void,
  review?: { deps: IndependentReviewDeps; heartbeat?: () => void; clock?: () => Date }
): TerminalHandoffRecovery | null {
  const hasPreservationTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_preservation_receipts'").get());
  // Selection is shared with the scheduler's pointer hold (Issue #1512), so
  // the two never disagree about which candidate recovery still owns. An
  // unfinished exit whose candidate already carries this Action's own
  // recorded completion settlement is terminal too (Issue #994); the terminal
  // guards below refuse it (the head is not the settlement commit) and
  // escalate once.
  const candidates = listPendingTerminalCandidates(db, repoRoot, projectSlug, {
    onSuperseded: (session, action) => {
      // Reported once per worker process per (Session, Action input revision):
      // the candidate is skipped identically on every tick (Issue #1158).
      const reportKey = `${session.id}\u0000${action ? requirementIdentity({ projectSlug: session.project_slug, planSlug: session.plan_slug, action }).inputRevision : ""}`;
      if (!reportedSupersededTerminalCandidates.has(reportKey)) {
        reportedSupersededTerminalCandidates.add(reportKey);
        log?.(`Terminal candidate of Session ${session.id} (${session.project_slug}/${session.action_id}) was developed for a superseded input of its Action; it stays as preserved on ${session.branch} and no longer claims this repository's handoff.`);
      }
    }
  });
  if (!candidates) return null;
  const { baseBranch, pending } = candidates;
  if (pending.length === 0) return null;

  const session = pending[0];
  let merge = operatorMergeCommand({ repoRoot, branch: session.branch, baseBranch });
  let preservedRow = hasPreservationTable
    ? db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?")
        .get(`worker-tick-preserve-${session.id}`) as { receipt_json: string } | undefined
    : undefined;
  let preserved: CandidatePreservationReceipt | null = null;
  let terminalPreservedThisTick = false;
  try { preserved = preservedRow ? JSON.parse(preservedRow.receipt_json) as CandidatePreservationReceipt : null; } catch { /* refuse below */ }
  // Once the base has advanced past the candidate's merge base a fast-forward
  // cannot land it: offer the head-pinned GitHub merge instead (Issue #1632).
  merge = candidateLandingCommand({ repoRoot, branch: session.branch, baseBranch,
    head: tryGit(session.worktree_path, ["rev-parse", "HEAD"])?.trim() ?? null, pullRequestUrl: pullRequestUrlOf(preservedRow) });
  let preservation: SessionHandoffResult["preservation"] = preserved
    ? { kind: "preserved", receiptId: preserved.id, commitSha: preserved.commitSha,
        state: preserved.preservationState, replayed: true, baseBranch: preserved.baseBranch }
    : { kind: "refused", reason: "No canonical worker preservation and validation receipt exists for the terminal Session." };
  // Every guard below refuses through here, so each refusal also carries the
  // read-only facts the tick needs to escalate it once (Issue #981). Nothing
  // here changes which candidate is refused or why.
  const refused = (reason: string, facts: { head?: string | null; settlementCommit?: string | null } = {}): TerminalHandoffRecovery => {
    let head: string | null = facts.head ?? null;
    if (facts.head === undefined) {
      // Observability only: a Git timeout here must not turn a plain refusal
      // into a reconciliation failure.
      try { head = tryGit(session.worktree_path, ["rev-parse", "HEAD"])?.trim() ?? null; } catch { head = null; }
    }
    return {
      handoff: { preservation, integration: { kind: "refused", reason, operatorMergeCommand: merge } },
      sessionId: session.id,
      head,
      refusal: { session, reason, head, settlementCommit: facts.settlementCommit ?? null, operatorMergeCommand: merge }
    };
  };
  if (pending.length !== 1) return refused("Multiple unfinished terminal candidates claim this repository; integration is ambiguous.");
  if (!preserved) {
    const policyRead = readProductionPolicySafely(db);
    const policy = policyRead.status === "ok" ? policyRead.policy : null;
    const scope = policy?.scope;
    const grant = scope?.integrationGrant;
    const actionKey = `${session.project_slug}/${session.action_id}`;
    if (!policy || policy.desiredState !== "active" || !scope) return refused("Managed production is Inactive; terminal validation and integration are withheld.");
    if (!scope.projects.includes(session.project_slug) || !scope.plans.includes(`${session.project_slug}/${session.plan_slug}`)
      || !scope.actions.includes(actionKey) || !scope.mechanicalTransitions.includes("validation")
      || !grant || !(grant.actions.length ? grant.actions : scope.actions).includes(actionKey)
      || Number.isNaN(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now.getTime()) {
      return refused("No current exact validation and integration Grant authorizes terminal recovery.");
    }
    if (!findAcceptedTerminalCompletion(db, session)) return refused("The terminal candidate lacks an unchanged accepted completion settlement.");
    if (!isAncestor(repoRoot, baseBranch, session.branch)) return refused("The terminal candidate cannot fast-forward the governed base.");
    preservation = preserveSessionCandidate({ db, workspace, repoRoot, session, now, terminalRecovery: true }, preserveDeps);
    if (preservation.kind !== "preserved") return refused(`Terminal validation or preservation refused: ${preservation.reason}`);
    terminalPreservedThisTick = true;
    preservedRow = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?")
      .get(`worker-tick-preserve-${session.id}`) as { receipt_json: string } | undefined;
    try { preserved = preservedRow ? JSON.parse(preservedRow.receipt_json) as CandidatePreservationReceipt : null; } catch { preserved = null; }
  }
  if (!preserved || !preserved.validationEvidenceRef || !preserved.candidateFingerprint
    || preserved.requestId !== `worker-tick-preserve-${session.id}`
    || canonicalPath(preserved.repositoryPath) !== canonicalPath(repoRoot)
    || canonicalPath(preserved.candidateWorktreePath) !== canonicalPath(session.worktree_path)
    || preserved.branch !== session.branch || preserved.baseBranch !== baseBranch
    || preserved.baseRevision !== session.base_revision || preserved.actionId !== session.action_id
    || (terminalPreservedThisTick
      ? preserved.terminalSessionId !== session.id
      : preserved.terminalSessionId !== undefined && preserved.terminalSessionId !== session.id)
    || preserved.packetSha256 !== session.packet_sha256) {
    return refused("The terminal candidate lacks matching preservation and passing validation evidence.");
  }
  const head = tryGit(session.worktree_path, ["rev-parse", "HEAD"])?.trim() ?? null;
  const status = tryGit(session.worktree_path, ["status", "--porcelain", "--untracked-files=all"]);
  if (!head || status === null || status.trim()) return refused("The terminal candidate worktree is missing or changed.", { head });
  const settlement = findCandidateSettledCompletion(db, session, head);
  if (!settlement || head !== settlement.documentsCommit || !isAncestor(session.worktree_path, preserved.commitSha, head)) {
    return refused("The terminal candidate differs from its exact canonical completion settlement.", {
      head, settlementCommit: settlement?.documentsCommit ?? null
    });
  }
  // A Grant that lapsed after this candidate was preserved (a long serial
  // chain outrunning its window) refuses here like any other terminal guard,
  // so it is escalated once and shown in `production status`. Left to the
  // integration step, it refused before the verdict gate that records a wait,
  // and the candidate waited with nothing visible at all.
  const lapsed = lapsedIntegrationGrant(db, session, now);
  if (lapsed) return refused(lapsed, { head });
  // Every terminal guard passed: an escalation recorded while one of them
  // refused is stale now, whatever the integration step decides next.
  clearTerminalCandidateEscalation(db, `${session.project_slug}/${session.action_id}`);
  let reviewOutcome: ReviewStepOutcome | undefined;
  const handoff: SessionHandoffResult = {
    preservation,
    integration: integrateSessionCandidate({ db, workspace, repoRoot, session, now, expectedCandidateHead: head, clock: review?.clock,
      // Called only once policy, scope, grant and an exact fast-forward all
      // hold: the one place the tick may advance the candidate's unattended
      // review by a step before the gate decides.
      verdictGate: () => {
        // A review repair's own candidate on Decision 0098's gate list is never
        // readied or reviewed: it stops for the operator like a failed verdict.
        const repairGate = gateRepairCandidate(db, { repoRoot, session, head, now, log, runCommand: review?.deps.runCommand,
          escalate: (kind, message, remedy) => escalateReviewRepair(db, { actionKey: `${session.project_slug}/${session.action_id}`, kind, message, remedy, now, log }) });
        if (repairGate) return { satisfied: false, code: "awaiting_independent_verdicts", reason: repairGate, head, missing: [] };
        // A decided repair whose failed verdict no longer stands (a passing rerun,
        // a new head) is released before anything can launch it.
        releaseStalePendingRepair(db, { session, repoRoot, now, log });
        const waiting = independentVerdictGate(db, { session, repoRoot });
        const outcome = !waiting.satisfied && waiting.code === "awaiting_independent_verdicts" && review
          ? advanceIndependentReview(db, { workspace, repoRoot, session, now, log, heartbeat: review.heartbeat,
            deps: { ...(review.clock ? { clock: review.clock } : {}), ...review.deps } })
          : undefined;
        reviewOutcome = outcome;
        return escalatingVerdictGate(db, { session, repoRoot, now, log, review: outcome });
      } }, integrateDeps)
  };
  return { handoff, sessionId: session.id, head, refusal: null, session, review: reviewOutcome };
}

/**
 * The integration deps, with the worker pull-request merge (Decision 0097)
 * reading GitHub through the same `gh` runner the tick's review step uses.
 */
function integrateDepsWithGitHub(options: Pick<ManagedProductionTickOptions, "handoff" | "review">): IntegrateSessionDeps {
  const integrate = options.handoff?.integrate ?? {};
  const runCommand = integrate.workerMerge?.runCommand ?? options.review?.runCommand;
  return runCommand ? { ...integrate, workerMerge: { ...integrate.workerMerge, runCommand } } : integrate;
}

/** Prefix of the refusal for a recorded integration Grant that has expired; `terminalCandidateRemedy` keys on it. */
const LAPSED_INTEGRATION_GRANT = "The integration grant expired at";

/**
 * The refusal when Active production in scope for this Session's Action
 * records an integration Grant naming it that has expired at `now`, or null.
 * Inactive production, an out-of-scope Action or no Grant at all stay with
 * the integration step's own refusal, as before.
 */
function lapsedIntegrationGrant(db: Database.Database, session: AgentSession, now: Date): string | null {
  const read = readProductionPolicySafely(db);
  const scope = read.status === "ok" && read.policy.desiredState === "active" ? read.policy.scope : null;
  const grant = scope?.integrationGrant;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  if (!scope || !grant || !scope.actions.includes(actionKey) || !(grant.actions.length ? grant.actions : scope.actions).includes(actionKey)) return null;
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isNaN(expiresAt) && expiresAt > now.getTime()) return null;
  return `${LAPSED_INTEGRATION_GRANT} ${grant.expiresAt} (Decision ${grant.decisionRef}); the preserved candidate is not readied, reviewed or integrated unattended.`;
}

/** The pull request URL a preservation receipt row names, or null. */
function pullRequestUrlOf(row: { receipt_json: string } | undefined): string | null {
  try { return row ? (JSON.parse(row.receipt_json) as { pullRequestUrl?: string | null }).pullRequestUrl ?? null : null; } catch { return null; }
}

/** A terminal-recovery refusal raised by one of `recoverTerminalHandoff`'s own guards, with the read-only facts behind it. */
interface TerminalRefusalFacts {
  session: AgentSession;
  reason: string;
  head: string | null;
  /** The candidate's own recorded completion settlement commit, when one exists. */
  settlementCommit: string | null;
  operatorMergeCommand: string;
}

interface TerminalHandoffRecovery {
  handoff: SessionHandoffResult;
  sessionId: string;
  head: string | null;
  /** Set only when a terminal guard refused; null once every guard passed (integration may still refuse). */
  refusal: TerminalRefusalFacts | null;
  /** The candidate whose guards all passed, and the review step's outcome this tick, when one ran. */
  session?: AgentSession;
  review?: ReviewStepOutcome;
}

/**
 * The escalation kind for a terminal candidate that one of the terminal
 * recovery guards refuses on every tick (Issue #981). The guard re-runs each
 * tick and integrates the moment its cause clears; this only makes the
 * refusal visible in `arcadia production status` instead of the log alone.
 */
const TERMINAL_CANDIDATE_ESCALATION = "terminal_candidate_not_integrable";

/** The verdict-wait kinds a terminal-guard escalation may replace: waits, not review findings. */
const PLAIN_VERDICT_WAITS = new Set(["awaiting_independent_verdicts", "verdict_readiness_failed"]);

const VERDICT_WAIT_ESCALATIONS = new Set(["awaiting_independent_verdicts", "verdict_readiness_failed", ...REVIEW_BLOCK_CODES]);

/**
 * The integration gate, plus a deduped operator escalation while it refuses,
 * so `production status` (not only the worker log) shows a candidate that is
 * accepted but cannot land. When the tick drives the candidate's review
 * itself (a host-created PR under a grant that authorizes readying it), the
 * `awaiting_independent_verdicts` remedy says so and names what it waits on;
 * a review step that cannot proceed records its own escalation kind with the
 * exact remedy. Otherwise the remedy names the host command for each missing
 * verdict (`arcadia qa code-review`, `arcadia qa pr`). Either way the exact
 * operator merge stays the manual fallback, and the escalation clears the
 * moment the gate is satisfied and the tick integrates with no operator merge.
 */
function escalatingVerdictGate(
  db: Database.Database,
  input: { session: AgentSession; repoRoot: string; now: Date; log?: (message: string) => void; review?: ReviewStepOutcome }
): VerdictGate {
  const { session, repoRoot } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const gate = independentVerdictGate(db, { session, repoRoot });
  const previous = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as { kind: string } | undefined;
  // The verdict gate runs only after every terminal guard passed, so a
  // terminal-guard escalation still on this row is stale: it is replaced or
  // cleared here exactly like a verdict wait, never kept beside it.
  const supersedable = (kind: string): boolean => VERDICT_WAIT_ESCALATIONS.has(kind) || kind === TERMINAL_CANDIDATE_ESCALATION;
  if (gate.satisfied) {
    // A review repair stop names a failed verdict; current passing verdicts on
    // this exact head (a re-review after a JUDGEMENT_REVISION bump, an
    // operator's rerun) mean it no longer stands, so it is cleared too.
    if (previous && (supersedable(previous.kind) || REVIEW_REPAIR_ESCALATIONS.has(previous.kind))) clearOperatorEscalation(db, actionKey);
    return gate;
  }
  let pullRequestUrl: string | null = null;
  try {
    const row = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?")
      .get(`worker-tick-preserve-${session.id}`) as { receipt_json: string } | undefined;
    pullRequestUrl = row ? (JSON.parse(row.receipt_json) as { pullRequestUrl?: string | null }).pullRequestUrl ?? null : null;
  } catch { /* named generically below */ }
  let baseBranch = "the governed base branch";
  try { baseBranch = resolveBaseBranch(repoRoot); } catch { /* keep the generic name */ }
  const merge = gate.head
    ? candidateLandingCommand({ repoRoot, branch: gate.head, baseBranch, head: gate.head, pullRequestUrl })
    : operatorMergeCommand({ repoRoot, branch: session.branch, baseBranch });
  const fallback = `Manual fallback: after an independent review of exactly that head, an operator may land it with \`${merge}\`.`;
  const url = pullRequestUrl ?? "<the candidate's PR URL>";
  const commands = gate.code === "awaiting_independent_verdicts"
    ? gate.missing.map((entry) => entry.startsWith("code-review:")
      ? `code review with \`arcadia qa code-review ${url}\``
      : `QA with \`arcadia qa pr ${url}\``)
    : [];
  const blocked = input.review?.kind === "blocked" ? input.review : null;
  const applicability = gate.code === "awaiting_independent_verdicts" && !blocked ? reviewApplicability(db, session, input.now) : null;
  let kind: string = gate.code;
  let message = gate.reason;
  let remedy: string;
  if (blocked) {
    kind = blocked.code;
    message = `${gate.reason} ${blocked.reason}`;
    // Red checks the repair loop judged not to be the candidate's own: say why
    // the worker does not repair them (the escalation stays the worker's own).
    const notRepaired = blocked.code === "required_checks_failed" && blocked.checkFailure
      ? getReviewRepair(db, requiredChecksRepairRequestId(session.id, blocked.checkFailure.head)) : null;
    if (notRepaired?.outcome === "released" && notRepaired.reason) message = `${message} Not repaired unattended: ${notRepaired.reason}`;
    remedy = `${blocked.remedy} ${fallback}`;
  } else if (applicability?.applicable) {
    const progress = input.review && input.review.kind !== "not_applicable" ? ` Now: ${input.review.reason}` : "";
    remedy = `No operator step is needed: the worker tick readies ${url}, waits for its required checks on head ${gate.head}, then runs `
      + `the independent code review and QA itself, and integrates once both pass.${progress} `
      + `To record a verdict by hand instead: ${commands.join(" and ")}. ${fallback}`;
  } else if (gate.code === "awaiting_independent_verdicts") {
    const why = applicability && !applicability.applicable ? ` The tick does not request them itself: ${applicability.reason}` : "";
    remedy = `Record ${commands.join(" and ")} once that PR is ready for review (not a draft, checks green) and its head is ${gate.head}, `
      + `with managed production On; a failed verdict needs a fix or \`--rerun\`. The next tick then integrates it with no operator merge.${why} `
      + fallback;
  } else {
    remedy = `The candidate is not deterministically ready for verdicts (for example a Session launched before attempt lineage existed, or a head that moved after acceptance). `
      + `After independent review, an operator may land it with \`${merge}\`.`;
  }
  // The review repair loop stopped for the operator on this failed head: that
  // entry already names the verdict and its findings, so it stands, quietly.
  if (previous && REVIEW_REPAIR_ESCALATIONS.has(previous.kind)) return gate;
  if (previous && !supersedable(previous.kind)) {
    // One row per Action: never overwrite a different, still-open escalation.
    input.log?.(`${actionKey} also waits on independent verdicts (${message}); keeping its open ${previous.kind} escalation.`);
    return gate;
  }
  const newlyDetected = recordOperatorEscalation(db, { actionKey, kind, message, remedy, now: input.now });
  if (newlyDetected || previous?.kind !== kind) input.log?.(`Escalated ${actionKey} to the operator (${kind}): ${message}`);
  return gate;
}

export interface ManagedProductionTickResult {
  policyActive: boolean;
  /** The scheduling pass that ran before admission, when the policy was Active. */
  scheduling: SchedulingPassResult | null;
  schedulingError: string | null;
  projects: ManagedProductionTickProjectResult[];
}

export function ensureProductionTickTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_repair_attempts (
      action_key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_attempt_tokens (
      action_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      outcome TEXT,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (action_key, session_id)
    );
    CREATE TABLE IF NOT EXISTS production_base_branch_observations (
      project_slug TEXT PRIMARY KEY,
      project_id TEXT,
      repository_path TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      observed_sha TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_base_branch_observation_failures (
      project_slug TEXT PRIMARY KEY,
      repository_path TEXT NOT NULL,
      message TEXT NOT NULL,
      first_failed_at TEXT NOT NULL,
      last_attempted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_launch_refusal_log (
      action_key TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL,
      message TEXT NOT NULL,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_integration_refusal_log (
      project_slug TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL,
      first_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_dependency_unresolved_sightings (
      action_key TEXT PRIMARY KEY,
      unresolved_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);
  ensureProductionLaunchBlockersTable(db);
  ensureProductionLaunchRefusalDedupeKeyColumn(db);
  ensureProductionReviewStepTable(db);
  ensureRedAlertTables(db);
  ensureActionJourneyLogTable(db);
}

/**
 * A workspace whose `production_launch_refusal_log` table predates
 * `dedupe_key` (CodeRabbit, PR #646, fix round 2) keeps that table's exact
 * shape under `CREATE TABLE IF NOT EXISTS`, so the first launch refusal after
 * upgrade would fail at `SELECT dedupe_key` with no such column. Backfill
 * existing rows from their own `message` -- an exact-match dedupe identical to
 * this table's pre-migration behavior -- so recordLaunchRefusalIfNew's first
 * post-migration write for each Action logs once, as a fresh episode, exactly
 * as an upgrade should.
 */
function ensureProductionLaunchRefusalDedupeKeyColumn(db: Database.Database): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(production_launch_refusal_log)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!columns.has("dedupe_key")) {
    db.prepare("ALTER TABLE production_launch_refusal_log ADD COLUMN dedupe_key TEXT").run();
    db.prepare("UPDATE production_launch_refusal_log SET dedupe_key = message WHERE dedupe_key IS NULL").run();
  }
}

/**
 * Record (or refresh) an expected-wait-state launch refusal (capacity/Off/
 * stale-preview/lease/policy conflicts) and report whether it is a new
 * episode. Logging the identical refusal line on every ~2s producer tick was
 * Issue-shaped noise the same way base-branch observation failures were
 * (`recordBaseBranchObservationFailure`, above) -- the durable row, not a
 * fresh log line each tick, is the fact worth keeping.
 *
 * `dedupeKey` -- not the full `message` -- decides whether this is the same
 * episode continuing: an `admission_expired` refusal's message embeds a fresh
 * expiry timestamp on every tick (`Admission expired at <ISO>; ...`), so
 * comparing full messages logged that identical wait state on every tick
 * (CodeRabbit, PR #646). The caller supplies a stable identity -- typically
 * the conflict code plus normalized prerequisites -- while `message` remains
 * the full, current detail persisted and logged. Returns true whenever
 * `dedupeKey` changed (including the first time this actionKey is seen), so
 * the caller logs exactly once per distinct refusal episode.
 */
function recordLaunchRefusalIfNew(db: Database.Database, actionKey: string, dedupeKey: string, message: string, now: Date): boolean {
  const at = now.toISOString();
  const existing = db.prepare("SELECT dedupe_key FROM production_launch_refusal_log WHERE action_key = ?").get(actionKey) as
    | { dedupe_key: string }
    | undefined;
  const isNewEpisode = !existing || existing.dedupe_key !== dedupeKey;
  db.prepare(
    `INSERT INTO production_launch_refusal_log (action_key, dedupe_key, message, first_at, last_at)
       VALUES (@action_key, @dedupe_key, @message, @at, @at)
     ON CONFLICT(action_key) DO UPDATE SET
       dedupe_key = @dedupe_key,
       message = @message,
       first_at = CASE WHEN production_launch_refusal_log.dedupe_key = @dedupe_key
                    THEN production_launch_refusal_log.first_at ELSE @at END,
       last_at = @at`
  ).run({ action_key: actionKey, dedupe_key: dedupeKey, message, at });
  // Only a new episode is history: an `admission_expired` message changes every tick.
  if (isNewEpisode) appendJourneyLog(db, { actionKey, source: "launch_refusal", kind: dedupeKey || "refused", message, at });
  return isNewEpisode;
}

/**
 * Whether this Project's integration refusal is a new episode worth one log
 * line. `dedupeKey` is (Session, candidate head, reason): the same refusal of
 * the same head reads its own row and writes nothing, so a refusal that holds
 * for hours costs no log line and no database write per tick.
 */
function recordIntegrationRefusalLogIfNew(db: Database.Database, projectSlug: string, dedupeKey: string, now: Date): boolean {
  const existing = db.prepare("SELECT dedupe_key FROM production_integration_refusal_log WHERE project_slug = ?").get(projectSlug) as
    | { dedupe_key: string }
    | undefined;
  if (existing?.dedupe_key === dedupeKey) return false;
  db.prepare(
    `INSERT INTO production_integration_refusal_log (project_slug, dedupe_key, first_at) VALUES (@project_slug, @dedupe_key, @at)
     ON CONFLICT(project_slug) DO UPDATE SET dedupe_key = @dedupe_key, first_at = @at`
  ).run({ project_slug: projectSlug, dedupe_key: dedupeKey, at: now.toISOString() });
  return true;
}

/** End this Project's integration-refusal episode; reads first so an idle tick writes nothing. */
function clearIntegrationRefusalLog(db: Database.Database, projectSlug: string): void {
  if (db.prepare("SELECT 1 FROM production_integration_refusal_log WHERE project_slug = ?").get(projectSlug)) {
    db.prepare("DELETE FROM production_integration_refusal_log WHERE project_slug = ?").run(projectSlug);
  }
}

/** Clear a recorded launch refusal once this Action's launch stops being refused. */
function clearLaunchRefusal(db: Database.Database, actionKey: string): void {
  db.prepare("DELETE FROM production_launch_refusal_log WHERE action_key = ?").run(actionKey);
}

/**
 * How long a repeatedly failing base-branch observation goes unretried.
 *
 * `detectBaseBranchAdvance` shells out to `git` and, for a structurally broken
 * repository (a bad configured path, a corrupt checkout, no commits), throws
 * the same way every tick. Retrying and re-logging that on every ~2s producer
 * tick (Issue: the `living-songbook` project logged it roughly every ~70-85s,
 * one line per tick) spends a subprocess spawn and a log line on a fact that
 * is already known. Mirrors `DEFAULT_BOARD_POLL_INTERVAL_MS`'s reasoning
 * (scheduler.ts): Arcadia never needs to poll to learn about its own changes,
 * only to notice a drag a human might have fixed, which is worth checking for
 * periodically rather than never again.
 */
export const BASE_BRANCH_OBSERVATION_FAILURE_RETRY_MS = 10 * 60 * 1000;

/**
 * A `arcadia production status` read runs on a read-only connection and
 * cannot create a missing table itself, so this is also wired into
 * `applyMigrations` (unlike the two ad hoc tables above, which only their own
 * write paths touch) -- a fresh workspace has it before the worker ever ticks.
 */
export function ensureProductionLaunchBlockersTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_launch_blockers (
      project_slug TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      reason TEXT NOT NULL,
      action_key TEXT,
      observed_at TEXT NOT NULL
    );
  `);
}

/**
 * Packet-lifecycle kinds (see `resolvePacketLifecycle`) whose remedy needs an
 * operator or agent action, never the passage of time. `planning_approval_pending`
 * and `planning_in_progress` are excluded on purpose: both already carry an
 * open Decision, which is already operator-visible through Review. Only
 * `planning_required` has no other surface today -- nothing has asked for
 * planning yet, so silently retrying the same launch forever (Issue #576)
 * never gets anyone's attention.
 *
 * `build_packet_approval_pending` is included even though it too is an open
 * Decision, because it is the one that stops an Active standing policy
 * outright: the 2026-09-26 two-Action rehearsal sat Active with no admission
 * and an empty `production status` while its only blocker was an unapproved
 * packet, visible solely in the worker log. The escalation's remedy names the
 * exact approval command.
 */
const NON_SELF_RESOLVING_PACKET_LIFECYCLE_KINDS = new Set<string>(["planning_required", "build_packet_approval_pending"]);

/**
 * Escalations the launch path raises while preparing a packet for the pointer
 * Action. An Action-scoped policy withdraws only these for an out-of-scope
 * pointer (Issue #1512); every other kind needs the operator and is kept.
 */
const LAUNCH_PATH_PACKET_ESCALATION_KINDS = new Set<string>([
  "planning_required", "build_packet_approval_pending", "planning_run_approval_pending"
]);

/**
 * When a refusal's packet lifecycle is `planning_required`, prepare it
 * automatically through the exact same `arcadia work plan` machinery a human
 * or agent would otherwise have to notice and run by hand (Issue #584):
 * `runWorkPlanCommand` already decides deterministically, from the Action's
 * own declared steps, whether it needs a build packet (no Decision-gated
 * planning run) or a real planning run (`CodexPlanningRunApproval`) -- this
 * only supplies the trigger, never a second copy of that decision or of
 * `packets.ts`'s prompt template. `planStepsForWorkItem` is called first,
 * read-only, purely to predict which of those two branches `work plan` will
 * take -- the exact same deterministic function it uses internally -- so a
 * policy-permitted profile of the right purpose can be requested before the
 * immutable packet is created, never after.
 *
 * Returns the packet lifecycle kind a successful preparation produces --
 * `build_packet_ready` or `planning_approval_pending`, both already
 * self-resolving and excluded from `NON_SELF_RESOLVING_PACKET_LIFECYCLE_KINDS`
 * -- so the caller can run the resolved kind through the exact same
 * escalate/clear branch as any other refusal, rather than a special case.
 * Returns null when nothing could be prepared (a stale pointer, an Action
 * shape `work plan` does not know how to route, or any other failure), so the
 * caller escalates exactly as it did before this existed.
 */
function attemptAutomaticPlanningResolution(
  db: Database.Database,
  input: { workspace: string; profiles: CodingAgentProfile[] },
  transition: ProjectTransition,
  actionKey: string,
  log: (message: string) => void
): string | null {
  const context = transition.dispatch.context;
  if (!context) {
    return null;
  }
  const workItem = getWorkItemByDocRef(db, `plan/${context.activePlan}#${context.action.id}`);
  if (!workItem) {
    return null;
  }
  const steps = planStepsForWorkItem(workItem);
  const predictedPurpose = steps.length === 1 && steps[0]?.executorType === "codex_build"
    ? "build"
    : steps.length === 1 && steps[0]?.executorType === "codex_planning"
      ? "planning"
      : null;
  const requestedProfile = predictedPurpose
    ? selectPolicyPermittedProfileName(db, input.profiles, predictedPurpose, resolveWorkItemPolicyIdentity(db, workItem)) ?? undefined
    : undefined;
  // The planner is a separately identified, read-only helper attempt (it
  // writes packet records, never the candidate), reached only after the
  // deterministic launch preview reported `planning_required`. Being called
  // again under the same input is itself the deterministic observation that
  // an earlier passed planner's output no longer stands, so it is re-run as
  // the next bounded ordinal (`rerunPassed`). A run that prepares nothing, or
  // throws (busy database, Git/I/O failure), stays live and is resumed on the
  // next tick under the same ordinal, so transient failures consume nothing.
  const requirement = requirementIdentity({ projectSlug: context.projectSlug, planSlug: context.activePlan, action: context.action });
  const now = new Date();
  try {
    const planned = runHelperAttempt(db, { role: "planner", requirement, actorId: "host-planner:work-plan", retryAuthorized: true, rerunPassed: true, now }, () => {
      const prepared = runWorkPlanCommand({ workspace: input.workspace, workId: workItem.id, agentProfile: requestedProfile });
      const invocation = prepared.data.buildInvocation ?? prepared.data.codexInvocation;
      const kind = prepared.data.buildInvocation ? "build_packet_ready" : prepared.data.planningDecision ? "planning_approval_pending" : null;
      return { outcome: kind !== null ? "passed" as const : "inconclusive" as const, receipt: { kind, invocationId: invocation?.id ?? null, promptPath: invocation?.prompt_path ?? null } };
    });
    if (planned.finished && !planned.replayed && planned.receipt.invocationId && planned.receipt.promptPath) {
      // Advisory bookkeeping: a critique-recording failure never undoes the planner's packet.
      try {
        recordPacketCritique(db, requirement, planned.receipt.invocationId, path.resolve(input.workspace, planned.receipt.promptPath), now);
      } catch (error) {
        log(`Could not record the packet critique attempt for ${actionKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (planned.replayed) {
      log(`The planner attempt for ${actionKey} already finished for this exact Action input (${planned.attempt.status}); not re-running it.`);
      return null;
    }
    if (planned.receipt.kind === "build_packet_ready") {
      log(`Automatically prepared a build packet for ${actionKey} (was planning_required); it still needs its own build-packet approval.`);
      return "build_packet_ready";
    }
    if (planned.receipt.kind === "planning_approval_pending") {
      log(`Automatically requested a Decision-gated planning run for ${actionKey} (was planning_required); its approval gate is unchanged.`);
      return "planning_approval_pending";
    }
    return null;
  } catch (error) {
    if (error instanceof ArcadiaError && error.details?.code === "attempt_limit_exhausted") {
      log(`Planner attempts for ${actionKey} are exhausted for this exact Action input.`);
      return PLANNER_ATTEMPTS_EXHAUSTED;
    }
    log(`Automatic planning_required resolution failed for ${actionKey}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Returned by planning resolution when every bounded planner ordinal for this input passed and planning is still required. */
const PLANNER_ATTEMPTS_EXHAUSTED = "planner_attempts_exhausted";
const PLANNER_ATTEMPTS_EXHAUSTED_REMEDY = "Every bounded planner attempt for this exact Action input prepared a packet, yet the launch preview "
  + "still reports planning_required. Inspect why the prepared packet is not accepted (`arcadia session preview-launch`). No command resets "
  + "attempt lineage today: the only path is a governed amendment of the Action (an Agent Ask), which gives it a new input revision.";

/**
 * The packet's deterministic stewardship critique, recorded as its own
 * read-only critique attempt. It reads the critique the packet writer already
 * produced (no second critic run), so it is advisory exactly as before.
 */
function recordPacketCritique(db: Database.Database, requirement: ReturnType<typeof requirementIdentity>, invocationId: string, promptPath: string, now: Date): void {
  runHelperAttempt(db, { role: "critique", requirement, actorId: "host-critic:deterministic_critic", retryAuthorized: true, rerunPassed: true, now }, () => {
    type PacketCritique = { critic?: string; status?: string; findings?: unknown[] };
    let critique: PacketCritique | null;
    try {
      critique = (JSON.parse(readFileSync(path.join(path.dirname(promptPath), "metadata.json"), "utf8")) as { critique?: PacketCritique }).critique ?? null;
    } catch {
      critique = null;
    }
    return {
      // An unreadable critique is an I/O gap, not a verdict: it stays live.
      outcome: critique === null ? "inconclusive" as const : critique.status === "approved" ? "passed" as const : "failed" as const,
      receipt: { invocationId, critic: critique?.critic ?? null, status: critique?.status ?? "unreadable", findings: critique?.findings?.length ?? null }
    };
  });
}

/**
 * Approve a pending build packet on the operator's behalf, only when the
 * Active standing policy explicitly names the `packet_approval` transition
 * (Decision 0072) for this exact Action, and only when that approval is the
 * sole thing standing between the Action and launch. Returns the approved
 * Decision id, or null (leaving the ordinary operator escalation in place).
 */
function attemptDelegatedPacketApproval(
  db: Database.Database,
  input: {
    actionKey: string;
    projectSlug: string;
    planSlug: string | null;
    decisionId: string | null;
    prerequisites: string[] | null;
    now: Date;
    log: (message: string) => void;
  }
): string | null {
  const decisionId = input.decisionId;
  if (!decisionId || !input.planSlug) return null;
  if (!input.prerequisites || input.prerequisites.length !== 1 || !input.prerequisites[0].startsWith("build packet approval pending")) {
    return null;
  }
  const planKey = `${input.projectSlug}/${input.planSlug}`;
  // The policy check, the approval and its audit event are one write
  // transaction: an Off committed in between must not be followed by an
  // approval it already revoked, and the approval must never exist without
  // the event that records under which grant it happened.
  const approved = writeTransaction(db, () => {
    const read = readProductionPolicySafely(db);
    if (read.status !== "ok" || read.policy.desiredState !== "active" || !read.policy.scope) return null;
    const { policy } = read;
    const scope = policy.scope!;
    if (
      !scope.mechanicalTransitions.includes("packet_approval") ||
      !scope.packetApprovalExpiresAt ||
      input.now.getTime() >= Date.parse(scope.packetApprovalExpiresAt) ||
      !scope.projects.includes(input.projectSlug) ||
      !scope.plans.includes(planKey) ||
      !scope.actions.includes(input.actionKey)
    ) {
      return null;
    }
    const item = getReviewItem(db, decisionId);
    if (!item || item.resolved_intent !== "CodexBuildPacketApproval" || (item.status !== "open" && item.status !== "deferred")) return null;
    updateReviewItemStatus(db, item.id, {
      status: "approved",
      decisionNote: `Approved by the standing production policy (revision ${policy.revision}, epoch ${policy.epoch}) under its packet_approval delegation (Decision 0072).`
    });
    const project = getProjectBySlug(db, input.projectSlug);
    recordEvent(db, {
      eventType: "managed_production.packet_approved",
      projectId: project?.id ?? null,
      payload: { actionKey: input.actionKey, planKey, decisionId: item.id, policyRevision: policy.revision, epoch: policy.epoch },
      at: input.now.toISOString()
    });
    return { id: item.id, revision: policy.revision };
  });
  if (!approved) return null;
  input.log(`Approved build packet Decision ${approved.id} for ${input.actionKey} under the standing policy's packet_approval delegation (revision ${approved.revision}).`);
  return approved.id;
}

/**
 * When the Active policy delegates packet approval (Decision 0072) and that
 * delegation has expired, the sentence that leads a pending packet's remedy:
 * the cause is the lapsed Grant, not a forgotten approval, and approving by
 * hand after the integration Grant lapsed too admits work that cannot
 * integrate unattended. Null otherwise.
 */
function lapsedPacketApprovalNote(db: Database.Database, now: Date): string | null {
  const read = readProductionPolicySafely(db);
  const scope = read.status === "ok" && read.policy.desiredState === "active" ? read.policy.scope : null;
  const expiresAt = scope?.packetApprovalExpiresAt;
  if (!scope || !expiresAt || !scope.mechanicalTransitions.includes("packet_approval") || now.getTime() < Date.parse(expiresAt)) return null;
  const grant = scope.integrationGrant;
  const grantLapsed = grant && !(Date.parse(grant.expiresAt) > now.getTime());
  return `Blocked: the standing policy's packet_approval delegation expired at ${expiresAt}, so the tick no longer approves build packets.`
    + (grantLapsed ? ` The integration grant (Decision ${grant.decisionRef}) expired at ${grant.expiresAt} too, so an Action admitted now is built and preserved but not integrated unattended.` : "")
    + " Record a fresh activation to continue, or approve this one packet by hand.";
}

/**
 * Record (or refresh) a launch refusal that will not resolve on its own.
 * Returns true only the first time this action key is recorded, so the
 * caller can surface a signal once per continuous episode instead of on
 * every tick -- the row itself, not a fresh notification each tick, is the
 * durable, operator-visible fact.
 */
function recordOperatorEscalation(
  db: Database.Database,
  input: { actionKey: string; kind: string; message: string; remedy: string | null; now: Date }
): boolean {
  const at = input.now.toISOString();
  const existing = db.prepare("SELECT action_key FROM production_operator_escalations WHERE action_key = ?").get(input.actionKey) as
    | { action_key: string }
    | undefined;
  db.prepare(
    `INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at)
       VALUES (@action_key, @kind, @message, @remedy, @at, @at)
     ON CONFLICT(action_key) DO UPDATE SET
       kind = @kind, message = @message, remedy = @remedy, last_seen_at = @at`
  ).run({ action_key: input.actionKey, kind: input.kind, message: input.message, remedy: input.remedy, at });
  appendJourneyLog(db, { actionKey: input.actionKey, source: "escalation", kind: input.kind, message: input.message, remedy: input.remedy, at });
  return !existing;
}

export const SCOPE_POINTER_HELD_ESCALATION = "scope_pointer_held";

/**
 * Issue #1512: the pointer names an out-of-scope Action whose terminal
 * candidate recovery still owns (`pendingTerminalCandidateFor`), so the
 * scheduler holds the pointer and no in-scope Action can run until it lands.
 * Returns the named reason and remedy when held, and records one deduped
 * operator escalation (logged once) so `production status` shows it; an
 * existing escalation of another kind on that Action (a terminal-guard
 * refusal, a repair budget) is never overwritten. When not held, a stale
 * hold escalation for the Action is cleared and null is returned.
 */
function scopePointerHold(
  db: Database.Database,
  input: { repoRoot: string; projectSlug: string; actionKey: string; actionId: string; now: Date; log: (message: string) => void }
): string | null {
  const check = pendingTerminalCandidateFor(db, input.repoRoot, input.projectSlug, input.actionId);
  if (check.kind === "none") {
    db.prepare("DELETE FROM production_operator_escalations WHERE action_key = ? AND kind = ?").run(input.actionKey, SCOPE_POINTER_HELD_ESCALATION);
    return null;
  }
  let message: string;
  let remedy: string;
  if (check.kind === "pending") {
    const candidate = check.session;
    let merge = `merge ${candidate.branch} into the base branch`;
    try {
      merge = operatorMergeCommand({ repoRoot: input.repoRoot, branch: candidate.branch, baseBranch: resolveBaseBranch(input.repoRoot) });
    } catch { /* the plain wording stands */ }
    message = `Production is held: the pointer names ${input.actionKey}, which is outside the Active production scope, and its terminal candidate `
      + `${candidate.branch} (Session ${candidate.id}) has not landed, so the scheduler will not move the pointer to an in-scope Action.`;
    remedy = `Land the candidate (operator merge: ${merge}), or turn production Off and grant a scope that includes ${input.actionKey} so terminal recovery can integrate it; the pointer then moves to the first in-scope Action.`;
  } else {
    // Fail closed: the scheduler holds the pointer on an unknown answer too.
    message = `Production is held: the pointer names ${input.actionKey}, which is outside the Active production scope, and whether it still has a `
      + `terminal candidate could not be determined (${check.reason}), so the scheduler will not move the pointer to an in-scope Action.`;
    remedy = `Repair the repository at ${input.repoRoot} so its base branch and candidate branches resolve (origin/HEAD, or a local main/master branch); the hold is re-checked every tick.`;
  }
  const existing = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(input.actionKey) as { kind: string } | undefined;
  if (!existing || existing.kind === SCOPE_POINTER_HELD_ESCALATION) {
    if (recordOperatorEscalation(db, { actionKey: input.actionKey, kind: SCOPE_POINTER_HELD_ESCALATION, message, remedy, now: input.now })) {
      input.log(`Escalated ${input.actionKey} to the operator (${SCOPE_POINTER_HELD_ESCALATION}): ${remedy}`);
    }
  }
  return `${message} Remedy: ${remedy}`;
}

/**
 * `scopePointerHold` for the checked-in pointer, when an Action-scoped Active
 * policy excludes it; null otherwise. Used where the tick never reaches
 * `attemptProjectLaunch` because terminal recovery returned a refused handoff.
 */
function outOfScopePointerHold(
  db: Database.Database,
  input: { repoRoot: string; projectSlug: string; now: Date; log: (message: string) => void }
): string | null {
  try {
    const projectDoc = discoverDocs(input.repoRoot).docs.find((doc) => doc.type === "project" && doc.slug === input.projectSlug);
    if (projectDoc?.type !== "project" || !projectDoc.currentAction || !projectDoc.activePlan) return null;
    const actionKey = `${input.projectSlug}/${projectDoc.currentAction}`;
    const inScope = activeActionScopeGate(db, input.projectSlug, projectDoc.activePlan);
    if (!inScope || inScope(actionKey)) return null;
    return scopePointerHold(db, { ...input, actionKey, actionId: projectDoc.currentAction });
  } catch (error) {
    input.log(`Scope pointer-hold check failed for ${input.projectSlug}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * The end of an Action-scoped run: every in-scope Action of this Project is
 * done and the pointer has moved out of scope, so the worker will never
 * launch again under this policy. One attention ping per policy revision (an
 * event row is the dedup record) tells the operator to turn production Off.
 */
function announceScopeComplete(
  db: Database.Database,
  input: { repoRoot: string; projectSlug: string; planSlug: string | null; now: Date; log: (message: string) => void }
): void {
  try {
    const read = readProductionPolicySafely(db);
    if (read.status !== "ok" || read.policy.desiredState !== "active" || !read.policy.scope || input.planSlug === null) return;
    const scopeKeys = read.policy.scope.actions.filter((key) => key.startsWith(`${input.projectSlug}/`));
    if (scopeKeys.length === 0) return;
    const plan = discoverDocs(input.repoRoot).docs.find((doc) => doc.type === "plan" && doc.project === input.projectSlug && doc.slug === input.planSlug);
    if (plan?.type !== "plan") return;
    const done = new Set(plan.actions.filter((action) => action.status === "done").map((action) => `${input.projectSlug}/${action.id}`));
    if (!scopeKeys.every((key) => done.has(key))) return;
    const revision = read.policy.revision;
    const already = db.prepare(
      "SELECT 1 FROM events WHERE event_type = 'managed_production.scope_complete' AND json_extract(payload_json, '$.projectSlug') = ? AND json_extract(payload_json, '$.policyRevision') = ? LIMIT 1"
    ).get(input.projectSlug, revision);
    if (already) return;
    const escalated = (db.prepare("SELECT action_key FROM production_operator_escalations").all() as Array<{ action_key: string }>)
      .filter((row) => scopeKeys.includes(row.action_key)).length;
    const message = boundedPingMessage(
      `Production scope complete for ${input.projectSlug}: ${scopeKeys.length} merged, ${escalated} escalated. Nothing left in scope; turn production Off when ready.`
    );
    recordEvent(db, {
      eventType: "managed_production.scope_complete",
      projectId: null,
      payload: { projectSlug: input.projectSlug, policyRevision: revision, merged: scopeKeys.length, escalated },
      at: input.now.toISOString()
    });
    input.log(message);
    queueOperatorPing(db, { message, kind: "attention", agent: "production-tick", now: input.now });
  } catch (error) {
    input.log(`Scope-complete check failed for ${input.projectSlug}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Clear a previously recorded escalation once its Action launches or its refusal stops being non-self-resolving. */
function clearOperatorEscalation(db: Database.Database, actionKey: string): void {
  db.prepare("DELETE FROM production_operator_escalations WHERE action_key = ?").run(actionKey);
}

/** Clear this Action's terminal-candidate escalation, if that is the kind on its row; reads first so an idle tick writes nothing. */
function clearTerminalCandidateEscalation(db: Database.Database, actionKey: string): void {
  const row = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as { kind: string } | undefined;
  if (row?.kind === TERMINAL_CANDIDATE_ESCALATION) clearOperatorEscalation(db, actionKey);
}

/** Clear every escalation of `kind` in this Project except `keepActionKey`'s; reads first so an idle tick writes nothing. */
function clearProjectEscalationsOfKind(db: Database.Database, kind: string, projectSlug: string, keepActionKey: string | null): void {
  const rows = db.prepare("SELECT action_key FROM production_operator_escalations WHERE kind = ? AND action_key LIKE ? AND action_key != ?")
    .all(kind, `${projectSlug}/%`, keepActionKey ?? "") as Array<{ action_key: string }>;
  for (const row of rows) clearOperatorEscalation(db, row.action_key);
}

/** Clear every terminal-candidate escalation in this Project except `keepActionKey`'s. */
function clearProjectTerminalCandidateEscalations(db: Database.Database, projectSlug: string, keepActionKey: string | null): void {
  clearProjectEscalationsOfKind(db, TERMINAL_CANDIDATE_ESCALATION, projectSlug, keepActionKey);
}

/** Whether the Active policy's scope names exactly this Project, Plan and Action. */
function actionInActiveScope(db: Database.Database, projectSlug: string, planSlug: string, actionId: string): boolean {
  const read = readProductionPolicySafely(db);
  const scope = read.status === "ok" && read.policy.desiredState === "active" ? read.policy.scope : null;
  return !!scope && scope.projects.includes(projectSlug) && scope.plans.includes(`${projectSlug}/${planSlug}`)
    && scope.actions.includes(`${projectSlug}/${actionId}`);
}

/**
 * Issue #995: an agent that died after `agent-ask settle --apply` committed
 * its completion in the candidate, and before the settlement was recorded,
 * leaves its `complete` proposal pending, and that pending proposal gates the
 * Action on every later tick. Record that settlement deterministically (no
 * coding agent, no model call) through `recordCommittedCompletionSettlement`,
 * which derives the settlement again at the proposal's Candidate revision and
 * accepts only a candidate HEAD whose files are exactly that settlement, for a
 * proposal whose evidence verbatim-covers the Action's criteria as the base
 * checkout declares them, every entry met. Only for an Action the Active
 * policy's scope names exactly. Anything else leaves the proposal pending,
 * and the operator gate (below) shows it. Never throws.
 */
function recordInterruptedCompletionSettlement(
  db: Database.Database,
  input: { session: AgentSession; repoRoot: string; log: (message: string) => void }
): void {
  const { session } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  try {
    if (!actionInActiveScope(db, session.project_slug, session.plan_slug, session.action_id)) return;
    const targets = new Set([`action/${session.action_id}`, `plan/${session.plan_slug}#${session.action_id}`]);
    const pending = listUnsettledAgentAskProposals(db).filter(({ proposal }) => proposal.normalized.intent === "complete"
      && proposal.normalized.project === session.project_slug && targets.has(proposal.normalized.targetRef ?? ""));
    if (pending.length === 0) return;
    const plan = discoverDocs(input.repoRoot).docs.find((doc) => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug);
    const action = plan?.type === "plan" ? plan.actions.find((entry) => entry.id === session.action_id) : undefined;
    if (!action || action.status === "done") return;
    for (const row of pending) {
      try {
        const receipt = recordCommittedCompletionSettlement(db, {
          proposalRef: row.id,
          settlementRequestId: `worker-tick-record-${row.id}`.slice(0, 120),
          cwd: session.worktree_path,
          acceptanceCriteria: action.acceptanceCriteria
        });
        input.log(`Recorded the interrupted completion settlement of Agent Ask ${row.requestId} for ${actionKey} (${receipt.id}) `
          + `from its candidate's settlement commit ${receipt.documentsCommit}; no Session launched.`);
        return;
      } catch (error) {
        input.log(`Did not record pending completion Agent Ask ${row.requestId} for ${actionKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    input.log(`Interrupted-completion check for ${actionKey} did not complete: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Issue #1613: a drafted completion held for the operator (validation unavailable on this host, or the same
 * refusal repeated) is escalated by name, and the Action is not relaunched meanwhile. Shared by the tick and
 * `arcadia session reconcile`, so every reconciliation path holds. True when the receipt carries a hold.
 */
export function recordCompletionHoldEscalation(
  db: Database.Database,
  input: { session: AgentSession; receipt: { evidence_json: string | null }; now: Date; log?: (message: string) => void }
): boolean {
  const hold = (JSON.parse(input.receipt.evidence_json ?? "{}") as { completionHold?: { kind: string; message: string; remedy: string } }).completionHold;
  if (!hold) return false;
  ensureProductionTickTables(db);
  const actionKey = `${input.session.project_slug}/${input.session.action_id}`;
  recordOperatorEscalation(db, { actionKey, kind: hold.kind, message: hold.message, remedy: hold.remedy, now: input.now });
  input.log?.(`Escalated ${actionKey} to the operator (${hold.kind}): ${hold.message}`);
  return true;
}

/** A completion the Session settled itself that fails the host's scope or validation checks (Issue #1615). */
export const SELF_SETTLED_COMPLETION_REFUSED_ESCALATION = "self_settled_completion_refused";

/** A drafted completion settled without its commit on the candidate (Issue #1518). */
export const COMPLETION_SETTLEMENT_NOT_IN_CANDIDATE_ESCALATION = "completion_settlement_not_in_candidate";

/**
 * Issue #1518: a Session that cannot commit leaves its work and its drafted
 * `complete` Ask uncommitted; exit preservation commits that tree and pushes
 * it (opening the draft PR), and only then does reconciliation settle the
 * draft, committing the settlement on the candidate branch. Push that settled
 * head (a governance-only fast-forward of the branch preservation already
 * pushed) in the same tick, so the pushed candidate and its PR carry the
 * Plan, pointer and Log change before anything else reads them. An operator
 * Launch's own publish step pushes the branch tip after reconciliation, so it
 * needs nothing here.
 *
 * A reconciliation that settled the draft but whose candidate does not carry
 * the settlement commit is never `accepted_completion`; it is escalated here
 * as {@link COMPLETION_SETTLEMENT_NOT_IN_CANDIDATE_ESCALATION}. Never throws.
 */
function publishSettledCandidateHead(
  db: Database.Database,
  input: {
    session: AgentSession; repoRoot: string; workspace: string; preservation: PreservationStep; operatorLaunch: boolean;
    receipt: { outcome: string; reason: string; evidence_json: string | null };
    remote: Pick<CandidatePreservationRemote, "push" | "upsertDraftPullRequest">; now: Date; log: (message: string) => void;
  }
): void {
  const { session, preservation, receipt, log } = input;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  try {
    const notInCandidate = (JSON.parse(receipt.evidence_json ?? "{}") as { completionSettlementNotInCandidate?: { settlementId: string; reason: string; cause?: string } })
      .completionSettlementNotInCandidate;
    if (notInCandidate) {
      const selfSettled = notInCandidate.cause === "self_settled_refused";
      recordOperatorEscalation(db, {
        actionKey,
        kind: selfSettled ? SELF_SETTLED_COMPLETION_REFUSED_ESCALATION : COMPLETION_SETTLEMENT_NOT_IN_CANDIDATE_ESCALATION,
        message: notInCandidate.reason,
        remedy: selfSettled
          ? `Inspect ${session.worktree_path} on ${session.branch}: the Session settled its own completion (settlement ${notInCandidate.settlementId}) and the candidate carries it, but the host's scope or validation check fails. `
            + "The candidate is not resumed or integrated automatically. Either review the named failure and land the pull request yourself if the change is acceptable, or discard the candidate and redo the Action."
          : `Inspect ${session.worktree_path} on ${session.branch}: settlement ${notInCandidate.settlementId} is recorded, but the candidate does not carry its commit. `
          + "Commit the settled Plan, PROJECT.md, MISSION_LOG.md and archived Ask there (or redo the completion), push the branch to its pull request, and land it through that pull request; "
          + "do not merge a pull request whose diff lacks the Plan status change.",
        now: input.now
      });
      log(`Escalated ${actionKey} to the operator (${selfSettled ? SELF_SETTLED_COMPLETION_REFUSED_ESCALATION : COMPLETION_SETTLEMENT_NOT_IN_CANDIDATE_ESCALATION}): ${notInCandidate.reason}`);
      return;
    }
    if (recordCompletionHoldEscalation(db, { session, receipt, now: input.now, log })) return;
    if (receipt.outcome !== "accepted_completion" || input.operatorLaunch || preservation.kind !== "preserved"
      || preservation.state === "LOCAL ONLY") return;
    const head = tryGit(session.worktree_path, ["rev-parse", "HEAD"])?.trim() ?? null;
    if (!head) return;
    const needsPush = head !== preservation.commitSha;
    // A self-settled candidate was already pushed before reconciliation retained
    // its execution evidence. Refresh that evidence without another source push.
    const hasCompletionEvidence = Boolean(JSON.parse(receipt.evidence_json ?? "{}").completionValidation);
    if (!needsPush && !hasCompletionEvidence) return;
    if (tryGit(input.repoRoot, ["rev-parse", `refs/heads/${session.branch}`])?.trim() !== head
      || !isAncestor(session.worktree_path, preservation.commitSha, head)) {
      log(`Did not push the settled head of ${session.branch} for ${actionKey}: the branch is not a fast-forward of preserved commit ${preservation.commitSha.slice(0, 12)} at ${head.slice(0, 12)}.`);
      return;
    }
    const policyRead = readProductionPolicySafely(db);
    if (policyRead.status !== "ok" || !policyAuthorizesRemotePreservation(policyRead.policy, actionKey)) {
      log(`Did not push the settled head ${head.slice(0, 12)} of ${session.branch} for ${actionKey}: the Active policy no longer authorizes remote preservation.`);
      return;
    }
    const changed = (tryGit(session.worktree_path, ["diff", "--name-only", preservation.commitSha, head]) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!findCandidateSettledCompletion(db, session, head) || (needsPush && changed.length === 0)) return;
    if (needsPush) input.remote.push({ repositoryPath: input.repoRoot, branch: session.branch, commitSha: head });
    // The PR body's Operator QA plan was rendered at the preserved commit; re-render it at this head.
    if (preservation.qaPlan) {
      try {
        if (refreshPreservedPullRequestBody(db, { requestId: `worker-tick-preserve-${session.id}`, plan: preservation.qaPlan, headSha: head, workspace: input.workspace, sessionId: session.id }, input.remote)) {
          log(`Re-rendered the pull-request Operator QA plan of ${session.branch} at the settled head ${head.slice(0, 12)}.`);
        }
      } catch (error) {
        log(`Re-rendering the pull-request Operator QA plan of ${session.branch} failed (the pushed head stands): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (needsPush) log(`Pushed the settled head ${head.slice(0, 12)} of ${session.branch} for ${actionKey} (its completion settlement, on top of preserved commit ${preservation.commitSha.slice(0, 12)}).`);
  } catch (error) {
    log(`Pushing the settled head of ${session.branch} for ${actionKey} failed (the review step retries it before any verdict): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * A launch wait that is the operator's, not time's: an in-scope Action whose
 * preparation sits on a planning review item (run approval, artifact
 * validation or artifact acceptance). These were once excluded as
 * "self-resolving" because the item is visible in Review, which hid the first
 * 2026-10-11 stall (A3, #1284). After {@link STALLED_GATE_MIN_DWELL_MS} of the
 * same refusal the tick records ONE `production_operator_escalations` row
 * naming the gate class, the Action and the one button that resolves it on
 * /todo (`review_item:<project>/<id>`, also /review and /actions), and queues
 * exactly one Discord ping. It decides, approves and executes nothing.
 */
export const STALLED_GATE_MIN_DWELL_MS = 60 * 1000;

export const STALLED_PLANNING_GATES: Record<string, { kind: string; gate: string; button: string; consequence: string }> = {
  CodexPlanningRunApproval: {
    kind: "planning_run_approval_pending",
    gate: "planning-run approval",
    button: "Approve planning run",
    consequence: "queues the planning run for the production worker; planning only, no build starts"
  },
  CodexPlanningRetryApproval: {
    kind: "planning_run_approval_pending",
    gate: "planning-retry approval",
    button: "Approve planning retry",
    consequence: "queues a new planning attempt from the unchanged packet; planning only, no build starts"
  },
  codex_planning_artifact_validation: {
    kind: "planning_artifact_validation_pending",
    gate: "planning-artifact validation",
    button: "Retry planning",
    consequence: "creates a planning-retry approval for the same packet; nothing runs until that retry is approved"
  },
  CodexPlanningArtifactAcceptance: {
    kind: "planning_artifact_acceptance_pending",
    gate: "planning-artifact acceptance",
    button: "Accept plan",
    consequence: "accepts the validated plan and prepares its build packet for approval; no Run starts"
  }
};

/**
 * Escalate (once) an in-scope Action that has been refused for a planning
 * review item for at least the dwell. Returns true when a named row now holds
 * the Action (new or unchanged); false when nothing qualifies, so the caller
 * clears as it did before. One row per Action, one ping per distinct gate item.
 */
function escalateStalledPlanningGate(
  db: Database.Database,
  input: { actionKey: string; projectSlug: string; workItemId: string | null; lifecycleKind: string | null; now: Date; log: (message: string) => void }
): boolean {
  if (!input.workItemId || (input.lifecycleKind !== "planning_approval_pending" && input.lifecycleKind !== "planning_in_progress")) return false;
  const refusal = db.prepare("SELECT first_at FROM production_launch_refusal_log WHERE action_key = ?").get(input.actionKey) as
    | { first_at: string }
    | undefined;
  if (!refusal || input.now.getTime() - Date.parse(refusal.first_at) < STALLED_GATE_MIN_DWELL_MS) return false;
  // Exactly the items /todo lists as operator-actionable (agent-flagged deferred items wait on an agent and are hidden there).
  const item = listActionableReviewItems(db)
    .filter((candidate) => candidate.work_item_id === input.workItemId && Object.hasOwn(STALLED_PLANNING_GATES, candidate.resolved_intent))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!item) return false;
  const gate = STALLED_PLANNING_GATES[item.resolved_intent];
  // The leading words are the template /todo anchors on to show this item once, marked blocking.
  const message = `Launch of ${input.actionKey} is held by pending review item ${item.id}: ${gate.gate} for ${input.actionKey}.`;
  const todoKey = `review_item:${input.projectSlug}/${item.id}`;
  const remedy = `Press "${gate.button}" on /todo (${todoKey}), also on /review and /actions: one click, nothing to copy or type. `
    + `It ${gate.consequence}. This entry clears on the first tick after the gate is answered.`;
  const previous = db.prepare("SELECT kind, message FROM production_operator_escalations WHERE action_key = ?").get(input.actionKey) as
    | { kind: string; message: string }
    | undefined;
  if (previous?.kind === gate.kind && previous.message === message) return true;
  recordOperatorEscalation(db, { actionKey: input.actionKey, kind: gate.kind, message, remedy, now: input.now });
  input.log(`Escalated ${input.actionKey} to the operator (${gate.kind}): ${message}`);
  try {
    queueOperatorPing(db, {
      message: `Production is waiting on you: ${gate.gate} for ${input.actionKey}. One click: "${gate.button}" on /todo.`,
      kind: "attention",
      todo: todoKey,
      agent: "production-tick",
      now: input.now
    });
  } catch (error) {
    input.log(`Could not queue the ${gate.kind} ping for ${input.actionKey}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return true;
}

/**
 * The escalation kind for an in-scope Action whose launch the tick skips
 * because a pending operator item gates it: resolveProjectTransition answers
 * `decision` for an unsettled Agent Ask proposal or an open Decision naming
 * that Action (Issue #997; the mechanism of run 2's 33-minute stall, #968).
 * Recorded once per (Action, item) like `terminal_candidate_not_integrable`,
 * and cleared the first tick the gate is gone. The tick never settles,
 * rejects or answers the item itself.
 */
const OPERATOR_GATE_ESCALATION = "operator_gate_pending";

/**
 * Record the gate on `actionKey` as its one operator escalation. An
 * unchanged gate finds its own row and writes nothing (one escalation, one
 * log line per episode); a different item starts a new episode. The gate is
 * what stops the launch this tick, so it replaces any other kind on this
 * Action's row; that kind is re-detected by its own step once the gate is
 * gone. The remedy is computed once per episode. Returns true when it wrote.
 */
function recordOperatorGateEscalation(
  db: Database.Database,
  input: { actionKey: string; item: OperatorGateItem; repoRoot: string; acceptanceCriteria: string[]; now: Date; log: (message: string) => void }
): boolean {
  const { actionKey, item } = input;
  const label = item.kind === "agent_ask" ? "Agent Ask proposal" : "Decision";
  const message = `Launch of ${actionKey} is held by pending ${label} ${item.id}: ${item.title}`;
  const previous = db.prepare("SELECT kind, message FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as
    | { kind: string; message: string }
    | undefined;
  if (previous?.kind === OPERATOR_GATE_ESCALATION && previous.message === message) return false;
  // A completion settled without its commit on the candidate (Issue #1518) is
  // the gate's cause and is recorded only once, at the exit tick: keep it.
  if (previous?.kind === COMPLETION_SETTLEMENT_NOT_IN_CANDIDATE_ESCALATION || previous?.kind === SELF_SETTLED_COMPLETION_REFUSED_ESCALATION
    || previous?.kind === COMPLETION_VALIDATION_UNAVAILABLE_ESCALATION || previous?.kind === COMPLETION_REFUSED_REPEATEDLY_ESCALATION) return false;
  const remedy = operatorGateRemedy(db, { ...input, label });
  if (previous) clearOperatorEscalation(db, actionKey);
  recordOperatorEscalation(db, { actionKey, kind: OPERATOR_GATE_ESCALATION, message, remedy, now: input.now });
  input.log(`Escalated ${actionKey} to the operator (${OPERATOR_GATE_ESCALATION}): ${message}`);
  return true;
}

/**
 * The remedy for one operator gate: the item, then either the exact governed
 * command that settles it or the reason it cannot settle. For an Agent Ask the
 * reason comes from a settlement preview (which writes nothing) in the checkout
 * the proposal was drafted in, or the Project's checkout when that is gone. A
 * `complete` Ask whose own settlement that candidate already committed (the
 * settling process ended before recording it, and the worker did not see the
 * exit) is named as such: rejecting it would only let a continuation refuse
 * "Action is already done" again.
 */
function operatorGateRemedy(
  db: Database.Database,
  input: { actionKey: string; item: OperatorGateItem; label: string; repoRoot: string; acceptanceCriteria: string[] }
): string {
  const { item } = input;
  const blocked = `Blocked: pending ${input.label} ${item.id} ("${item.title}") gates ${input.actionKey}, so the tick launches nothing for it and never settles it itself.`;
  const clears = "This entry clears on the first tick after the gate is gone.";
  if (item.kind === "decision") {
    const recommended = item.recommendedOption ? ` The recommended option is "${item.recommendedOption}"${item.consequence ? ` (${item.consequence})` : ""}.` : "";
    return `${blocked} It is the operator's to answer, with \`${item.settleCommand}\` or the same command naming another option${item.relativePath ? ` (${item.relativePath})` : ""}.${recommended} ${clears}`;
  }
  const row = db.prepare("SELECT request_id, proposal_json FROM agent_ask_proposals WHERE id = ?").get(item.id) as
    | { request_id: string; proposal_json: string }
    | undefined;
  const requestId = row?.request_id ?? item.id;
  let sourcePath: string | null = null;
  let intent: string | null = null;
  try {
    const stored = row ? JSON.parse(row.proposal_json) as { sourcePath?: string | null; normalized?: { intent?: string } } : null;
    sourcePath = stored?.sourcePath ?? null;
    intent = stored?.normalized?.intent ?? null;
  } catch { /* the Project's checkout */ }
  const sourceDirectory = sourcePath ? path.dirname(sourcePath) : null;
  const checkout = sourceDirectory && existsSync(sourceDirectory) ? projectCheckoutFor(input.repoRoot, sourceDirectory) : input.repoRoot;
  const command = (disposition: string, settlementRequestId: string) =>
    `arcadia agent-ask settle --proposal ${item.id} --request-id ${settlementRequestId.slice(0, 120)} --disposition ${disposition}`;
  const twoPhase = "then the same command with `--apply --preview <fingerprint>`";
  const reject = `If it is stale, reject it from ${input.repoRoot}: \`${command("rejected", `reject-${requestId}`)}\`, ${twoPhase}.`;
  let reason: string | null = null;
  try {
    settleAgentAsk(db, { proposalRef: item.id, settlementRequestId: `accept-${requestId}`.slice(0, 120), disposition: "accepted", cwd: checkout });
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  if (reason === null) {
    return `${blocked} Its settlement preview passes (from ${checkout}); accepting it is the operator's call: \`${command("accepted", `accept-${requestId}`)}\`, ${twoPhase}. ${reject} ${clears}`;
  }
  if (intent === "complete" && checkout !== input.repoRoot) {
    let committed: string | null = null;
    try {
      committed = recordCommittedCompletionSettlement(db, {
        proposalRef: item.id, settlementRequestId: `worker-tick-record-${item.id}`.slice(0, 120), cwd: checkout,
        acceptanceCriteria: input.acceptanceCriteria, dryRun: true
      }).documentsCommit ?? null;
    } catch { /* not its committed settlement */ }
    const retire = `\`git -C ${input.repoRoot} worktree remove ${checkout}\``;
    if (committed) {
      let baseBranch = "the governed base branch";
      try { baseBranch = resolveBaseBranch(input.repoRoot); } catch { /* keep the generic name */ }
      return `${blocked} It cannot settle again (${reason}): ${checkout} at ${committed} is already its own canonical completion settlement, `
        + "never recorded because the settling process ended first and the worker did not reconcile that exit. Do not reject it alone: a continuation could only refuse again. "
        + `After an independent review of exactly ${committed}, an operator may land it with \`git -C ${input.repoRoot} merge --ff-only ${committed}\` (then push ${baseBranch}), `
        + `then retire that candidate's worktree with ${retire} (nothing is lost: its head is then on the base) so the next Action can launch, `
        + `and reject the now-moot proposal: \`${command("rejected", `reject-${requestId}`)}\`, ${twoPhase}. ${clears}`;
    }
    const candidatePlan = discoverDocs(checkout).docs.find((doc) => doc.type === "plan" && doc.actions.some((action) => input.actionKey.endsWith(`/${action.id}`)));
    const doneOnCandidate = candidatePlan?.type === "plan"
      && candidatePlan.actions.some((action) => input.actionKey.endsWith(`/${action.id}`) && action.status === "done");
    if (doneOnCandidate) {
      return `${blocked} It cannot settle: ${reason} (previewed in ${checkout}). That candidate already records the Action done, but its head is not this Ask's `
        + "canonical settlement, so nothing records it and a continuation could only refuse again: do not reject it alone. "
        + `Inspect it with \`git -C ${checkout} log --oneline -5\`. To redo the Action instead, retire that candidate's worktree with ${retire} `
        + `(its commits stay on its branch), then reject the proposal: \`${command("rejected", `reject-${requestId}`)}\`, ${twoPhase}. ${clears}`;
    }
  }
  return `${blocked} It cannot settle: ${reason} (previewed in ${checkout}). ${reject} ${clears}`;
}

/**
 * Why the pending-handoff branch skips a launch. The reconciliation wording is
 * only true when a Session was reconciled this tick; otherwise the wait is for
 * the candidate's own integration or operator merge (Issue #1632).
 */
export function launchSkipReason(input: { reconciledCount: number; refusal: { reason: string; operatorMergeCommand: string | null } | null; sessionId: string | null }): string {
  if (input.reconciledCount > 0 || !input.refusal) {
    return "Repository was just reconciled this tick; deferring admission one tick for its merge to land.";
  }
  return `Admission waits on the preserved candidate${input.sessionId ? ` of Session ${input.sessionId}` : ""}, which is not integrated: ${input.refusal.reason}`
    + `${input.refusal.operatorMergeCommand ? ` Operator merge: ${input.refusal.operatorMergeCommand}` : ""}`;
}

/** Whether every review repair row of this Action names a failed head other than `head` (and at least one exists). */
function repairStopIsForOtherHead(db: Database.Database, actionKey: string, head: string | null): boolean {
  if (!head) return false;
  try {
    const rows = db.prepare("SELECT failed_head FROM production_review_repairs WHERE action_key = ?").all(actionKey) as Array<{ failed_head: string }>;
    return rows.length > 0 && rows.every((row) => row.failed_head !== head);
  } catch { return false; }
}

/**
 * Record a terminal-guard refusal as one operator escalation per
 * (Session, head, reason) -- the message names all three, so an unchanged
 * refusal finds its own row and writes nothing, while a new head or a new
 * reason replaces it as a fresh episode. Replaces a stale plain verdict-wait
 * row for the same Action (the verdict gate is not even reached while a
 * terminal guard refuses), and never overwrites any other open escalation
 * kind. Because the steady state writes nothing, `last_seen_at` stays at the
 * episode's first tick; the row's presence, not that timestamp, means the
 * refusal still holds (it is cleared the tick it stops). Returns true when it
 * wrote.
 */
export function recordTerminalCandidateEscalation(
  db: Database.Database,
  input: { facts: TerminalRefusalFacts; repoRoot: string; now: Date; log: (message: string) => void }
): boolean {
  const { session, reason, head } = input.facts;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const message = `Terminal candidate of Session ${session.id} (${session.branch} at ${head ?? "an unreadable head"}) cannot integrate: ${reason}`;
  const previous = db.prepare("SELECT kind, message FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as
    | { kind: string; message: string }
    | undefined;
  if (previous?.kind === TERMINAL_CANDIDATE_ESCALATION && previous.message === message) return false;
  // Only a plain verdict wait is superseded: a durable review block (a failed
  // verdict, an exhausted review budget) stays the open escalation.
  // A review repair stop recorded for an older head is stale once the candidate
  // sits on another head: the refusal at the current head is the real blocker
  // (Issue #1632). A repair stop on this very head stays.
  const staleRepairStop = previous !== undefined && REVIEW_REPAIR_ESCALATIONS.has(previous.kind) && repairStopIsForOtherHead(db, actionKey, head);
  if (previous && previous.kind !== TERMINAL_CANDIDATE_ESCALATION && !PLAIN_VERDICT_WAITS.has(previous.kind) && !staleRepairStop) return false;
  const remedy = terminalCandidateRemedy(db, input.facts, input.repoRoot);
  // A new episode starts its own `first_detected_at`, rather than inheriting
  // the replaced row's.
  if (previous) clearOperatorEscalation(db, actionKey);
  recordOperatorEscalation(db, { actionKey, kind: TERMINAL_CANDIDATE_ESCALATION, message, remedy, now: input.now });
  input.log(`Escalated ${actionKey} to the operator (${TERMINAL_CANDIDATE_ESCALATION}): ${message}`);
  return true;
}

const MAX_REMEDY_LINES = 8;

function cappedLines(output: string | null): string[] {
  const lines = (output ?? "").split("\n").map((line) => line.trimEnd()).filter(Boolean);
  return lines.length > MAX_REMEDY_LINES ? [...lines.slice(0, MAX_REMEDY_LINES), `... ${lines.length - MAX_REMEDY_LINES} more`] : lines;
}

/** A drafted Agent Ask file path, the kind settlement archives itself (Issue #981). */
const DRAFTED_ASK_PATH = /^\.arcadia\/asks\/agent-ask-[^/]+\.ya?ml$/;

/**
 * The operator remedy for one terminal-guard refusal, built only from facts
 * read without changing anything (`git status`, `git log`, `git diff`). It
 * names the blocker first, because `production status` shows the remedy.
 * It proposes no destructive step: the extra work stays preserved, and a
 * stray untracked draft is only ever moved aside after its identity with the
 * archived copy is checked.
 */
function terminalCandidateRemedy(db: Database.Database, facts: TerminalRefusalFacts, repoRoot: string): string {
  const { session, reason, head, operatorMergeCommand } = facts;
  const worktree = session.worktree_path;
  const actionKey = `${session.project_slug}/${session.action_id}`;
  const retry = "The tick re-checks every tick and integrates on its own once the cause clears.";
  const blocked = `Blocked: ${reason}`;
  if (reason === "The terminal candidate differs from its exact canonical completion settlement.") {
    const settlementCommit = facts.settlementCommit ?? latestCandidateSettlementCommit(db, session, repoRoot);
    const inspect = settlementCommit
      ? `Inspect with \`git -C ${worktree} status --porcelain\` and \`git -C ${worktree} log --oneline ${settlementCommit}..HEAD\`.`
      : `Inspect with \`git -C ${worktree} status --porcelain\` and \`git -C ${worktree} log --oneline -5\`.`;
    // Only the guard's own canonical settlement at this head means the ancestry check failed.
    if (head && facts.settlementCommit === head) {
      return `${blocked} Head ${head} is its completion settlement commit, but the worker's preserved commit is not an ancestor of it, `
        + `so it is not the candidate that preservation validated. ${inspect} ${retry} `
        + `After an independent review, an operator may land it with \`${operatorMergeCommand}\`.`;
    }
    if (!settlementCommit || !head || settlementCommit === head) {
      return `${blocked} No applied completion settlement commit of ${actionKey} matches head ${head ?? "unknown"} on ${session.branch}. ${inspect} `
        + `Unattended integration lands only the exact settlement commit. ${retry} After an independent review, an operator may land it with \`${operatorMergeCommand}\`.`;
    }
    const extra = cappedLines(tryGit(worktree, ["log", "--oneline", "--no-decorate", `${settlementCommit}..${head}`]));
    const paths = cappedLines(tryGit(worktree, ["diff", "--name-only", settlementCommit, head]));
    const onlyDraftedAsks = paths.length > 0 && paths.every((file) => DRAFTED_ASK_PATH.test(file));
    let baseBranch = "the governed base branch";
    try { baseBranch = resolveBaseBranch(repoRoot); } catch { /* keep the generic name */ }
    const landing = candidateLandingCommand({ repoRoot, branch: settlementCommit, baseBranch, head: settlementCommit,
      pullRequestUrl: pullRequestUrlOf(db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${session.id}`) as { receipt_json: string } | undefined) });
    return `${blocked} Head ${head} carries ${extra.length === 0 ? "changes" : `commit(s) ${extra.join("; ")}`} after its completion settlement commit ${settlementCommit}`
      + `${paths.length > 0 ? `, changing ${paths.join(", ")}` : ""}. `
      + (onlyDraftedAsks
        ? "Those commits only add a drafted Agent Ask file: a draft left untracked beside its settlement, which the worker's terminal preservation then committed (Issue #981). "
        : "")
      + `${inspect} The tick never integrates a head other than the settlement commit, and no command removes the extra commit. `
      + `After an independent review of exactly ${settlementCommit}, an operator may land the settlement itself with `
      + (landing.startsWith("gh ")
        ? `\`${landing}\` (the base has advanced past the candidate, so a fast-forward would fail); the extra commit stays preserved on ${session.branch}.`
        : `\`git -C ${repoRoot} merge --ff-only ${settlementCommit}\` (then push ${baseBranch}); the extra commit stays preserved on ${session.branch}.`);
  }
  if (reason === "The terminal candidate worktree is missing or changed.") {
    const status = tryGit(worktree, ["status", "--porcelain", "--untracked-files=all"]);
    if (status === null) {
      return `${blocked} The worktree ${worktree} is missing or unreadable as a Git checkout. Restore it at ${session.branch} without changing its commits. ${retry} `
        + `Manual fallback after an independent review: \`${operatorMergeCommand}\`.`;
    }
    const changes = cappedLines(status);
    const onlyDraftedAsks = changes.length > 0 && changes.every((line) => line.startsWith("?? ") && DRAFTED_ASK_PATH.test(line.slice(3)));
    return `${blocked} \`git -C ${worktree} status --porcelain --untracked-files=all\` shows: ${changes.join("; ")}. `
      + (onlyDraftedAsks
        ? "Every change is an untracked drafted Agent Ask file. Compare each with its namesake in .arcadia/asks/archive/ "
          + "(only `candidate_revision` may differ); if it is that settled Ask, move the stray copy out of the worktree "
          + "(keep it, do not commit it to the candidate) and the next tick integrates. An unsettled draft must stay and be settled instead. "
        : "Preserve any change worth keeping on a recovery branch rather than committing it to the settled candidate. ")
      + `${retry} Manual fallback after an independent review: \`${operatorMergeCommand}\`.`;
  }
  if (reason === "No current exact validation and integration Grant authorizes terminal recovery." || reason.startsWith(LAPSED_INTEGRATION_GRANT)) {
    return `${blocked} Record a fresh, unexpired integration Grant (Decision 0058) whose scope names ${actionKey}. ${retry} `
      + `Manual fallback after an independent review: \`${operatorMergeCommand}\`.`;
  }
  return `${blocked} ${retry} Manual fallback after an independent review: \`${operatorMergeCommand}\`.`;
}

/**
 * Record (or refresh) the `repair_budget_exhausted` escalation for an
 * Action, and log it exactly once per episode (CodeRabbit, PR #708).
 *
 * Called from two places: the instant a failed launch attempt pushes
 * `attempts` to the limit (so the escalation exists even if the Action
 * becomes ineligible for another launch attempt -- Off, a paused Project, a
 * repository lease -- before a later tick would otherwise reach the
 * pre-launch budget check below), and that pre-launch check itself, which
 * needs the identical row on every tick the budget stays exhausted. Both
 * calls are idempotent through `recordOperatorEscalation`'s upsert.
 *
 * `recordOperatorEscalation`'s own `newlyDetected` return is keyed only by
 * whether *any* row already existed for this `actionKey`, so it stays false
 * when an unrelated escalation (e.g. `no_validation_commands`) already
 * occupied that row -- comparing the previous `kind` here as well is what
 * still logs the first `repair_budget_exhausted` episode in that case.
 */
function recordRepairBudgetExhaustedEscalation(
  db: Database.Database,
  input: { actionKey: string; attempts: number; lastError: string | null; now: Date; log: (message: string) => void }
): string {
  const wall = db.prepare("SELECT message FROM production_operator_escalations WHERE action_key = ? AND kind IN (?, ?)").get(
    input.actionKey,
    ENVIRONMENT_WALL_ESCALATION_KIND,
    BUDGET_EXHAUSTED_ESCALATION_KIND
  ) as { message: string } | undefined;
  // A named environment wall or token-ceiling stop already explains this exhaustion; never replace it with the generic row.
  if (wall) return wall.message;
  const remedy = `Repair the underlying problem, then run \`arcadia production reset-repair-budget ${input.actionKey}\`.`;
  const reason = `Repair budget exhausted for ${input.actionKey} after ${input.attempts} failed launch attempt(s); most recent error: ${input.lastError ?? "unknown"}. ${remedy}`;
  const previousKind = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(input.actionKey) as
    | { kind: string }
    | undefined;
  const newlyDetected = recordOperatorEscalation(db, {
    actionKey: input.actionKey,
    kind: "repair_budget_exhausted",
    message: reason,
    remedy,
    now: input.now
  });
  if (newlyDetected || previousKind?.kind !== "repair_budget_exhausted") {
    input.log(`Escalated ${input.actionKey} to the operator (repair_budget_exhausted): ${reason}`);
  }
  return reason;
}

/**
 * Drop any escalation left over from a *different* Action in this Project.
 * `recordOperatorEscalation`/`clearOperatorEscalation` only ever touch the
 * actionKey the current tick is looking at, so an Action that stops being
 * current by some other route -- the pointer advances, or it is marked done
 * through a `complete` Agent Ask rather than through this tick's own launch
 * success -- would otherwise leave a stale row that `listOperatorEscalations`
 * keeps reporting forever. Called with the Project's live actionKey (or
 * `null` when nothing is currently dispatchable), so it always reconciles
 * against the one actionKey this tick knows to be current. Also prunes the
 * dependency-unresolved sighting table (below) for the same reason and by the
 * same rule: it is per-Action bookkeeping with the identical staleness risk.
 */
function pruneStaleOperatorEscalations(db: Database.Database, projectSlug: string, currentActionKey: string | null): void {
  // Operator decision 2026-10-21: an Action held by a review repair escalation
  // keeps it while the pointer is on another Action; the operator resolves it.
  const heldKinds = [...REVIEW_REPAIR_ESCALATIONS];
  db.prepare(`DELETE FROM production_operator_escalations WHERE action_key LIKE ? AND action_key != ? AND kind NOT IN (${heldKinds.map(() => "?").join(", ")})`).run(
    `${projectSlug}/%`,
    currentActionKey ?? "",
    ...heldKinds
  );
  db.prepare("DELETE FROM production_dependency_unresolved_sightings WHERE action_key LIKE ? AND action_key != ?").run(
    `${projectSlug}/%`,
    currentActionKey ?? ""
  );
}

/**
 * The `depends_on` id named by a `dependency_unresolved` readiness blocker
 * (`collectUnmetDependencies`, `src/docs/dispatch.ts`), or `null` when none of
 * `blockers` is one. Matches both the plain "resolves nowhere" case and the
 * "(ambiguous)" case (resolves to more than one Action) -- both are equally
 * incapable of ever resolving on their own, so both are worth escalating the
 * same way; only a dependency that is merely unfinished (still "open",
 * "in_progress", etc.) is excluded, because that one resolves itself as soon
 * as the named Action finishes.
 */
function unresolvedDependencyIdFrom(blockers: DispatchBlocker[]): string | null {
  for (const blocker of blockers) {
    if (!blocker.field.includes("depends_on")) continue;
    const match = /^Depends on "([^"]+)".*which is "dependency_unresolved(?: \(ambiguous\))?", not done\.$/.exec(blocker.message);
    if (match) return match[1];
  }
  return null;
}

/**
 * Escalate a `depends_on` id that has stayed unresolved for more than one
 * worker tick, instead of the Action simply waiting silently forever (an
 * unresolved or ambiguous reference cannot self-resolve the way an ordinary
 * unfinished dependency does -- no amount of other work finishing ever fixes
 * a typo or a genuine ambiguity in the plan document).
 *
 * The first tick a given unresolved id is seen for an Action only records the
 * sighting: a reference that is wrong for one tick and fixed the next
 * (a document edit landing between two ticks, say) should never reach the
 * operator. Only from the second consecutive tick seeing the *same*
 * unresolved id does this record the durable `production_operator_escalations`
 * row `listOperatorEscalations` (and `arcadia production status`) surface.
 */
function recordDependencyUnresolvedSighting(
  db: Database.Database,
  input: { actionKey: string; unresolvedId: string; now: Date; log: (message: string) => void }
): void {
  const at = input.now.toISOString();
  const existing = db
    .prepare("SELECT unresolved_id FROM production_dependency_unresolved_sightings WHERE action_key = ?")
    .get(input.actionKey) as { unresolved_id: string } | undefined;

  if (!existing || existing.unresolved_id !== input.unresolvedId) {
    db.prepare(
      `INSERT INTO production_dependency_unresolved_sightings (action_key, unresolved_id, first_seen_at, last_seen_at)
         VALUES (@action_key, @unresolved_id, @at, @at)
       ON CONFLICT(action_key) DO UPDATE SET
         unresolved_id = @unresolved_id, first_seen_at = @at, last_seen_at = @at`
    ).run({ action_key: input.actionKey, unresolved_id: input.unresolvedId, at });
    // A newly (or differently) unresolved id gets its own fresh baseline
    // tick -- but only clear a `dependency_unresolved` escalation this same
    // bookkeeping owns. `production_operator_escalations` is keyed only by
    // action_key, so an unrelated kind (e.g. `no_validation_commands`) could
    // be sitting on this row too, and a new sighting must not silently
    // delete it.
    const existingEscalationKind = db
      .prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?")
      .get(input.actionKey) as { kind: string } | undefined;
    if (existingEscalationKind?.kind === "dependency_unresolved") {
      clearOperatorEscalation(db, input.actionKey);
    }
    return;
  }

  db.prepare("UPDATE production_dependency_unresolved_sightings SET last_seen_at = @at WHERE action_key = @action_key").run({
    action_key: input.actionKey,
    at
  });

  const message = `Action "${input.actionKey}" depends on "${input.unresolvedId}", which has stayed unresolved for more than one worker tick.`;
  const remedy = `Fix or remove the depends_on entry "${input.unresolvedId}" on ${input.actionKey}: it names no known Action, or names more than one.`;
  const newlyDetected = recordOperatorEscalation(db, {
    actionKey: input.actionKey,
    kind: "dependency_unresolved",
    message,
    remedy,
    now: input.now
  });
  if (newlyDetected) {
    input.log(`Escalated ${input.actionKey} to the operator (dependency_unresolved): ${message}`);
  }
}

/** Clear a dependency-unresolved sighting once its `depends_on` id resolves, or the Action moves on. */
function clearDependencyUnresolvedSighting(db: Database.Database, actionKey: string): void {
  db.prepare("DELETE FROM production_dependency_unresolved_sightings WHERE action_key = ?").run(actionKey);
  const existing = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as
    | { kind: string }
    | undefined;
  if (existing?.kind === "dependency_unresolved") {
    clearOperatorEscalation(db, actionKey);
  }
}

export interface OperatorEscalation {
  actionKey: string;
  kind: string;
  message: string;
  remedy: string | null;
  firstDetectedAt: string;
  lastSeenAt: string;
}

/**
 * Every currently unresolved non-self-resolving launch refusal, oldest first.
 * Unlike `listRecentBaseBranchAdvances` this is not a historical log to page
 * through -- rows are deleted on resolution and pruned when stale (see
 * `pruneStaleOperatorEscalations`), so the live set is always small, and a
 * page limit would only silently hide escalations past an arbitrary cutoff.
 *
 * Deliberately does not call `ensureProductionTickTables`: this is read
 * through `arcadia production status`'s read-only connection, which cannot
 * run a `CREATE TABLE` migration. `production_operator_escalations` lives in
 * `db/schema.ts` instead of here for exactly that reason -- it is applied on
 * every writable open, so it already exists by the time any read-only open
 * is possible against a workspace created *after* this table shipped. A
 * workspace whose database predates it has no writable open to have run that
 * migration yet either, so "no such table" here means the same thing a
 * successful, empty query would: no escalation has been recorded.
 */
export function listOperatorEscalations(db: Database.Database): OperatorEscalation[] {
  let rows: Array<{
    action_key: string;
    kind: string;
    message: string;
    remedy: string | null;
    first_detected_at: string;
    last_seen_at: string;
  }>;
  try {
    rows = db
      .prepare(
        `SELECT action_key, kind, message, remedy, first_detected_at, last_seen_at
           FROM production_operator_escalations
          ORDER BY first_detected_at ASC`
      )
      .all() as typeof rows;
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) return [];
    throw error;
  }
  return rows.map((row) => ({
    actionKey: row.action_key,
    kind: row.kind,
    message: row.message,
    remedy: row.remedy,
    firstDetectedAt: row.first_detected_at,
    lastSeenAt: row.last_seen_at
  }));
}

/**
 * Whether the standing policy authorizes managing `projectSlug` right now.
 * Re-read rather than snapshotted: the tick blocks for minutes between the
 * scheduling pass and each Project, so a policy narrowed mid-tick must apply to
 * the Projects not yet processed. With no Active policy there is no scope
 * filter and every active Project is eligible.
 */
function projectInActiveScope(db: Database.Database, projectSlug: string): boolean {
  const read = readProductionPolicySafely(db);
  if (read.status !== "ok" || read.policy.desiredState !== "active") return true;
  return (read.policy.scope?.projects ?? []).includes(projectSlug);
}

/**
 * Run one managed-production tick across every active Project. Never throws
 * for an individual repository's failure -- a broken or refused repository is
 * reported in its own result entry so one Project's trouble never stops the
 * tick from reaching the rest.
 */
export function runManagedProductionTick(
  db: Database.Database,
  workspace: string,
  options: ManagedProductionTickOptions
): ManagedProductionTickResult {
  ensureProductionTickTables(db);
  const now = options.now ?? new Date();
  const clock = options.clock ?? (options.now ? () => now : () => new Date());
  const log = options.log ?? (() => {});
  const tmux = options.tmux ?? systemTmux;
  const policyRead = readProductionPolicySafely(db);
  const active = policyRead.status === "ok" && policyRead.policy.desiredState === "active";

  // When a standing policy is Active, its scope names the only Projects the
  // worker is authorized to launch in. Base-branch observation and launch are
  // production management, so both stay inside that scope: an out-of-scope
  // Project is never previewed and never produces a misleading "not ready"
  // refusal. Reconciliation of an already-live Session is a safety path, not
  // management, so it still runs for every active Project and a Session that
  // predates the current grant is never left unreconciled.

  // Scheduling runs first: reconcile each linked GitHub board and point every
  // Project at its canonical next Action, so admission below launches what the
  // queue says rather than whatever the pointer last happened to name.
  let scheduling: SchedulingPassResult | null = null;
  let schedulingError: string | null = null;
  if (active) {
    try {
      scheduling = runSchedulingPass(db, {
        now, log, boardFactory: options.boardFactory,
        projectSlugs: policyRead.status === "ok" ? policyRead.policy.scope?.projects ?? [] : []
      });
    } catch (error) {
      schedulingError = error instanceof Error ? error.message : String(error);
      log(`Scheduling pass failed: ${schedulingError}`);
    }
    options.heartbeat?.();
  }

  const projects: ManagedProductionTickProjectResult[] = [];
  for (const project of listProjectsInSchedulingOrder(db)) {
    options.heartbeat?.();
    const metadata = getProjectMetadata(db, project.id);
    const configuredPath = metadata?.repo_path?.trim() || null;
    if (!configuredPath || !existsSync(configuredPath)) {
      projects.push({ projectSlug: project.slug, repositoryRoot: null, baseBranchAdvance: null, reconciled: [], handoff: null, launch: null });
      continue;
    }
    const repoRoot = path.resolve(configuredPath);

    let baseBranchAdvance: BaseBranchAdvanceObservation | null = null;
    let askSurfacing: MergedAskSurfacing | null = null;
    if (projectInActiveScope(db, project.slug) && shouldAttemptBaseBranchObservation(db, { projectSlug: project.slug, repoRoot, now })) {
      try {
        // Moving the checkout is management, so only an Active policy whose
        // scope names this Project authorizes it. With production Off every
        // Project passes the scope check above, and fast-forwarding then kept
        // every DB-active checkout in lockstep with its remote, silently
        // undoing a manual `git reset` (Issue #608). Observation still runs.
        const policyForAdvance = readProductionPolicySafely(db);
        const fastForward = policyForAdvance.status === "ok" && policyForAdvance.policy.desiredState === "active"
          && (policyForAdvance.policy.scope?.projects ?? []).includes(project.slug);
        baseBranchAdvance = detectBaseBranchAdvance(db, { repoRoot, projectSlug: project.slug, projectId: project.id, now, log, fastForward });
        clearBaseBranchObservationFailure(db, project.slug);
        // An Ask merged from a cloud session only becomes a pending approval
        // once something previews it; do that here, on the checkout the tick
        // just fast-forwarded, so the operator can accept it from the
        // dashboard without running a command on this machine. Only an Active
        // policy authorizes it: with production Off every Project passes the
        // scope check, and nothing should surface on its own.
        const policyNow = readProductionPolicySafely(db);
        if (policyNow.status === "ok" && policyNow.policy.desiredState === "active" && baseBranchAdvance) {
          try {
            askSurfacing = surfaceMergedAgentAsks(db, { repoRoot, projectSlug: project.slug, baseSha: baseBranchAdvance.newSha, now, log });
          } catch (error) {
            log(`Agent Ask surfacing failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (recordBaseBranchObservationFailure(db, { projectSlug: project.slug, repoRoot, message, now })) {
          log(`Base branch observation failed for ${project.slug}: ${message}`);
        }
        baseBranchAdvance = null;
      }
    }
    options.heartbeat?.();

    const reconciled: Array<{ sessionId: string; outcome: string }> = [];
    let handoff: SessionHandoffResult | null = null;
    // Observability only: which Session and head this tick's handoff is
    // about, and the terminal guard that refused it, if one did.
    let handoffSessionId: string | null = null;
    let handoffHead: string | null = null;
    let terminalRefusal: TerminalRefusalFacts | null = null;
    // The review step's outcome for the recovered candidate, when one ran (the review repair loop's trigger).
    let handoffReview: ReviewStepOutcome | undefined;
    let handoffSession: AgentSession | undefined;
    const alertCtx = { db, workspace, projectSlug: project.slug, now };
    // Scope drift is observed once per tick for every Project, before any early skip below, so a
    // stranded scope is seen whether or not this tick could launch, wait or reconcile.
    safelyRaiseRedAlerts(log, "scope drift", () => observeScopeDriftForProject(alertCtx, repoRoot));
    // Set only once the exit-reconcile branch starts, so a throw from the
    // live-session stall observation is never reported as a failed reconcile.
    let alertLease: ReturnType<typeof getRepositoryLease> = null;
    try {
      const lease = getRepositoryLease(db, repoRoot);
      // A Session stopped this tick is preserved and reconciled on the next
      // one, so SIGHUP'd children can finish writing first.
      let stoppedThisTick = false;
      if (lease && tmux.hasSession(lease.tmux_session_name)) {
        // tmux is alive; check whether it is actually moving. Neither branch
        // here touches `lease`/`status`, so the repository lease this Session
        // holds is untouched either way -- a suspected stall is surfaced, not
        // reconciled. The flag write and its event are one transaction: if the
        // event insert failed after the flag alone committed, a later tick
        // would see `stall_flagged_at` already set and never retry the event.
        const activity = writeTransaction(db, () => {
          const observed = observeSessionActivity(db, lease, tmux, now, PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs);
          if (observed.newlyStalled) {
            recordEvent(db, {
              eventType: "managed_production.session_stalled",
              projectId: project.id,
              payload: { projectSlug: project.slug, sessionId: lease.id, actionId: lease.action_id, tmuxSessionName: lease.tmux_session_name },
              at: now.toISOString()
            });
          }
          return observed;
        });
        safelyRaiseRedAlerts(log, "stall", () => observeStall(alertCtx, { session: lease, stalled: activity.stalled, tmux }));
        if (activity.newlyStalled) {
          log(
            `Session ${lease.id} for ${project.slug} has shown no new tmux pane output and no new Run/receipt activity for ` +
              `${PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs}ms; flagged stalled. It is ended at its time limit, or sooner if its pane shows a blocking condition; the exit receipt then records why.`
          );
        } else if (activity.recovered) {
          log(`Session ${lease.id} for ${project.slug} resumed activity; its stalled flag is cleared.`);
        }
        // Bounded lifetime: end a Session past its wall-clock limit, or one
        // whose pane shows a blocking condition that persisted past the stall
        // deadline. Only `tmux kill-session`; the dead-session branch below
        // then preserves, reconciles (writing the receipt with this reason)
        // and releases the lease on the next tick. The kill must be confirmed
        // (tmux no longer reports the Session) before it counts as a stop.
        {
          const { stopped, failed } = enforceSessionLifetime(db, {
            session: lease, tmux, now, stalled: activity.stalled,
            stallDeadlineMs: PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs,
            headless: existsSync(sessionLogPath(workspace, lease.id)),
            tokenCeilingBreach: sessionTokenCeilingBreach(db, { workspace, session: lease })?.message ?? null
          });
          if (stopped) {
            stoppedThisTick = true;
            recordEvent(db, {
              eventType: "managed_production.session_stopped",
              projectId: project.id,
              payload: { projectSlug: project.slug, sessionId: lease.id, actionId: lease.action_id, tmuxSessionName: lease.tmux_session_name, kind: stopped.kind, reason: stopped.reason },
              at: now.toISOString()
            });
            log(`Stopped Session ${lease.id} for ${project.slug}: ${stopped.reason} Its exit is preserved and reconciled next tick.`);
          } else if (failed) {
            log(`Could not stop Session ${lease.id} for ${project.slug} (${failed.reason}): tmux still reports it alive; retrying next tick.`);
          }
        }
      }
      if (lease && !stoppedThisTick && !tmux.hasSession(lease.tmux_session_name)) {
        alertLease = lease;
        // Preserve the dead Session's candidate before reconciliation marks it
        // terminal (validation runs against the still-active lease), then
        // reconcile through the canonical completion/pointer writers, then
        // integrate the branch -- now carrying the completion settlement --
        // only under Decision 0058's separately recorded grant. Absent a valid
        // grant this stops after preservation and reports the operator merge.
        // A confirmed operator Launch's one-shot authorization (Decision 0096)
        // stands in for production's validation delegation when production does
        // not itself cover this Action: validate, commit and push now, the draft
        // PR after an accepted completion. Production's own path is unchanged.
        const operatorExit = operatorLaunchForExit(db, lease, now);
        if (operatorExit?.kind === "refused") log(`Operator launch authority for Session ${lease.id} is not usable: ${operatorExit.reason}`);
        const operatorAuthorization = operatorExit?.kind === "authorized" ? operatorExit.authorization : null;
        const preservation: PreservationStep = operatorAuthorization
          ? preserveOperatorLaunchExit({ db, workspace, repoRoot, session: lease, authorization: operatorAuthorization, now }, options.handoff?.preserve ?? {})
          : operatorExit?.kind === "refused"
            ? { kind: "refused", reason: `Host-side validation is not authorized for this Action: ${operatorExit.reason}` }
            : preserveSessionCandidate({ db, workspace, repoRoot, session: lease, now }, options.handoff?.preserve ?? {});
        // A refusal here leaves the candidate uncommitted and blocks everything
        // after it, so it is never silent (the 2026-10-18 stall left no trace).
        if (preservation.kind === "refused") log(`Preservation refused for Session ${lease.id} (${project.slug}/${lease.action_id}): ${preservation.reason}`);
        // An agent that died between its settlement commit and the receipt
        // left a pending completion (Issue #995): record it first, so the
        // reconciliation below finds the settlement exactly as if the agent
        // had finished.
        recordInterruptedCompletionSettlement(db, { session: lease, repoRoot, log });
        // A preservation refusal that has now repeated identically past the
        // budget must not be classified as resumable: the next tick would
        // otherwise launch a fresh Session for the same Action, reproduce the
        // same failure, and repeat forever. `suppressLeaseHandoff` keeps the
        // receipt's outcome exactly what the evidence says (still
        // `incomplete_resumable` when the candidate has real changes) while
        // stopping it from being offered to `prepareSession`'s resumption path.
        // The same holds for a candidate that already carries its Action's
        // recorded completion settlement with more work after it (Issue
        // #994): a continuation could only refuse "Action is already done";
        // the terminal guards take it instead (`recoverTerminalHandoff`).
        // A Session over its platform token ceiling is recorded as stopped by
        // it (also when it exited on its own): the receipt then names
        // `budget_exhausted` with the ceiling and both token counts.
        if (!lease.stop_reason) {
          const overCeiling = sessionTokenCeilingBreach(db, { workspace, session: lease });
          if (overCeiling) {
            db.prepare("UPDATE agent_sessions SET stop_reason = ?, updated_at = ? WHERE id = ?").run(overCeiling.message, now.toISOString(), lease.id);
            lease.stop_reason = overCeiling.message;
          }
        }
        const continuation = getSessionContinuation(db, lease);
        const settledOnCandidate = latestCandidateSettlementCommit(db, lease, repoRoot);
        const result = reconcileSessionExit({
          db, sessionId: lease.id, requestId: `worker-tick-reconcile-${lease.id}`, repoRoot, workspace,
          ...(options.handoff?.completionValidation ? { completionValidation: options.handoff.completionValidation } : {}),
          suppressLeaseHandoff: preservation.kind === "refused" && preservation.identicalRefusalLimitReached
            ? { reason: `Preservation refused an identical reason repeatedly (${preservation.reason}); not offered for automatic resumption.` }
            : settledOnCandidate
              ? { reason: `Its candidate already carries the Action's recorded completion settlement ${settledOnCandidate}; not offered for automatic resumption, the terminal guards decide it.` }
              : undefined,
          // Keep retry accounting atomic with the terminal Session/receipt.
          // A worker crash cannot commit one without the other; replay is a no-op.
          onReceiptWrite: (receipt) => {
            const actionKey = `${project.slug}/${lease.action_id}`;
            const unchanged = continuation !== null && receipt.outcome === "incomplete_resumable"
              && receipt.candidate_revision === (lease.launch_revision ?? lease.base_revision)
              && tryGit(lease.worktree_path, ["status", "--porcelain"]) === "";
            if (unchanged) {
              recordRepairAttempt(db, actionKey, `Resumed Session ${lease.id} exited incomplete without changing its candidate.`, now);
              const attempts = getRepairAttempts(db, actionKey);
              if (attempts.attempts >= PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) {
                recordRepairBudgetExhaustedEscalation(db, { actionKey, attempts: attempts.attempts,
                  lastError: attempts.lastError, now, log });
              }
            } else if (receipt.outcome === "accepted_completion"
              || (continuation !== null && receipt.outcome === "incomplete_resumable" && receipt.candidate_revision !== continuation.candidate_revision)) {
              resetRepairAttempts(db, actionKey);
            }
            // Tokens per attempt and the environment-wall stop commit with the
            // receipt, so a crash cannot lose the wall and relaunch into it.
            const capability = recordSessionExitAccounting(db, {
              workspace, projectSlug: project.slug, session: lease, outcome: receipt.outcome,
              candidateRevision: receipt.candidate_revision, now, log
            });
            if (capability) {
              // This is the new receipt's creation transaction, never a read-side backfill.
              receipt.evidence_json = JSON.stringify({ ...JSON.parse(receipt.evidence_json ?? "{}"), sessionCapability: capability });
              db.prepare("UPDATE session_exit_receipts SET evidence_json = ? WHERE id = ? AND session_id = ?")
                .run(receipt.evidence_json, receipt.id, lease.id);
            }
          }
        });
        // Issue #1518: a completion the worker settled after preservation
        // pushed the candidate must reach the pushed branch (and its PR) now,
        // and a settlement that never reached the candidate is escalated.
        publishSettledCandidateHead(db, { session: lease, repoRoot, workspace, preservation, operatorLaunch: Boolean(operatorAuthorization),
          receipt: result.receipt, remote: options.handoff?.preserve?.remote ?? systemPreservationRemote, now, log });
        // Integrate only a candidate whose governed completion actually settled
        // this tick. Without that, fast-forwarding the branch would land the
        // agent's work on the base branch while the pointer still names the same
        // Action, and the next tick would re-admit it. An unfinished or failed
        // Session is preserved and reported, never merged.
        const completed = result.receipt.outcome === "accepted_completion";
        const integration = preservation.kind === "preserved" && completed && !operatorAuthorization
          ? integrateSessionCandidate({ db, workspace, repoRoot, session: lease, now, clock,
              verdictGate: () => escalatingVerdictGate(db, { session: lease, repoRoot, now, log }) }, integrateDepsWithGitHub(options))
          : {
              kind: "refused" as const,
              reason: operatorAuthorization
                ? "Preserved under an operator Launch authorization (Decision 0096), which never authorizes integration; merge it through its pull request."
                : preservation.kind === "preserved"
                ? `Integration waits on a governed completion; reconciliation outcome was ${result.receipt.outcome}.`
                : `Integration waits on a preserved candidate: ${preservation.reason}`,
              operatorMergeCommand: preservation.kind === "preserved"
                ? operatorMergeCommand({ repoRoot, branch: lease.branch, baseBranch: preservation.baseBranch })
                : null
            };
        handoff = { preservation, integration };
        handoffSessionId = lease.id;
        reconciled.push({ sessionId: lease.id, outcome: result.receipt.outcome });
        log(`Reconciled Session ${lease.id} for ${project.slug}: ${result.receipt.outcome} (${result.receipt.reason})`);
        if (operatorAuthorization) {
          try {
            const conclusion = concludeOperatorLaunchExit({
              db, workspace, repoRoot, session: lease, authorization: operatorAuthorization, now,
              commit: preservation, reconcileOutcome: result.receipt.outcome, reconcileReason: result.receipt.reason
            }, options.handoff?.preserve ?? {});
            log(`Operator launch authorization ${conclusion.authorizationId} used for Session ${lease.id}: ${conclusion.outcome}; `
              + `commit ${preservation.kind === "preserved" ? `${preservation.state} ${preservation.commitSha.slice(0, 12)}` : `${preservation.kind} (${preservation.kind === "refused" ? preservation.reason : "no changes"})`}; `
              + `draft PR ${conclusion.pullRequestUrl ?? (conclusion.publishState === "none" ? "not opened (no accepted completion)" : `not opened yet (${conclusion.publishState})`)}.`
              + (result.receipt.reason.startsWith(PROVIDER_SIGN_IN_FAILURE_PREFIX)
                ? " The provider was not signed in and no work was done, but Decision 0096 makes the authorization one-shot: sign in, then a fresh confirmed Launch is needed."
                : ""));
          } catch (error) {
            log(`Operator launch authorization for Session ${lease.id} could not be concluded: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        safelyRaiseRedAlerts(log, "reconcile clear", () => {
          observeReconcileSuccess(alertCtx);
          observeStall(alertCtx, { session: null, stalled: false, tmux });
        });
        if (result.receipt.outcome === "failed_execution" && result.receipt.reason.startsWith(PROVIDER_SIGN_IN_FAILURE_PREFIX)) {
          // A dead login is not a defect in the work: it spends no failed-Run
          // budget (so it cannot pause the Project or open a Decision) and is
          // surfaced as a durable launch blocker instead (Issue #1155). The
          // preflight cannot see an unrefreshable credential, so the blocker
          // also holds this Project's launches for SIGN_IN_FAILURE_HOLD_MS.
          const holdEnd = new Date(now.getTime() + SIGN_IN_FAILURE_HOLD_MS);
          recordLaunchBlocker(db, {
            projectSlug: project.slug,
            code: PROVIDER_SIGN_IN_FAILED_CODE,
            reason: providerSignInFailureBlockerReason({ sessionId: lease.id, provider: lease.provider, at: now, holdEnd, receiptReason: result.receipt.reason }),
            actionKey: `${project.slug}/${lease.action_id}`,
            at: now
          });
          log(`Provider sign-in failure for ${project.slug} (Session ${lease.id}, ${lease.provider}); not counted against the failed-Run budget. Launches held until ${holdEnd.toISOString()}.`);
        } else if (result.receipt.outcome === "failed_execution" || result.receipt.outcome === "missing_evidence") {
          const budget = recordFailedRun(db, project.slug, { reason: `Session ${lease.id}: ${result.receipt.reason}`, actionKey: `${project.slug}/${lease.action_id}` });
          if (budget.paused) log(`Paused ${project.slug}: failed-Run budget exceeded (${budget.failedRuns}); Decision ${budget.decisionId} opened.`);
        }
      } else if (!lease) {
        safelyRaiseRedAlerts(log, "stall clear", () => {
          observeStall(alertCtx, { session: null, stalled: false, tmux });
          observeReconcileSuccess(alertCtx);
        });
        // A draft PR an operator-launched Session's exit could not open is
        // retried here, bounded (Decision 0096); never throws into the tick.
        try {
          retryOperatorLaunchPublications({ db, workspace, repoRoot, now, log }, options.handoff?.preserve ?? {});
        } catch (error) {
          log(`Operator launch draft PR retry failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
        }
        // A failed PR whose review repair now has its own PR is closed with a
        // pointer to it, under the review step's own authority; never throws.
        try {
          closeSupersededPullRequests(db, { repoRoot, projectSlug: project.slug, now, runCommand: options.review?.runCommand, log });
        } catch (error) {
          log(`Closing superseded review-repair PRs failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const recovery = recoverTerminalHandoff(db, workspace, repoRoot, project.slug, now, options.handoff?.preserve ?? {}, integrateDepsWithGitHub(options), log,
          { deps: { ...(options.handoff?.preserve?.remote ? { remote: options.handoff.preserve.remote } : {}), ...options.review }, heartbeat: options.heartbeat, clock });
        handoff = recovery?.handoff ?? null;
        handoffSessionId = recovery?.sessionId ?? null;
        handoffHead = recovery?.head ?? null;
        terminalRefusal = recovery?.refusal ?? null;
        handoffReview = recovery?.review;
        handoffSession = recovery?.session;
      }
    } catch (error) {
      log(`Reconciliation failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
      safelyRaiseRedAlerts(log, "reconcile", () => observeReconcileFailure(alertCtx, { session: alertLease, error }));
    }

    let launch: ManagedProductionLaunchAttempt | null = null;
    const gate: { actionKey: string | null } = { actionKey: null };
    // Re-read the policy: the tick can block for minutes between the scheduling
    // pass and this Project's launch decision, so a grant narrowed mid-tick
    // must take effect here rather than being frozen at the tick's start.
    const launchInScope = projectInActiveScope(db, project.slug);
    const mayLaunch = active && launchInScope;
    if (active && !launchInScope) {
      // Outside the standing grant: no preview, no admission, no refusal line.
      // Nothing is resolved or spawned for it here; the reconciliation above
      // has already done the only work an out-of-scope Project is owed.
      launch = {
        attempted: false,
        outcome: "skipped",
        reason: "Project is outside the standing production policy scope; production does not launch here.",
        actionKey: null
      };
    } else if (mayLaunch && handoff !== null && handoffIntegrated(handoff)) {
      // The candidate is preserved and its exact branch is now on the governed
      // base branch, carrying the completion and pointer settlement. Admit the
      // next eligible Action in this same tick -- no operator command, no
      // one-tick wait.
      launch = attemptProjectLaunch(db, { workspace, repoRoot, projectSlug: project.slug, options, tmux, now, log, gate });
    } else if (mayLaunch && handoff === null && reconciled.length === 0) {
      launch = attemptProjectLaunch(db, { workspace, repoRoot, projectSlug: project.slug, options, tmux, now, log, gate });
    } else if (mayLaunch && handoff !== null && reconciled.length === 0 && handoffSession && handoffReview?.kind === "blocked"
      && ((handoffReview.code === "independent_verdict_failed" && handoffReview.failedRole)
        || (handoffReview.code === "required_checks_failed" && handoffReview.checkFailure))) {
      // A reviewer's real non-pass judgment of the exact settled head, or red
      // required checks on it: the review repair loop
      // (src/production/reviewRepair.ts) returns the PR to draft with its
      // findings and launches one bounded repair Session, or stops once. Red
      // checks are repaired only when attributed to the candidate's own change.
      launch = attemptReviewRepairLaunch(db, { workspace, repoRoot, projectSlug: project.slug, session: handoffSession, options, tmux, now, log,
        checkFailure: handoffReview.code === "required_checks_failed" ? handoffReview.checkFailure : undefined });
    } else if (mayLaunch) {
      const refusal = handoff?.integration.kind === "refused" ? handoff.integration : null;
      // Logged once per (Session, head, reason), not on every ~3 s tick: the
      // identical line looped for hours in rehearsal run 4 (Issue #981).
      if (refusal?.operatorMergeCommand) {
        let newEpisode = true;
        try {
          newEpisode = recordIntegrationRefusalLogIfNew(db, project.slug, [handoffSessionId ?? "", handoffHead ?? "", refusal.reason].join("\n"), now);
        } catch (error) {
          // Bookkeeping must never stop the tick: fall back to logging the line.
          log(`Integration-refusal log bookkeeping failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (newEpisode) log(`Candidate for ${project.slug} preserved but not integrated: ${refusal.reason} Operator merge: ${refusal.operatorMergeCommand}`);
      }
      // A Session for this repository was just reconciled this very tick. Its
      // outcome (e.g. `accepted_completion`) may have settled onto the
      // candidate's own branch, which has not been merged into this checked-in
      // repository yet -- `resolveProjectTransition` would still see the same
      // pre-completion pointer and relaunch the identical Action a second
      // time. Give the operator (or bound CI) a full tick to land that merge
      // before this repository is considered for another launch; the next
      // tick's base-branch-advance detection picks it up as soon as it lands.
      // A refused terminal handoff of an out-of-scope pointer Action recurs
      // every tick and holds an Action-scoped run (Issue #1512): name it.
      const held = handoff !== null && reconciled.length === 0 ? outOfScopePointerHold(db, { repoRoot, projectSlug: project.slug, now, log }) : null;
      launch = { attempted: false, outcome: "skipped", reason: held ?? launchSkipReason({ reconciledCount: reconciled.length, refusal, sessionId: handoffSessionId }), actionKey: null };
    }
    // An integration-refusal episode ends whenever this tick has no refused
    // handoff to log (it integrated, nothing is pending, or production is Off
    // or out of scope), so a later recurrence is logged once again.
    // A terminal guard's refusal is escalated once while production is On for
    // this Project, and cleared when the candidate passes its guards or
    // integrates, when nothing is pending, or when production is Off.
    try {
      if (!(mayLaunch && handoff?.integration.kind === "refused" && handoff.integration.operatorMergeCommand)) {
        clearIntegrationRefusalLog(db, project.slug);
      }
      // A gated review repair row whose candidate has since merged is closed (Issue #1632).
      try { releaseMergedReviewRepairs(db, { repoRoot, projectSlug: project.slug, baseBranch: resolveBaseBranch(repoRoot), now, log, runCommand: options.review?.runCommand }); } catch { /* retried next tick */ }
      // An operator-gate escalation lasts exactly as long as the gate holds a launch.
      clearProjectEscalationsOfKind(db, OPERATOR_GATE_ESCALATION, project.slug, gate.actionKey);
      if (mayLaunch && terminalRefusal) {
        recordTerminalCandidateEscalation(db, { facts: terminalRefusal, repoRoot, now, log });
        clearProjectTerminalCandidateEscalations(db, project.slug, `${terminalRefusal.session.project_slug}/${terminalRefusal.session.action_id}`);
      } else {
        clearProjectTerminalCandidateEscalations(db, project.slug, null);
      }
    } catch (error) {
      log(`Integration-refusal bookkeeping failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }

    safelyRaiseRedAlerts(log, "admission", () => observeAdmission(alertCtx, launch));
    safelyRaiseRedAlerts(log, "repair budget", () => observeRepairBudget(alertCtx, launch));
    options.heartbeat?.();
    projects.push({ projectSlug: project.slug, repositoryRoot: repoRoot, baseBranchAdvance, askSurfacing, reconciled, handoff, launch });
  }

  return { policyActive: active, scheduling, schedulingError, projects };
}

/** Development-attempt refusals that only an operator can resolve: never retried in a loop, never a repair failure. */
const ATTEMPT_LINEAGE_ESCALATIONS = new Set(["attempt_limit_exhausted", "attempt_retry_not_authorized"]);

/**
 * One remedy per lineage state. No command resets attempt lineage today, and
 * none is invented here: the only ways forward are the ones named.
 */
export function developmentLineageRemedy(code: string, details: Record<string, unknown> | undefined): string {
  if (code === "attempt_limit_exhausted") {
    return `Every bounded development attempt (${String(details?.limit ?? 3)}) for this exact Action input failed. Repair the cause; `
      + "no command resets attempt lineage today, so the only path is a governed amendment of the Action (an Agent Ask), which gives it a new input revision.";
  }
  if (details?.status === "passed") {
    return "The development attempt for this exact Action input already passed: its accepted candidate waits for current independent code review "
      + "and QA verdicts (`arcadia qa code-review` and `arcadia qa pr`) or an operator merge (see that candidate's awaiting_independent_verdicts escalation and its `git merge --ff-only` command). "
      + "Redoing the work instead requires a governed amendment of the Action.";
  }
  return `The development attempt for this exact Action input is ${String(details?.status ?? "finished")} and no retry is authorized; `
    + "the only path is a governed amendment of the Action (an Agent Ask).";
}

/** A review repair launch withheld by a guard (sign-in hold, repair budget); never a launch failure. */
class RepairLaunchHeld extends Error {}

/** The review-repair ping text: the first line of the escalation, cut to the operator ping bound. */
export function reviewRepairPingMessage(actionKey: string, kind: string, message: string): string {
  return boundedPingMessage(`Production stopped the review repair loop for ${actionKey} (${kind}): ${message.split("\n")[0]}`);
}

/** The newest PR URL production recorded for an Action's candidate (repair row, then review step), or null. */
function candidatePullRequestUrl(db: Database.Database, actionKey: string): string | null {
  for (const sql of [
    "SELECT pull_request_url AS url FROM production_review_repairs WHERE action_key = ? AND pull_request_url IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
    "SELECT pull_request_url AS url FROM production_review_steps WHERE action_key = ? ORDER BY updated_at DESC LIMIT 1"
  ]) {
    try {
      const row = db.prepare(sql).get(actionKey) as { url: string | null } | undefined;
      if (row?.url) return row.url;
    } catch { /* table not created yet */ }
  }
  return null;
}

/** One deduped review-repair escalation, logged and pinged once per kind. */
function escalateReviewRepair(db: Database.Database, input: { actionKey: string; kind: string; message: string; remedy: string; now: Date; log?: (message: string) => void }): void {
  const { actionKey, kind, message } = input;
  const previous = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as { kind: string } | undefined;
  const newlyDetected = recordOperatorEscalation(db, { actionKey, kind, message, remedy: input.remedy, now: input.now });
  if (newlyDetected || previous?.kind !== kind) {
    input.log?.(`Escalated ${actionKey} to the operator (${kind}): ${message.split("\n")[0]}`);
    try {
      queueOperatorPing(db, { message: reviewRepairPingMessage(actionKey, kind, message), kind: "attention", link: candidatePullRequestUrl(db, actionKey), agent: "production-tick", now: input.now });
    } catch (error) {
      input.log?.(`Could not queue the review-repair ping for ${actionKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * The review repair loop's one step for a recovered candidate whose exact
 * settled head carries a reviewer's real failed verdict
 * (src/production/reviewRepair.ts). Launches only through the guarded
 * standing-policy launch, like any other admission; a conflict (capacity, Off,
 * a moved pointer) is a wait retried next tick, logged once per reason.
 */
function attemptReviewRepairLaunch(
  db: Database.Database,
  input: {
    workspace: string;
    repoRoot: string;
    projectSlug: string;
    session: AgentSession;
    options: ManagedProductionTickOptions;
    tmux: TmuxAdapter;
    now: Date;
    log: (message: string) => void;
    /** Red required checks on the candidate's head: the trigger instead of a failed verdict. */
    checkFailure?: RequiredChecksFailure;
  }
): ManagedProductionLaunchAttempt {
  const actionKey = `${input.session.project_slug}/${input.session.action_id}`;
  const paused = getSchedulingProject(db, input.projectSlug).pausedReason;
  if (paused) return { attempted: false, outcome: "skipped", reason: `Scheduling is paused: ${paused}`, actionKey };
  // The same launch guards attemptProjectLaunch applies, checked only at the
  // launch itself (the failed PR is drafted and commented on first, whatever
  // they say): a provider sign-in hold, and the per-Action repair budget a
  // repeating non-conflict launch failure spends.
  const held: { outcome: ManagedProductionLaunchAttempt["outcome"] | null; reason: string } = { outcome: null, reason: "" };
  /** The launch guards, as a reason that withholds the launch (recorded on `held`), or null. */
  const launchGuard = (): string | null => {
    const signInHold = activeSignInFailureHold(db, input.projectSlug, input.now);
    if (signInHold) {
      const reason = `Held until ${signInHold.until.toISOString()} after a provider sign-in failure: a repair Session launched now would die on the same dead login. Sign in again on this worker host.`;
      if (recordLaunchRefusalIfNew(db, actionKey, `${PROVIDER_SIGN_IN_FAILED_CODE}:${signInHold.observedAt}`, reason, input.now)) {
        input.log(`Review repair launch held for ${actionKey} [${PROVIDER_SIGN_IN_FAILED_CODE}]: ${reason}`);
      }
      held.outcome = "skipped"; held.reason = reason;
      return reason;
    }
    const attempts = getRepairAttempts(db, actionKey);
    if (attempts.attempts >= PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) {
      const reason = recordRepairBudgetExhaustedEscalation(db, { actionKey, attempts: attempts.attempts, lastError: attempts.lastError, now: input.now, log: input.log });
      held.outcome = "repair_budget_exhausted"; held.reason = reason;
      return reason;
    }
    return null;
  };
  try {
    const step = attemptReviewRepair({
      db, repoRoot: input.repoRoot, session: input.session, now: input.now, log: input.log,
      runCommand: input.options.review?.runCommand,
      checkFailure: input.checkFailure,
      escalate: (kind, message, remedy) => escalateReviewRepair(db, { actionKey, kind, message, remedy, now: input.now, log: input.log }),
      // Asked before the pre-launch PR read, and again inside the launch.
      canLaunch: launchGuard,
      launch: (repair) => {
        const withheld = launchGuard();
        if (withheld) throw new RepairLaunchHeld(withheld);
        return launchGuardedHostSession({
          db,
          workspace: input.workspace,
          repoRoot: input.repoRoot,
          projectSlug: input.projectSlug,
          requestId: `worker-tick-repair-${actionKey.replaceAll("/", "-")}-${input.now.getTime()}`,
          standingPolicy: true,
          repair,
          profiles: input.options.profiles,
          adapters: input.options.adapters,
          now: input.now,
          tmux: input.tmux,
          capacityObservation: input.options.capacityObservation,
          agentWorktreeRoot: input.options.agentWorktreeRoot,
          providerSignIn: input.options.providerSignIn,
          workerCapability: input.options.workerCapability,
          onProviderSignInConfirmed: () => clearLaunchBlocker(db, input.projectSlug)
        });
      }
    });
    if (step.kind === "launched") {
      resetRepairAttempts(db, actionKey);
      clearLaunchBlocker(db, input.projectSlug);
      clearOperatorEscalation(db, actionKey);
      clearLaunchRefusal(db, actionKey);
      return { attempted: true, outcome: "launched", reason: step.reason, actionKey };
    }
    if (held.outcome !== null) return { attempted: false, outcome: held.outcome, reason: held.reason, actionKey };
    return { attempted: false, outcome: "skipped", reason: step.reason, actionKey };
  } catch (error) {
    if (error instanceof RepairLaunchHeld && held.outcome !== null) {
      return { attempted: false, outcome: held.outcome, reason: held.reason, actionKey };
    }
    const code = error instanceof ArcadiaError && typeof error.details?.code === "string" ? error.details.code : null;
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ArcadiaError && error.details?.conflict) {
      const line = `Review repair launch refused for ${actionKey}${code ? ` [${code}]` : ""}: ${message}`;
      if (recordLaunchRefusalIfNew(db, actionKey, `review-repair:${code ?? message}`, line, input.now)) input.log(line);
      return { attempted: true, outcome: "refused", reason: message, actionKey };
    }
    // A real defect in preparing or spawning the repair (tmux, the draft
    // retirement, a worktree error): counted against the finite repair budget
    // exactly like attemptProjectLaunch's, so it cannot cycle every tick.
    const failure = formatLaunchFailure(error);
    recordRepairAttempt(db, actionKey, failure, input.now);
    recordFailedRun(db, input.projectSlug, { reason: `Review repair launch failed for ${actionKey}: ${failure}`, actionKey });
    input.log(`Review repair launch attempt failed for ${actionKey}: ${failure}`);
    const attemptsAfter = getRepairAttempts(db, actionKey);
    if (attemptsAfter.attempts >= PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) {
      recordRepairBudgetExhaustedEscalation(db, { actionKey, attempts: attemptsAfter.attempts, lastError: attemptsAfter.lastError, now: input.now, log: input.log });
    }
    return { attempted: true, outcome: "failed", reason: failure, actionKey };
  }
}

function attemptProjectLaunch(
  db: Database.Database,
  input: {
    workspace: string;
    repoRoot: string;
    projectSlug: string;
    options: ManagedProductionTickOptions;
    tmux: TmuxAdapter;
    now: Date;
    log: (message: string) => void;
    /** Set to the Action whose launch an operator gate held this tick, if any. */
    gate?: { actionKey: string | null };
  }
): ManagedProductionLaunchAttempt {
  const lease = getRepositoryLease(db, input.repoRoot);
  if (lease) {
    return { attempted: false, outcome: "skipped", reason: `Repository lease held by Session ${lease.id}.`, actionKey: null };
  }
  const paused = getSchedulingProject(db, input.projectSlug).pausedReason;
  if (paused) {
    return { attempted: false, outcome: "skipped", reason: `Scheduling is paused: ${paused}`, actionKey: null };
  }

  let transition = resolveProjectTransition({ repoRoot: input.repoRoot, projectSlug: input.projectSlug, db, tmux: input.tmux, supersededCompletionAskIds: resumedSessionSupersededAskIds(db, input.repoRoot, input.projectSlug, input.tmux) });
  if (transition.kind === "activate" && transition.activation?.candidate) {
    // Decision 0048: the active Plan cannot continue, but the explicit queue
    // names exactly one approved Plan and Action. Activate it in this same tick
    // and re-resolve, so production continues without an operator round trip.
    // `git` throws on a repository with no commits yet; keep it inside the try
    // so one Project's Git failure cannot stop the whole tick.
    try {
      const requestId = `worker-activate-${input.projectSlug}-${git(input.repoRoot, ["rev-parse", "HEAD"]).trim()}`;
      activateNextPlan(db, { repoRoot: input.repoRoot, projectSlug: input.projectSlug, requestId, apply: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A held successor is not a failure: the per-tick scope-drift observer already holds one
      // named alert for it, so this tick stays quiet and skips (no log line, no retry storm).
      if ((error as { details?: { code?: string } }).details?.code === SCOPE_HELD_CODE) {
        const heldPlan = (error as { details?: { activePlan?: string } }).details?.activePlan;
        if (heldPlan) {
          safelyRaiseRedAlerts(input.log, "scope successor held", () =>
            raiseScopeSuccessorHeld({ db, workspace: input.workspace, projectSlug: input.projectSlug, now: input.now }, { planKey: heldPlan }));
        }
        return { attempted: false, outcome: "skipped", reason: message, actionKey: null };
      }
      input.log(`Plan activation failed for ${input.projectSlug}: ${message}`);
      return { attempted: true, outcome: "failed", reason: `Plan activation failed: ${message}`, actionKey: null };
    }
    transition = resolveProjectTransition({ repoRoot: input.repoRoot, projectSlug: input.projectSlug, db, tmux: input.tmux, supersededCompletionAskIds: resumedSessionSupersededAskIds(db, input.repoRoot, input.projectSlug, input.tmux) });
  }
  // Issue #1512: an Action-scoped Active policy selects only Actions it names.
  // The scheduling pass already points at the first ready in-scope queued
  // Action; when it could not (no in-scope Action is ready, or the pointer
  // move was held), the pointer still names an out-of-scope Action, which is
  // never auto-settled, packet-prepared, launched or escalated here. Only the
  // launch-path packet escalations this path itself raises are withdrawn for
  // it; operator-actionable ones (repair budget, operator gate, environment
  // wall, terminal candidate) stay visible. Terminal recovery and handoff of
  // existing work ran before this and are untouched by the gate.
  const selected = transition.dispatch.context;
  if (selected) {
    const inScope = activeActionScopeGate(db, input.projectSlug, selected.activePlan);
    const selectedKey = `${input.projectSlug}/${selected.action.id}`;
    if (inScope && !inScope(selectedKey)) {
      // Escalations for any other Action are stale exactly as on the ordinary
      // path (the pointer names this one); for this Action only the launch-path
      // packet kinds are withdrawn.
      pruneStaleOperatorEscalations(db, input.projectSlug, selectedKey);
      const kinds = [...LAUNCH_PATH_PACKET_ESCALATION_KINDS];
      db.prepare(`DELETE FROM production_operator_escalations WHERE action_key = ? AND kind IN (${kinds.map(() => "?").join(", ")})`)
        .run(selectedKey, ...kinds);
      // The tick clears operator-gate escalations for every Action but the one
      // named here; keep an existing one for this Action rather than drop it.
      const gateHeld = db.prepare("SELECT 1 FROM production_operator_escalations WHERE action_key = ? AND kind = ?")
        .get(selectedKey, OPERATOR_GATE_ESCALATION);
      if (gateHeld && input.gate) input.gate.actionKey = selectedKey;
      const held = scopePointerHold(db, { repoRoot: input.repoRoot, projectSlug: input.projectSlug, actionKey: selectedKey, actionId: selected.action.id, now: input.now, log: input.log });
      if (!held) announceScopeComplete(db, { repoRoot: input.repoRoot, projectSlug: input.projectSlug, planSlug: selected.activePlan, now: input.now, log: input.log });
      return {
        attempted: false,
        outcome: "skipped",
        reason: held
          ?? `The pointer names ${selectedKey}, which is outside the Active production scope; production waits for an in-scope Action to become current.`,
        actionKey: null
      };
    }
  }
  // Operator decision 2026-10-21: an Action held by its operator escalation is
  // never relaunched or re-escalated here (a settlement of another Action can
  // leave the pointer on it); the scheduler moves the pointer to the next
  // independent in-scope Action on its next pass.
  if (selected) {
    const held = operatorHeldEscalation(db, `${input.projectSlug}/${selected.action.id}`);
    if (held) {
      return { attempted: false, outcome: "skipped", reason: `${input.projectSlug}/${selected.action.id} is held by its operator escalation (${held.kind}); production does not relaunch it.`, actionKey: null };
    }
  }
  if (transition.kind !== "launch" || !transition.dispatch.context) {
    // `dispatch` is resolved before the lease/competing-run check that
    // produces "wait"/"reconcile" (see `resolveProjectTransition`), so its
    // context still names the selected Action even when this tick cannot
    // launch it this instant. Preserve that Action's own escalation, if any,
    // rather than treating a transient wait as though the pointer moved on;
    // only a transition with no resolvable Action at all (a Plan boundary)
    // has nothing to preserve.
    const currentActionKey = transition.dispatch.context ? `${input.projectSlug}/${transition.dispatch.context.action.id}` : null;
    pruneStaleOperatorEscalations(db, input.projectSlug, currentActionKey);
    if (currentActionKey) {
      const unresolvedId = unresolvedDependencyIdFrom(transition.dispatch.blockers);
      if (unresolvedId) {
        recordDependencyUnresolvedSighting(db, { actionKey: currentActionKey, unresolvedId, now: input.now, log: input.log });
      } else {
        clearDependencyUnresolvedSighting(db, currentActionKey);
      }
    }
    // A pending operator item gating an in-scope Action is escalated once,
    // instead of every tick skipping the launch with no trace (Issue #997).
    const gateItem = transition.kind === "decision" ? transition.operatorGate?.blocking[0] : undefined;
    const context = transition.dispatch.context;
    if (currentActionKey && gateItem && context && actionInActiveScope(db, input.projectSlug, context.activePlan, context.action.id)) {
      if (input.gate) input.gate.actionKey = currentActionKey;
      try {
        recordOperatorGateEscalation(db, { actionKey: currentActionKey, item: gateItem, repoRoot: input.repoRoot,
          acceptanceCriteria: context.action.acceptanceCriteria, now: input.now, log: input.log });
      } catch (error) {
        input.log(`Operator-gate bookkeeping failed for ${currentActionKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { attempted: false, outcome: "skipped", reason: transition.reason, actionKey: null };
  }

  const actionKey = `${input.projectSlug}/${transition.dispatch.context.action.id}`;
  pruneStaleOperatorEscalations(db, input.projectSlug, actionKey);
  // Reaching a "launch" transition means every depends_on entry resolved and
  // finished; drop any dependency-unresolved bookkeeping left from an earlier
  // tick rather than waiting for it to be pruned as some other Action's.
  clearDependencyUnresolvedSighting(db, actionKey);

  // Hold after a Session died on a provider sign-in failure (Issue #1155). The
  // launch preflight cannot see an unrefreshable credential, so the durable
  // blocker recorded at reconciliation is also this hold: nothing is
  // previewed, reserved, counted as a repair attempt or cleared until it
  // lapses. This sits before auto-settle, whose success clears the Project's
  // launch blocker and would otherwise wipe the hold row. Past the hold the
  // launch is attempted again; its success (or a confirmed sign-in) clears the
  // blocker, and another sign-in failure re-records it with a fresh hold.
  const signInHold = activeSignInFailureHold(db, input.projectSlug, input.now);
  if (signInHold) {
    const reason = `Held until ${signInHold.until.toISOString()} after a provider sign-in failure: a Session launched now would die on the same dead login. Sign in again on this worker host.`;
    if (recordLaunchRefusalIfNew(db, actionKey, `${PROVIDER_SIGN_IN_FAILED_CODE}:${signInHold.observedAt}`, reason, input.now)) {
      input.log(`Launch held for ${actionKey} [${PROVIDER_SIGN_IN_FAILED_CODE}]: ${reason}`);
    }
    return { attempted: false, outcome: "skipped", reason, actionKey };
  }

  // A drafted `complete` Agent Ask already covering this Action's evidence
  // means a previous session finished the work and either ended, or was
  // interrupted, before running the final settle step. Settling it here is
  // deterministic and costs no coding-agent process; launching a fresh
  // Session for already-done work would cost a full tick's capacity for
  // nothing. Any reason it is not clean (no such draft, incomplete evidence,
  // a genuinely divergent candidate_revision, an unresolved review Decision)
  // falls through to the ordinary launch attempt below untouched.
  const autoSettle = attemptAutoSettlePendingCompletion(db, {
    repoRoot: input.repoRoot,
    projectSlug: input.projectSlug,
    activePlanSlug: transition.dispatch.context.activePlan,
    action: transition.dispatch.context.action
  });
  if (autoSettle.settled) {
    resetRepairAttempts(db, actionKey);
    clearLaunchBlocker(db, input.projectSlug);
    clearOperatorEscalation(db, actionKey);
    clearLaunchRefusal(db, actionKey);
    input.log(`Auto-settled ${actionKey} from a drafted complete Ask (${autoSettle.askPath}); no Session launched.`);
    return { attempted: false, outcome: "auto_settled", reason: `Settled from a drafted complete Ask. Next: ${autoSettle.nextActionKey ?? "none"}.`, actionKey };
  }

  const attempts = getRepairAttempts(db, actionKey);
  if (attempts.attempts >= PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) {
    const reason = recordRepairBudgetExhaustedEscalation(db, {
      actionKey,
      attempts: attempts.attempts,
      lastError: attempts.lastError,
      now: input.now,
      log: input.log
    });
    return {
      attempted: false,
      outcome: "repair_budget_exhausted",
      reason,
      actionKey
    };
  }

  // A `no_validation_commands` escalation is never self-resolving on its
  // own, but the condition it names can change between ticks (an operator
  // running `arcadia project metadata --validation-command`), so re-read the
  // Project's own metadata -- a single cheap query -- rather than either
  // silencing the check forever or repeating the full `launchGuardedHostSession`
  // preview (git plumbing, doc discovery, provider selection) on every tick
  // only to rediscover the identical refusal. Still empty: skip without
  // attempting a launch, preserving the existing escalation untouched. No
  // longer empty: fall through to the ordinary launch attempt below, which
  // clears it on success exactly as any other resolved escalation does.
  const existingEscalation = db
    .prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?")
    .get(actionKey) as { kind: string } | undefined;
  if (existingEscalation?.kind === COMPLETION_VALIDATION_UNAVAILABLE_ESCALATION || existingEscalation?.kind === COMPLETION_REFUSED_REPEATEDLY_ESCALATION) {
    return {
      attempted: false,
      outcome: "skipped",
      reason: `Awaiting operator: ${actionKey} is held (${existingEscalation.kind}); fix what the escalation names, then run \`arcadia production reset-repair-budget\`.`,
      actionKey
    };
  }
  if (existingEscalation?.kind === "no_validation_commands") {
    const project = getProjectBySlug(db, input.projectSlug);
    const metadata = project ? getProjectMetadata(db, project.id) : null;
    if (decodeStringArray(metadata?.validation_commands).length === 0) {
      return {
        attempted: false,
        outcome: "skipped",
        reason: `Awaiting operator: ${input.projectSlug} still declares no validation commands.`,
        actionKey
      };
    }
  }

  // Session capability preflight: a Session that cannot write the workspace,
  // run host validation or preserve its work would only spend tokens against
  // the same wall (the first production run: ~11.1M input tokens, no diff).
  // Refused here, before any Session is prepared; one named blocker, no repair
  // attempt counted because nothing was launched.
  const walls = input.options.workerCapability?.(input.workspace) ?? [];
  if (walls.length > 0) {
    const named = describeEnvironmentWalls(actionKey, walls, "preflight");
    const previous = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as
      | { kind: string }
      | undefined;
    const newlyDetected = recordOperatorEscalation(db, {
      actionKey, kind: ENVIRONMENT_WALL_ESCALATION_KIND, message: named.message, remedy: named.remedy, now: input.now
    });
    if (newlyDetected || previous?.kind !== ENVIRONMENT_WALL_ESCALATION_KIND) {
      input.log(`Escalated ${actionKey} to the operator (${ENVIRONMENT_WALL_ESCALATION_KIND}): ${named.message}`);
    }
    return { attempted: false, outcome: "refused", reason: named.message, actionKey };
  }

  const requestId = `worker-tick-${actionKey.replaceAll("/", "-")}-${input.now.getTime()}`;
  try {
    const result = launchGuardedHostSession({
      db,
      workspace: input.workspace,
      repoRoot: input.repoRoot,
      projectSlug: input.projectSlug,
      requestId,
      standingPolicy: true,
      profiles: input.options.profiles,
      adapters: input.options.adapters,
      now: input.now,
      tmux: input.tmux,
      capacityObservation: input.options.capacityObservation,
      agentWorktreeRoot: input.options.agentWorktreeRoot,
      providerSignIn: input.options.providerSignIn,
      // The launch re-runs the same preflight with the selected profile's
      // sandbox, which this tick's profile-less preflight cannot see.
      workerCapability: input.options.workerCapability,
      // Clear a stale sign-in blocker the moment sign-in is confirmed, not
      // only on full launch success: a later, unrelated launch failure (a
      // repair-worthy defect, counted against the budget) must not leave
      // `arcadia production status` still telling the operator to sign in.
      onProviderSignInConfirmed: () => clearLaunchBlocker(db, input.projectSlug)
    });
    if (!getSessionContinuation(db, result.session)) resetRepairAttempts(db, actionKey);
    clearLaunchBlocker(db, input.projectSlug);
    clearOperatorEscalation(db, actionKey);
    clearLaunchRefusal(db, actionKey);
    input.log(`${result.reused ? "Reused" : "Launched"} Session ${result.session.id} for ${actionKey} under the standing production policy.`);
    return {
      attempted: true,
      outcome: result.reused ? "reused" : "launched",
      reason: result.reused ? "An already-durable Session satisfied this tick's launch." : "Launched under the standing production policy grant.",
      actionKey
    };
  } catch (error) {
    // A refusal carries `details.conflict`: capacity/Off/stale-preview/lease
    // races are expected wait states this tick will simply retry later, never
    // a repair-worthy failure. Anything else is a real defect in preparing or
    // spawning the Session and counts against the finite repair budget.
    if (error instanceof ArcadiaError && error.details?.conflict) {
      const rawCode = typeof error.details?.code === "string" ? error.details.code : null;
      // A signed-out provider is a durable Project launch blocker -- unlike
      // capacity/Off/stale-preview/lease conflicts, it will not resolve on its
      // own the next time this tick runs, so it is worth surfacing in
      // `arcadia production status` rather than only this log line. Any other
      // conflict code supersedes and clears a stale sign-in blocker.
      // A missing provider binary or headless permission posture
      // (`launchPreflight.ts`) is durable for the same reason.
      // Decision 0130: a stale/unknown Claude reading whose last read-only
      // refresh failed on the credential is the operator's to fix (sign in
      // again); name it durably rather than as a generic capacity wait.
      const claudeUsageRefreshState = rawCode === "capacity_refused" || rawCode === "capacity_unproven"
        ? (input.options.claudeUsageRefreshState ?? (() => (process.env.VITEST ? null : readClaudeUsageRefreshState())))()
        : null;
      const claudeUsageUnreadable = claudeUsageRefreshState === "no_credentials" || claudeUsageRefreshState === "unauthorized";
      const claudeUsageRemedy = claudeUsageUnreadable
        ? `Claude usage could not be read (${describeClaudeUsageRefreshState(claudeUsageRefreshState)}) The worker asks the Claude CLI to refresh its own sign-in at most every 30 minutes; if that keeps failing, sign in to Claude Code again on this host.`
        : null;
      if (rawCode === "provider_not_signed_in" || rawCode === "provider_binary_missing" || rawCode === "permission_posture_missing") {
        recordLaunchBlocker(db, { projectSlug: input.projectSlug, code: rawCode, reason: error.message, actionKey, at: input.now });
      } else if (claudeUsageRemedy) {
        recordLaunchBlocker(db, { projectSlug: input.projectSlug, code: rawCode!, reason: `${error.message} ${claudeUsageRemedy}`, actionKey, at: input.now });
      } else {
        clearLaunchBlocker(db, input.projectSlug);
      }
      const code = rawCode ? ` [${rawCode}]` : "";
      // `preview.prerequisites` (buildLaunchPreview) names exactly what is
      // unready -- e.g. a policy-permitted-provider mismatch -- while
      // `error.message` alone is the generic "The previewed Action is not
      // ready to launch." Prefer the named list; fall back to the message
      // for conflict codes that carry no prerequisites array (capacity, Off,
      // stale preview, lease).
      const prerequisites = Array.isArray(error.details?.prerequisites)
        ? (error.details.prerequisites as unknown[]).filter((entry): entry is string => typeof entry === "string")
        : null;
      const detail = prerequisites && prerequisites.length > 0 ? prerequisites.join("; ") : error.message;
      const refusalLine = `Launch refused for ${actionKey}${code}: ${detail}`;
      // The dedup identity is the conflict code plus its named prerequisites
      // (stable across ticks); with no prerequisites array, the code alone
      // stands in for the whole conflict -- excluding `error.message`, whose
      // `admission_expired` text embeds a fresh expiry timestamp every tick
      // and would otherwise never match its own prior episode.
      const dedupeKey = prerequisites && prerequisites.length > 0 ? `${rawCode ?? ""}:${prerequisites.join("; ")}` : rawCode ?? refusalLine;
      if (recordLaunchRefusalIfNew(db, actionKey, dedupeKey, refusalLine, input.now)) {
        input.log(refusalLine);
        // A signed-out or expired provider login is the operator's to fix on the
        // host: ping once per refusal episode (the refusal log dedupes the episode,
        // the ping queue dedupes the message), naming the provider and remedy.
        if (rawCode === "provider_not_signed_in" || claudeUsageRemedy) {
          try {
            queueOperatorPing(db, {
              // Issue #1616: the full capacity explanation runs past the ping
              // limit and the ping was never queued; lead with the remedy.
              message: boundedPingMessage(claudeUsageRemedy
                ? `Production cannot launch ${actionKey}: ${claudeUsageRemedy} ${error.message}`
                : `Production cannot launch ${actionKey}: ${error.message}`),
              kind: "attention",
              agent: "production-tick",
              now: input.now
            });
          } catch (pingError) {
            input.log(`Could not queue the sign-in ping for ${actionKey}: ${pingError instanceof Error ? pingError.message : String(pingError)}`);
          }
        }
      }
      const packetLifecycleKind = typeof error.details?.packetLifecycleKind === "string" ? error.details.packetLifecycleKind : null;
      if (packetLifecycleKind === "build_packet_approval_pending") {
        const approved = attemptDelegatedPacketApproval(db, {
          actionKey,
          projectSlug: input.projectSlug,
          planSlug: transition.dispatch.context?.activePlan ?? null,
          decisionId: typeof error.details?.packetLifecycleDecisionId === "string" ? error.details.packetLifecycleDecisionId : null,
          prerequisites,
          now: input.now,
          log: input.log
        });
        if (approved) {
          clearOperatorEscalation(db, actionKey);
          return {
            attempted: true,
            outcome: "refused",
            reason: `Approved the build packet under the standing policy's packet_approval delegation (Decision ${approved}); it launches on the next tick.`,
            actionKey
          };
        }
      }
      // A missing validation command is never self-resolving, and automatic
      // planning resolution would only rediscover that the same way
      // (`createCodexPacket` now refuses build-packet preparation on the
      // identical condition) -- so this takes precedence over attempting it,
      // rather than wasting a tick's `arcadia work plan` attempt on a
      // refusal that is already fully diagnosed.
      const resolvedLifecycleKind = rawCode === "no_validation_commands"
        ? null
        : packetLifecycleKind === "planning_required"
          ? attemptAutomaticPlanningResolution(
              db,
              { workspace: input.workspace, profiles: input.options.profiles },
              transition,
              actionKey,
              input.log
            ) ?? packetLifecycleKind
          : packetLifecycleKind;
      // A Project with no declared validation commands is never
      // self-resolving either -- unlike a `planning_required` packet, which
      // this same tick can prepare, nothing but an operator editing Project
      // metadata clears it, so it escalates the same way rather than
      // retrying the same refusal forever (the fate `planning_required` was
      // given `NON_SELF_RESOLVING_PACKET_LIFECYCLE_KINDS` to avoid).
      // A launch-side capability wall (assertWorkerCapability, e.g. a read-only
      // profile sandbox the tick preflight cannot see) is one named blocker, not
      // a silent per-tick refusal.
      const environmentWall = rawCode === "session_environment_wall";
      const escalationKind = environmentWall
        ? ENVIRONMENT_WALL_ESCALATION_KIND
        : rawCode === "no_validation_commands" || (rawCode !== null && ATTEMPT_LINEAGE_ESCALATIONS.has(rawCode))
        ? rawCode
        : resolvedLifecycleKind === PLANNER_ATTEMPTS_EXHAUSTED
          ? PLANNER_ATTEMPTS_EXHAUSTED
          : resolvedLifecycleKind && NON_SELF_RESOLVING_PACKET_LIFECYCLE_KINDS.has(resolvedLifecycleKind)
            ? resolvedLifecycleKind
            : null;
      if (escalationKind) {
        const remedy = environmentWall
          ? typeof error.details?.remedy === "string" ? error.details.remedy : null
          : rawCode !== null && ATTEMPT_LINEAGE_ESCALATIONS.has(rawCode)
          ? developmentLineageRemedy(rawCode, error.details)
          : escalationKind === PLANNER_ATTEMPTS_EXHAUSTED
          ? PLANNER_ATTEMPTS_EXHAUSTED_REMEDY
          : rawCode === "no_validation_commands"
          ? prerequisites?.find((entry) => entry.startsWith("no validation commands")) ?? null
          : typeof error.details?.packetLifecycleRemedy === "string"
            ? error.details.packetLifecycleRemedy
            : null;
        const lapsed = escalationKind === "build_packet_approval_pending" ? lapsedPacketApprovalNote(db, input.now) : null;
        const shownRemedy = lapsed ? `${lapsed} ${remedy ?? ""}`.trimEnd() : remedy;
        const newlyDetected = recordOperatorEscalation(db, {
          actionKey,
          kind: escalationKind,
          message: error.message,
          remedy: shownRemedy,
          now: input.now
        });
        if (newlyDetected) {
          input.log(`Escalated ${actionKey} to the operator (${escalationKind}): ${shownRemedy ?? error.message}`);
        }
      } else if (!escalateStalledPlanningGate(db, {
        actionKey,
        projectSlug: input.projectSlug,
        workItemId: transition.dispatch.context
          ? getWorkItemByDocRef(db, `plan/${transition.dispatch.context.activePlan}#${transition.dispatch.context.action.id}`)?.id ?? null
          : null,
        lifecycleKind: resolvedLifecycleKind,
        now: input.now,
        log: input.log
      })) {
        clearOperatorEscalation(db, actionKey);
      }
      return { attempted: true, outcome: "refused", reason: error.message, actionKey };
    }
    const message = formatLaunchFailure(error);
    recordRepairAttempt(db, actionKey, message, input.now);
    recordFailedRun(db, input.projectSlug, { reason: `Launch failed for ${actionKey}: ${message}`, actionKey });
    input.log(`Launch attempt failed for ${actionKey}: ${message}`);
    // Record the exhaustion escalation the instant this attempt pushes the
    // count to the limit, not only on a later tick's pre-launch check --
    // otherwise an Action that becomes ineligible for another launch attempt
    // before that check runs (production switched Off, its Project paused, a
    // repository lease) would leave the budget exhausted with no escalation
    // for `production status` to surface (CodeRabbit, PR #708).
    const attemptsAfter = getRepairAttempts(db, actionKey);
    if (attemptsAfter.attempts >= PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) {
      recordRepairBudgetExhaustedEscalation(db, {
        actionKey,
        attempts: attemptsAfter.attempts,
        lastError: attemptsAfter.lastError,
        now: input.now,
        log: input.log
      });
    }
    return { attempted: true, outcome: "failed", reason: message, actionKey };
  }
}

/**
 * What a Session's exit costs and whether it hit an environment wall. Tokens
 * are recorded per attempt next to the Action for every exit. A Session that
 * ended without completing, with no diff and a wall named in its own log, is
 * counted by the repair budget on this first occurrence -- the budget is set
 * to its limit so the pre-launch check never relaunches it -- and raises one
 * named `environment_wall` escalation. Idempotent per Session.
 */
export function recordSessionExitAccounting(
  db: Database.Database,
  input: {
    workspace: string;
    projectSlug: string;
    session: { id: string; action_id: string | null; worktree_path: string; launch_revision?: string | null; base_revision: string | null; provider?: string; model?: string };
    outcome: string;
    candidateRevision: string | null;
    now: Date;
    log: (message: string) => void;
  }
): SessionCapabilityObservation | null {
  if (!input.session.action_id) return null;
  const actionKey = `${input.projectSlug}/${input.session.action_id}`;
  let text: string | null = null;
  try {
    text = readFileSync(sessionLogPath(input.workspace, input.session.id), "utf8");
  } catch { /* an interactive Session has no headless log */ }
  const tokens = sessionTokensFromLog(text);
  if (tokens) {
    db.prepare(
      `INSERT OR REPLACE INTO production_attempt_tokens (action_key, session_id, input_tokens, cached_input_tokens, output_tokens, outcome, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(actionKey, input.session.id, tokens.inputTokens, tokens.cachedInputTokens, tokens.outputTokens, input.outcome, input.now.toISOString());
  }
  // Prefer the nonce-bound probe; otherwise only an attributable failed tool
  // operation can establish a wall. The creation callback retains this bounded
  // observation in the same new-receipt transaction.
  const capability = observeSessionCapability(text, readSessionProbeNonce(input.workspace, input.session.id));
  if (capability.provenance === "session_probe" && capability.status === "clear") {
    input.log(`Session probe passed for ${actionKey} (recorded probe budget ${SESSION_PROBE_TOKEN_BUDGET} tokens).`);
  }
  if (input.outcome === "accepted_completion" || input.outcome === "successful_exit") return capability;
  // Only attributable failure evidence can name a capability wall.
  const walls = capability.walls;
  const probeFailed = capability.provenance === "session_probe" && walls.length > 0;
  const breach = tokens
    ? decideTokenCeilingBreach(tokens, resolveSessionTokenCeiling(db, {
        workspace: input.workspace, session: { provider: input.session.provider ?? "", model: input.session.model ?? "" }
      }).ceiling)
    : null;
  if (breach) {
    // Over the platform ceiling: one named blocker, the budget set to its limit
    // so the pre-launch check never relaunches, whether or not a wall is also named.
    const named = describeBudgetExhausted(actionKey, breach, walls.map((wall) => wall.wallClass));
    const at = input.now.toISOString();
    const attempts = Math.max(getRepairAttempts(db, actionKey).attempts + 1, PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction);
    db.prepare(
      `INSERT INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at)
         VALUES (@action_key, @attempts, @last_error, @at, @at)
       ON CONFLICT(action_key) DO UPDATE SET
         attempts = @attempts, last_error = @last_error, last_attempt_at = @at, updated_at = @at`
    ).run({ action_key: actionKey, attempts, last_error: named.message, at });
    const newlyDetected = recordOperatorEscalation(db, {
      actionKey, kind: BUDGET_EXHAUSTED_ESCALATION_KIND, message: named.message, remedy: named.remedy, now: input.now
    });
    if (newlyDetected) input.log(`Escalated ${actionKey} to the operator (${BUDGET_EXHAUSTED_ESCALATION_KIND}): ${named.message}`);
    return capability;
  }
  if (walls.length === 0) return capability;
  const startRevision = input.session.launch_revision ?? input.session.base_revision;
  const noDiff = input.candidateRevision === startRevision && tryGit(input.session.worktree_path, ["status", "--porcelain"]) === "";
  if (!noDiff && !probeFailed) return capability;
  const named = describeEnvironmentWalls(actionKey, walls, probeFailed ? "session_probe" : "exit", tokens ? tokens.inputTokens + tokens.cachedInputTokens : null);
  const at = input.now.toISOString();
  const attempts = Math.max(getRepairAttempts(db, actionKey).attempts + 1, PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction);
  db.prepare(
    `INSERT INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at)
       VALUES (@action_key, @attempts, @last_error, @at, @at)
     ON CONFLICT(action_key) DO UPDATE SET
       attempts = @attempts, last_error = @last_error, last_attempt_at = @at, updated_at = @at`
  ).run({ action_key: actionKey, attempts, last_error: named.message, at });
  const newlyDetected = recordOperatorEscalation(db, {
    actionKey, kind: ENVIRONMENT_WALL_ESCALATION_KIND, message: named.message, remedy: named.remedy, now: input.now
  });
  if (newlyDetected) input.log(`Escalated ${actionKey} to the operator (${ENVIRONMENT_WALL_ESCALATION_KIND}): ${named.message}`);
  return capability;
}

export interface ProductionAttemptTokens {
  actionKey: string;
  sessionId: string;
  /** Uncached input tokens. */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  outcome: string | null;
  recordedAt: string;
}

/** Tokens recorded per Session attempt, oldest first; empty when none or the table predates this feature. */
export function listProductionAttemptTokens(db: Database.Database, actionKey?: string): ProductionAttemptTokens[] {
  try {
    const rows = db
      .prepare(
        `SELECT action_key, session_id, input_tokens, cached_input_tokens, output_tokens, outcome, recorded_at
           FROM production_attempt_tokens ${actionKey ? "WHERE action_key = ?" : ""} ORDER BY recorded_at ASC`
      )
      .all(...(actionKey ? [actionKey] : [])) as Array<{
        action_key: string; session_id: string; input_tokens: number; cached_input_tokens: number; output_tokens: number;
        outcome: string | null; recorded_at: string;
      }>;
    return rows.map((row) => ({
      actionKey: row.action_key, sessionId: row.session_id, inputTokens: row.input_tokens, cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens, outcome: row.outcome, recordedAt: row.recorded_at
    }));
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) return [];
    throw error;
  }
}

interface RepairAttemptsRow {
  attempts: number;
  last_error: string | null;
}

function getRepairAttempts(db: Database.Database, actionKey: string): { attempts: number; lastError: string | null } {
  const row = db.prepare("SELECT attempts, last_error FROM production_repair_attempts WHERE action_key = ?").get(actionKey) as
    | RepairAttemptsRow
    | undefined;
  return { attempts: row?.attempts ?? 0, lastError: row?.last_error ?? null };
}

function recordRepairAttempt(db: Database.Database, actionKey: string, error: string, now: Date): void {
  const at = now.toISOString();
  const existing = db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?").get(actionKey) as
    | { attempts: number }
    | undefined;
  const attempts = (existing?.attempts ?? 0) + 1;
  db.prepare(
    `INSERT INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at)
       VALUES (@action_key, @attempts, @last_error, @last_attempt_at, @updated_at)
     ON CONFLICT(action_key) DO UPDATE SET
       attempts = @attempts, last_error = @last_error, last_attempt_at = @last_attempt_at, updated_at = @updated_at`
  ).run({ action_key: actionKey, attempts, last_error: error, last_attempt_at: at, updated_at: at });
}

function resetRepairAttempts(db: Database.Database, actionKey: string): void {
  db.prepare("DELETE FROM production_repair_attempts WHERE action_key = ?").run(actionKey);
}

/**
 * The repair attempts currently recorded against an Action, for a command
 * (`arcadia production reset-repair-budget`) that wants to report what it
 * cleared rather than resetting blind.
 */
export function getProductionRepairAttempts(db: Database.Database, actionKey: string): { attempts: number; lastError: string | null } {
  ensureProductionTickTables(db);
  return getRepairAttempts(db, actionKey);
}

/** The kind of the escalation currently recorded against an Action, or null when it has none. */
export function getProductionOperatorEscalationKind(db: Database.Database, actionKey: string): string | null {
  ensureProductionTickTables(db);
  const row = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as { kind: string } | undefined;
  return row?.kind ?? null;
}

/** A ping message cut to the queue's limit (it refuses longer ones outright), keeping its start. */
export function boundedPingMessage(message: string): string {
  return message.length <= OPERATOR_PING_MESSAGE_MAX ? message : `${message.slice(0, OPERATOR_PING_MESSAGE_MAX - 1)}…`;
}

/**
 * Every escalation kind this module can record, assembled from the constants the recording sites use, so
 * `blockerRemedies.test.ts` fails when a kind exists with no registered remedy (src/production/blockerRemedies.ts).
 */
export const EMITTED_ESCALATION_KINDS: readonly string[] = [
  ENVIRONMENT_WALL_ESCALATION_KIND,
  BUDGET_EXHAUSTED_ESCALATION_KIND,
  "repair_budget_exhausted",
  "dependency_unresolved",
  "no_validation_commands",
  OPERATOR_GATE_ESCALATION,
  TERMINAL_CANDIDATE_ESCALATION,
  COMPLETION_SETTLEMENT_NOT_IN_CANDIDATE_ESCALATION,
  COMPLETION_VALIDATION_UNAVAILABLE_ESCALATION,
  COMPLETION_REFUSED_REPEATEDLY_ESCALATION,
  SELF_SETTLED_COMPLETION_REFUSED_ESCALATION,
  PLANNER_ATTEMPTS_EXHAUSTED,
  ...ATTEMPT_LINEAGE_ESCALATIONS,
  ...NON_SELF_RESOLVING_PACKET_LIFECYCLE_KINDS,
  ...VERDICT_WAIT_ESCALATIONS,
  ...Object.values(STALLED_PLANNING_GATES).map((gate) => gate.kind)
];

/**
 * Reset a repository's exhausted repair budget after an operator has fixed
 * the underlying problem, so the next tick attempts admission again rather
 * than reporting the same stale error forever. Also clears the
 * `repair_budget_exhausted` escalation this reset is answering, so
 * `arcadia production status` stops surfacing it the instant the operator
 * has acted, rather than waiting for the next tick's launch to succeed --
 * but only when that is the escalation actually recorded: an unrelated one
 * (e.g. `no_validation_commands`) sharing the same `actionKey` is left alone,
 * since resetting the repair budget never answers it (CodeRabbit, PR #708).
 */
export function resetProductionRepairBudget(db: Database.Database, actionKey: string): { reviewStepsCleared: number } {
  ensureProductionTickTables(db);
  resetRepairAttempts(db, actionKey);
  // The unattended review's per-head budget and checks deadline start afresh too.
  const reviewStepsCleared = resetReviewSteps(db, actionKey);
  const existing = db.prepare("SELECT kind FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as
    | { kind: string }
    | undefined;
  if (existing?.kind === "repair_budget_exhausted" || existing?.kind === ENVIRONMENT_WALL_ESCALATION_KIND || existing?.kind === BUDGET_EXHAUSTED_ESCALATION_KIND || existing?.kind === "review_budget_exhausted" || existing?.kind === "required_checks_timeout"
    || existing?.kind === COMPLETION_VALIDATION_UNAVAILABLE_ESCALATION || existing?.kind === COMPLETION_REFUSED_REPEATEDLY_ESCALATION) {
    clearOperatorEscalation(db, actionKey);
    clearPreservationRefusal(db, draftedCompletionRefusalSubject(actionKey));
    clearPreservationRefusal(db, draftedCompletionTimeoutSubject(actionKey));
  }
  return { reviewStepsCleared };
}

/**
 * Whether this tick should attempt `detectBaseBranchAdvance` at all.
 *
 * Always true with no recorded failure. Once one is recorded, true only when
 * the repository path changed since that failure (an operator plausibly fixed
 * the input) or the retry interval has elapsed (a periodic recheck, in case
 * something about the repository's own git state changed without the
 * configured path itself changing) -- otherwise the identical, already-known
 * failure would cost a subprocess spawn for nothing.
 */
function shouldAttemptBaseBranchObservation(
  db: Database.Database,
  input: { projectSlug: string; repoRoot: string; now: Date }
): boolean {
  const row = db
    .prepare("SELECT repository_path, last_attempted_at FROM production_base_branch_observation_failures WHERE project_slug = ?")
    .get(input.projectSlug) as { repository_path: string; last_attempted_at: string } | undefined;
  if (!row) return true;
  if (row.repository_path !== input.repoRoot) return true;
  const elapsed = input.now.getTime() - Date.parse(row.last_attempted_at);
  // A negative elapsed time (a backward clock correction) is treated as due,
  // not withheld until the clock catches back up to the stale timestamp plus
  // the full interval -- otherwise a substantial correction could delay
  // noticing a repaired repository for hours.
  return !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= BASE_BRANCH_OBSERVATION_FAILURE_RETRY_MS;
}

/**
 * Record (or refresh) a base-branch observation failure. Returns true only
 * when this is a new failure episode -- no prior record, a different
 * repository path, or a different message -- so the caller logs the named
 * `Base branch observation failed for ...` line once per episode instead of
 * once per tick.
 */
function recordBaseBranchObservationFailure(
  db: Database.Database,
  input: { projectSlug: string; repoRoot: string; message: string; now: Date }
): boolean {
  const at = input.now.toISOString();
  const existing = db
    .prepare("SELECT repository_path, message FROM production_base_branch_observation_failures WHERE project_slug = ?")
    .get(input.projectSlug) as { repository_path: string; message: string } | undefined;
  const isNewEpisode = !existing || existing.repository_path !== input.repoRoot || existing.message !== input.message;
  db.prepare(
    `INSERT INTO production_base_branch_observation_failures (project_slug, repository_path, message, first_failed_at, last_attempted_at)
       VALUES (@project_slug, @repository_path, @message, @at, @at)
     ON CONFLICT(project_slug) DO UPDATE SET
       repository_path = @repository_path,
       message = @message,
       first_failed_at = CASE WHEN production_base_branch_observation_failures.repository_path = @repository_path
                                AND production_base_branch_observation_failures.message = @message
                           THEN production_base_branch_observation_failures.first_failed_at ELSE @at END,
       last_attempted_at = @at`
  ).run({ project_slug: input.projectSlug, repository_path: input.repoRoot, message: input.message, at });
  return isNewEpisode;
}

/** Clear a recorded base-branch observation failure once an attempt succeeds. */
function clearBaseBranchObservationFailure(db: Database.Database, projectSlug: string): void {
  db.prepare("DELETE FROM production_base_branch_observation_failures WHERE project_slug = ?").run(projectSlug);
}

export const BASE_NOT_SYNCED_ESCALATION = "base_not_synced";

/**
 * A fast-forward that is refused while the remote is ahead is a persistent
 * stall (the pointer never advances), so it becomes one named operator
 * escalation per episode -- shown by `production status` and pinged once --
 * naming the checkout and the cause. A tick that syncs, or finds nothing to
 * sync, clears it.
 */
function reportBaseSyncStatus(
  db: Database.Database,
  input: { repoRoot: string; projectSlug: string; baseBranch: string; merged: boolean; now: Date; log: (message: string) => void }
): void {
  const actionKey = `base-branch/${input.projectSlug}`;
  const behind = Number.parseInt(tryGit(input.repoRoot, ["rev-list", "--count", `${input.baseBranch}..origin/${input.baseBranch}`])?.trim() ?? "0", 10);
  if (input.merged || !(behind > 0)) {
    db.prepare("DELETE FROM production_operator_escalations WHERE action_key = ? AND kind = ?").run(actionKey, BASE_NOT_SYNCED_ESCALATION);
    return;
  }
  const branch = tryGit(input.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim() ?? "unknown";
  const dirty = (tryGit(input.repoRoot, ["status", "--porcelain"]) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const causes: string[] = [];
  if (branch !== input.baseBranch) causes.push(`the checkout is on ${branch}, not ${input.baseBranch}`);
  if (dirty.length > 0) causes.push(`it has uncommitted changes (${dirty.slice(0, 5).join("; ")}${dirty.length > 5 ? `; +${dirty.length - 5} more` : ""})`);
  const why = causes.length > 0 ? causes.join(" and ") : `${input.baseBranch} has diverged from origin/${input.baseBranch}`;
  const message = `${input.projectSlug}'s primary checkout ${input.repoRoot} cannot fast-forward onto origin/${input.baseBranch} (${behind} commit${behind === 1 ? "" : "s"} behind): ${why}. Production's pointer cannot advance past merged work until it can.`;
  const remedy = `In ${input.repoRoot}: ${branch !== input.baseBranch ? `\`git switch ${input.baseBranch}\`, ` : ""}commit, stash or remove the listed changes, then \`git merge --ff-only origin/${input.baseBranch}\`. The next tick clears this entry.`;
  if (recordOperatorEscalation(db, { actionKey, kind: BASE_NOT_SYNCED_ESCALATION, message, remedy, now: input.now })) {
    input.log(`Escalated ${actionKey} to the operator (${BASE_NOT_SYNCED_ESCALATION}): ${message}`);
    try {
      queueOperatorPing(db, { message: boundedPingMessage(`Production cannot fast-forward ${input.projectSlug}'s checkout onto origin/${input.baseBranch}: ${why}. Fix: ${input.repoRoot}.`), kind: "attention", agent: "production-tick", now: input.now });
    } catch (error) {
      input.log(`Could not queue the ${BASE_NOT_SYNCED_ESCALATION} ping: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function detectBaseBranchAdvance(
  db: Database.Database,
  input: {
    repoRoot: string;
    projectSlug: string;
    projectId: string;
    now: Date;
    log: (message: string) => void;
    /** Whether the standing policy authorizes moving this checkout onto its remote. */
    fastForward: boolean;
  }
): BaseBranchAdvanceObservation | null {
  const baseBranch = resolveBaseBranch(input.repoRoot);
  // Fetch and fast-forward the local base branch onto its remote when that is
  // a clean ancestor merge, mirroring `go.ts`'s own `syncBaseBranchWithRemote`
  // -- without this, a PR merged by a human or CI elsewhere never becomes
  // visible here, because `git fetch` alone only updates the remote-tracking
  // ref, not the local branch this repository actually dispatches against.
  // `--ff-only` refuses (leaving everything untouched) on any divergence or
  // conflicting local change, so a tick can attempt this every time with no
  // risk of rewriting or discarding work.
  // Never silent: a fast-forward that moved the checkout is logged with both
  // SHAs, so a manual reset it undid is named rather than just gone (#608).
  if (input.fastForward && tryGit(input.repoRoot, ["fetch", "--quiet", "origin"]) !== null) {
    const headBefore = tryGit(input.repoRoot, ["rev-parse", "HEAD"])?.trim() ?? null;
    const merged = tryGit(input.repoRoot, ["merge", "--ff-only", "--quiet", `origin/${baseBranch}`]);
    reportBaseSyncStatus(db, { repoRoot: input.repoRoot, projectSlug: input.projectSlug, baseBranch, merged: merged !== null, now: input.now, log: input.log });
    const headAfter = tryGit(input.repoRoot, ["rev-parse", "HEAD"])?.trim() ?? null;
    if (headBefore && headAfter && headBefore !== headAfter) {
      input.log(`Fast-forwarded ${input.projectSlug}'s checkout ${input.repoRoot} onto origin/${baseBranch}: ${headBefore} -> ${headAfter} (managed production keeps an in-scope checkout on its remote; pause the Project or narrow the policy scope to hold a local reset).`);
    }
  }
  const newSha = git(input.repoRoot, ["rev-parse", baseBranch]).trim();
  const at = input.now.toISOString();

  const existing = db.prepare("SELECT observed_sha FROM production_base_branch_observations WHERE project_slug = ?").get(input.projectSlug) as
    | { observed_sha: string }
    | undefined;
  const previousSha = existing?.observed_sha ?? null;

  db.prepare(
    `INSERT INTO production_base_branch_observations (project_slug, project_id, repository_path, base_branch, observed_sha, observed_at)
       VALUES (@project_slug, @project_id, @repository_path, @base_branch, @observed_sha, @observed_at)
     ON CONFLICT(project_slug) DO UPDATE SET
       project_id = @project_id, repository_path = @repository_path, base_branch = @base_branch,
       observed_sha = @observed_sha, observed_at = @observed_at`
  ).run({
    project_slug: input.projectSlug,
    project_id: input.projectId,
    repository_path: input.repoRoot,
    base_branch: baseBranch,
    observed_sha: newSha,
    observed_at: at
  });

  if (previousSha === null || previousSha === newSha) {
    return { changed: false, previousSha, newSha, baseBranch };
  }

  // The durable record of an advance is the `events` row above plus the
  // `production_base_branch_observations` dedup row. Nothing is written to
  // MISSION_LOG.md and no commit is made: routine machine telemetry does not
  // belong in the human narrative, its date-only heading collides with every
  // advance on the same day so `docs sync` rejects the whole file, and the
  // per-advance commit rewrote history without anyone asking. The observation
  // itself is visible through `arcadia production status`.
  recordEvent(db, {
    eventType: "managed_production.base_branch_advanced",
    projectId: input.projectId,
    payload: { projectSlug: input.projectSlug, baseBranch, previousSha, newSha, repositoryPath: input.repoRoot },
    at
  });
  input.log(`Base branch ${baseBranch} advanced for ${input.projectSlug} (a merge landed independent of this worker's own admission pipeline): ${previousSha} -> ${newSha}`);
  return { changed: true, previousSha, newSha, baseBranch };
}

export interface BaseBranchAdvanceRecord {
  projectSlug: string;
  baseBranch: string;
  previousSha: string | null;
  newSha: string;
  observedAt: string;
}

/**
 * Read-only projection of the durable base-advance events, newest first, so a
 * human can see a merge that landed without a Mission Log entry. This is the
 * only surface `detectBaseBranchAdvance` records to besides the event row and
 * its dedup row.
 */
export function listRecentBaseBranchAdvances(db: Database.Database, limit = 10): BaseBranchAdvanceRecord[] {
  const rows = db
    .prepare(
      `SELECT payload_json, created_at
         FROM events
        WHERE event_type = 'managed_production.base_branch_advanced'
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(limit) as Array<{ payload_json: string; created_at: string }>;

  const records: BaseBranchAdvanceRecord[] = [];
  for (const row of rows) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    records.push({
      projectSlug: typeof payload.projectSlug === "string" ? payload.projectSlug : "unknown",
      baseBranch: typeof payload.baseBranch === "string" ? payload.baseBranch : "unknown",
      previousSha: typeof payload.previousSha === "string" ? payload.previousSha : null,
      newSha: typeof payload.newSha === "string" ? payload.newSha : "unknown",
      observedAt: row.created_at
    });
  }
  return records;
}

/** The launch-blocker code a provider sign-in failure exit records; it doubles as the hold marker. */
const PROVIDER_SIGN_IN_FAILED_CODE = "provider_sign_in_failed";

/**
 * The durable, operator-readable reason for a sign-in failure exit: names the
 * provider, the Session, when it happened, the remedy and when the hold ends.
 * The receipt reason already carries the Claude Code remedy; a provider whose
 * receipt does not gets a generic one rather than none.
 */
function providerSignInFailureBlockerReason(input: { sessionId: string; provider: string; at: Date; holdEnd: Date; receiptReason: string }): string {
  const remedy = input.receiptReason.includes("Sign in to ")
    ? ""
    : ` Sign in to ${input.provider} again on this worker host${input.provider.startsWith("codex") ? ' (run "codex login")' : ""}, then retry.`;
  return `Session ${input.sessionId} (${input.provider}) exited on a sign-in failure at ${input.at.toISOString()}. ${input.receiptReason}${remedy} `
    + `Launches for this Project are held until ${input.holdEnd.toISOString()}, then retried once; a further sign-in failure renews the hold.`;
}

/** The Project's sign-in failure hold if it is still running at `now`; null when none or lapsed. */
function activeSignInFailureHold(db: Database.Database, projectSlug: string, now: Date): { until: Date; observedAt: string } | null {
  ensureProductionLaunchBlockersTable(db);
  const row = db
    .prepare("SELECT code, observed_at FROM production_launch_blockers WHERE project_slug = ?")
    .get(projectSlug) as { code: string; observed_at: string } | undefined;
  if (!row || row.code !== PROVIDER_SIGN_IN_FAILED_CODE) return null;
  const observed = Date.parse(row.observed_at);
  if (!Number.isFinite(observed)) return null;
  const until = observed + SIGN_IN_FAILURE_HOLD_MS;
  return now.getTime() < until ? { until: new Date(until), observedAt: row.observed_at } : null;
}

export interface LaunchBlockerRecord {
  projectSlug: string;
  code: string;
  reason: string;
  actionKey: string | null;
  observedAt: string;
}

/**
 * Persist why `projectSlug` is not launching right now, so `arcadia
 * production status` can show the Project launch blocker instead of it
 * existing only as a line in the worker log. Overwrites any prior blocker for
 * the same Project: only the current reason is durable, not a history.
 */
function recordLaunchBlocker(
  db: Database.Database,
  input: { projectSlug: string; code: string; reason: string; actionKey: string | null; at: Date }
): void {
  ensureProductionLaunchBlockersTable(db);
  db.prepare(
    `INSERT INTO production_launch_blockers (project_slug, code, reason, action_key, observed_at)
       VALUES (@project_slug, @code, @reason, @action_key, @observed_at)
     ON CONFLICT(project_slug) DO UPDATE SET
       code = @code, reason = @reason, action_key = @action_key, observed_at = @observed_at`
  ).run({
    project_slug: input.projectSlug,
    code: input.code,
    reason: input.reason,
    action_key: input.actionKey,
    observed_at: input.at.toISOString()
  });
}

/** Clears a Project's recorded launch blocker once it stops applying. */
function clearLaunchBlocker(db: Database.Database, projectSlug: string): void {
  ensureProductionLaunchBlockersTable(db);
  db.prepare("DELETE FROM production_launch_blockers WHERE project_slug = ?").run(projectSlug);
}

/**
 * Read-only projection of every Project's current launch blocker, for
 * `arcadia production status`. A Project absent here is not currently
 * refused for a durable reason -- it may simply not have been considered yet.
 *
 * `arcadia production status` opens the database read-only and never applies
 * migrations itself, so a workspace whose database predates this table (and
 * has had no writable connection open since) would otherwise see this throw
 * "no such table" instead of an empty, honest status. Guard on
 * `sqlite_master` rather than assuming the table always exists.
 */
export function listLaunchBlockers(db: Database.Database): LaunchBlockerRecord[] {
  const tableExists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_launch_blockers'`)
    .get();
  if (!tableExists) return [];

  const rows = db
    .prepare(
      `SELECT project_slug, code, reason, action_key, observed_at
         FROM production_launch_blockers
        ORDER BY observed_at DESC`
    )
    .all() as Array<{ project_slug: string; code: string; reason: string; action_key: string | null; observed_at: string }>;
  return rows.map((row) => ({
    projectSlug: row.project_slug,
    code: row.code,
    reason: row.reason,
    actionKey: row.action_key,
    observedAt: row.observed_at
  }));
}

function recordEvent(db: Database.Database, input: { eventType: string; projectId: string | null; payload: unknown; at: string }): void {
  db.prepare(
    `INSERT INTO events (id, event_type, source_module, project_id, work_item_id, artifact_id, review_item_id, payload_json, created_at)
       VALUES (@id, @event_type, 'managed_production_tick', @project_id, NULL, NULL, NULL, @payload_json, @created_at)`
  ).run({
    id: createId("event"),
    event_type: input.eventType,
    project_id: input.projectId,
    payload_json: JSON.stringify({ schemaVersion: 1, ...input.payload as object }),
    created_at: input.at
  });
}
