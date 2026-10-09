import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import type { AgentSession } from "../sessions/index.js";
import type { CandidatePreservationDeps, CandidatePreservationReceipt, PreservationState, RemotePreservationAuthorization } from "../sessions/candidatePreservation.js";
import { preserveCandidate, resolvePullRequestBase, systemPreservationRemote } from "../sessions/candidatePreservation.js";
import { validatePreservationCandidate } from "../sessions/preservationValidation.js";
import { operatorQaPlanSource } from "../sessions/operatorQaPlan.js";
import { guardPreservationRefusal, guardPreservationTimeouts } from "../sessions/preservationRefusalBudget.js";
import { countCommits, git, isAncestor, isPatchEquivalent, refExists, resolveBaseBranch, SAFE_TASK_BRANCH, tryGit } from "../git/worktrees.js";
import { policyAuthorizesRemotePreservation, readProductionPolicySafely, type ProductionPolicyRecord } from "./policy.js";
import type { VerdictGate } from "../sessions/roleLineage.js";
import { findOperatorLaunchAuthorization, operatorLaunchAuthorityFor } from "../sessions/operatorLaunch.js";

/**
 * The A-to-B seam the plan's critical path leaves open: a managed-production
 * Session reaches a terminal process state, and unless something preserves its
 * candidate and (only under a separately explicit grant) integrates it, the
 * next dependent Action waits for a human merge.
 *
 * This module is that something, and it is deliberately narrow. Preservation
 * reuses the existing `preserveCandidate` machinery and its host-side objective
 * validation unchanged. Integration reuses Git's own fast-forward, refuses
 * everything else, and is gated on Decision 0058's independently recorded,
 * expiring grant -- never inferred from the production policy's
 * validation/acceptance/pointer delegation. Absent a valid grant the handoff
 * stops after preservation and reports the exact operator merge command.
 */

export type PreservationStep =
  | { kind: "preserved"; receiptId: string; commitSha: string; state: PreservationState; replayed: boolean; baseBranch: string; qaPlanRefusal?: string }
  | { kind: "not_applicable"; reason: string }
  | { kind: "refused"; reason: string; detail?: unknown; identicalRefusalLimitReached?: boolean };

export type IntegrationStep =
  | { kind: "integrated"; baseBranch: string; commits: number }
  | { kind: "already_integrated"; baseBranch: string }
  | { kind: "refused"; reason: string; operatorMergeCommand: string | null };

export interface SessionHandoffResult {
  preservation: PreservationStep;
  integration: IntegrationStep;
}

export interface PreserveSessionDeps {
  /** Injected for deterministic fixtures; defaults to the real Seatbelt validator. */
  validate?: typeof validatePreservationCandidate;
  preserve?: typeof preserveCandidate;
  remote?: CandidatePreservationDeps["remote"];
}

export interface IntegrateSessionDeps {
  /** Injected for deterministic fixtures; defaults to a real `git merge --ff-only`. */
  fastForward?: (input: { repoRoot: string; branch: string; commitSha: string }) => void;
}

export interface SessionHandoffInput {
  db: Database.Database;
  workspace: string;
  repoRoot: string;
  session: AgentSession;
  now: Date;
  /** A recovered terminal handoff may integrate only the settled candidate it inspected. */
  expectedCandidateHead?: string;
  /** Recover a worker-accepted terminal completion after Off withheld preservation. */
  terminalRecovery?: boolean;
  /**
   * Preserve under a confirmed operator Launch's one-shot authorization
   * (Decision 0096) when production does not itself authorize this Action.
   * `commit` validates, commits and pushes the branch without a pull request
   * (the exit, outcome not yet known); `publish` runs for a Session already
   * reconciled `accepted_completion` and opens or updates the draft PR. Both
   * are refused unless the Session's own unexpired, unused authorization names
   * this exact Session and Action.
   */
  operatorLaunch?: { authorizationId: string; phase: "commit" | "publish"; requestId?: string };
  /**
   * The independent-verdict gate the managed tick always supplies: checked
   * after the policy and grant, before any Git write. When given, only the
   * exact head its current code review and QA verdicts bind is integrated.
   */
  verdictGate?: () => VerdictGate;
  /**
   * The current time, read again after the verdict gate (which may run a
   * reviewer for minutes) so a grant that expired meanwhile refuses the
   * fast-forward. Defaults to the fixed `now`.
   */
  clock?: () => Date;
}

function actionKey(session: AgentSession): string {
  return `${session.project_slug}/${session.action_id}`;
}

/** Whether the Active production policy delegates host-side validation for exactly this Session's Project, Plan and Action. */
export function productionAuthorizesValidation(
  policy: Pick<ProductionPolicyRecord, "desiredState" | "scope">,
  session: AgentSession
): boolean {
  const scope = policy.scope;
  return policy.desiredState === "active" &&
    !!scope?.projects.includes(session.project_slug) &&
    scope.plans.includes(`${session.project_slug}/${session.plan_slug}`) &&
    scope.actions.includes(actionKey(session)) &&
    scope.mechanicalTransitions.includes("validation");
}

/** The exact command that lands this candidate when no grant authorizes the host to. */
export function operatorMergeCommand(input: { repoRoot: string; branch: string; baseBranch: string }): string {
  return `git -C ${input.repoRoot} merge --ff-only ${input.branch}   # then push ${input.baseBranch}`;
}

function hasCandidateChanges(session: AgentSession): { changes: boolean; reason: string } {
  let head: string;
  let status: string;
  try {
    head = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
    status = git(session.worktree_path, ["status", "--porcelain"]).trim();
  } catch {
    return { changes: false, reason: "The Session's worktree could not be read." };
  }
  if (head === session.base_revision && status.length === 0) {
    return { changes: false, reason: "The candidate has no commits or changes beyond its base revision." };
  }
  return { changes: true, reason: "" };
}

/**
 * Preserve one terminal Session's candidate through the existing machinery,
 * binding the same host-side validation the agent-initiated path uses. A
 * refusal never removes a file: the candidate worktree is left exactly as it
 * was, and the caller reports why.
 */
export function preserveSessionCandidate(
  input: SessionHandoffInput,
  deps: PreserveSessionDeps = {}
): PreservationStep {
  const { db, workspace, repoRoot, session } = input;
  const candidate = hasCandidateChanges(session);
  if (!candidate.changes) return { kind: "not_applicable", reason: candidate.reason };

  let baseBranch: string;
  try {
    baseBranch = resolveBaseBranch(repoRoot);
  } catch (error) {
    return { kind: "refused", reason: error instanceof Error ? error.message : String(error) };
  }

  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok") {
    return { kind: "refused", reason: `Preservation requires a readable production policy: ${policyRead.reason}` };
  }
  const policy = policyRead.policy;
  const productionAuthorized = productionAuthorizesValidation(policy, session);
  // Production authority, when it covers this Action, governs exactly as it
  // always has; an operator Launch's authorization only fills the gap when it
  // does not (production Inactive, or the Action outside its scope).
  const operatorAuthority = !productionAuthorized && input.operatorLaunch
    ? operatorLaunchAuthorityFor(db, session, input.now, input.operatorLaunch.authorizationId)
    : null;
  if (operatorAuthority && !operatorAuthority.ok) {
    return { kind: "refused", reason: operatorAuthority.reason };
  }
  const operator = operatorAuthority?.ok ? input.operatorLaunch! : null;
  if (!productionAuthorized && !operator) {
    return {
      kind: "refused",
      reason:
        "Host-side validation is not authorized for this Action, so the candidate will not be preserved. " +
        "The production policy must delegate the validation transition for exactly this Project, Plan and Action."
    };
  }

  // A serial candidate with no remote branch to stack its PR on, or whose open
  // PR sits on a no-longer-valid base, is refused by preserveCandidate after
  // host validation; check that first, so a refusal only the operator can
  // clear does not re-run validation every tick.
  const remote = deps.remote ?? systemPreservationRemote;
  const unstackable = (productionAuthorized && policyAuthorizesRemotePreservation(policy, actionKey(session))) || operator?.phase === "publish"
    ? stackedBaseRefusal(db, { repoRoot, session, baseBranch, now: input.now }, remote)
    : null;
  if (unstackable) return { kind: "refused", reason: unstackable };

  const validate = deps.validate ?? validatePreservationCandidate;
  let validation: ReturnType<typeof validatePreservationCandidate>;
  try {
    // Bound on the Session's own id, so this tick-driven attempt shares its
    // identical-refusal count with any prior `arcadia preserve` calls the
    // agent itself made from inside the Session before its tmux died -- one
    // repository-wide budget per Session, whichever path checks it.
    validation = guardPreservationRefusal(db, session.id, input.now, () => validate(db, workspace, session, input.terminalRecovery === true,
      operator ? { authorizationId: operator.authorizationId, at: input.now } : undefined));
  } catch (error) {
    return refusedPreservation(error);
  }

  const currentPolicy = readProductionPolicySafely(db);
  if (operator) {
    const still = operatorLaunchAuthorityFor(db, session, input.now, operator.authorizationId);
    if (!still.ok) return { kind: "refused", reason: `Operator launch authority changed during host validation; preservation is withheld (${still.reason}).` };
  } else if (currentPolicy.status !== "ok" || currentPolicy.policy.desiredState !== "active"
    || currentPolicy.policy.epoch !== policy.epoch || currentPolicy.policy.revision !== policy.revision) {
    return { kind: "refused", reason: "Production authority changed during host validation; preservation is withheld." };
  }

  const qaPlan = () => operatorQaPlanSource({
    actionKey: actionKey(session),
    action: validation.binding?.actionDefinition,
    validationCommands: validation.binding?.commands
  });
  const remotePreservation: RemotePreservationAuthorization = operator
    ? operator.phase === "publish"
      ? { authorized: true, qaPlan: qaPlan() }
      : { authorized: true, pushOnly: true }
    : policyAuthorizesRemotePreservation(policy, actionKey(session))
      ? { authorized: true, qaPlan: qaPlan() }
      : { authorized: false, reason: "The Active policy does not authorize remote preservation." };

  const preserve = deps.preserve ?? preserveCandidate;
  try {
    // The same shared timeout guard the CLI broker uses, keyed on the same
    // Session id: a preserve-stage timeout or index-lock refusal here counts
    // against the one budget, and a success clears it for both paths.
    const receipt: CandidatePreservationReceipt = guardPreservationTimeouts(db, session.id, input.now, () => preserve(
      db,
      {
        requestId: operator?.requestId ?? `worker-tick-preserve-${session.id}`,
        repositoryPath: repoRoot,
        candidateWorktreePath: session.worktree_path,
        branch: session.branch,
        baseBranch,
        baseRevision: session.base_revision,
        actionId: session.action_id,
        packetSha256: session.packet_sha256,
        ...(input.terminalRecovery ? { terminalSessionId: session.id } : {}),
        policyEpoch: policy.epoch,
        policyRevision: policy.revision,
        validation,
        remotePreservation,
        now: input.now
      },
      { remote }
    ));
    return {
      kind: "preserved",
      receiptId: receipt.id,
      commitSha: receipt.commitSha,
      state: receipt.preservationState,
      replayed: receipt.replayed,
      baseBranch,
      ...(receipt.qaPlanRefusal ? { qaPlanRefusal: receipt.qaPlanRefusal } : {})
    };
  } catch (error) {
    return refusedPreservation(error);
  }
}

/**
 * The last stacked-base refusal per Session and base revision, reused for a
 * minute so a blocked candidate costs one `git ls-remote` a minute rather
 * than one per worker iteration (about 2 s). Only refusals are remembered: a
 * restored branch is picked up within that minute.
 */
const STACKED_BASE_RECHECK_MS = 60_000;
const recentStackedBaseRefusals = new Map<string, { at: number; reason: string }>();

/**
 * The PR-base refusal preserveCandidate would raise (no remote branch can be
 * the base, or an open PR sits on a no-longer-valid base), or null (including
 * when it cannot tell: preservation then decides). Exported for tests.
 */
export function stackedBaseRefusal(
  db: Database.Database,
  input: { repoRoot: string; session: AgentSession; baseBranch: string; now: Date },
  remote: NonNullable<CandidatePreservationDeps["remote"]>
): string | null {
  const { session, now } = input;
  const key = `${session.id}\n${session.base_revision}`;
  // A recorded receipt replays without any remote read: nothing to pre-check.
  try {
    if (db.prepare("SELECT 1 FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${session.id}`)) return null;
  } catch { /* no receipts table yet */ }
  const cached = recentStackedBaseRefusals.get(key);
  if (cached && now.getTime() >= cached.at && now.getTime() - cached.at < STACKED_BASE_RECHECK_MS) return cached.reason;
  recentStackedBaseRefusals.delete(key);
  try {
    if (!remote.listBranchTips || !remote.hasRemote(input.repoRoot)) return null;
    const resolved = resolvePullRequestBase(db, {
      repositoryPath: input.repoRoot, baseBranch: input.baseBranch, baseRevision: session.base_revision, branch: session.branch
    }, remote);
    if (resolved.ok) return null;
    const reason = resolved.error.message;
    for (const [entry, value] of recentStackedBaseRefusals) if (now.getTime() - value.at >= STACKED_BASE_RECHECK_MS) recentStackedBaseRefusals.delete(entry);
    recentStackedBaseRefusals.set(key, { at: now.getTime(), reason });
    return reason;
  } catch {
    return null;
  }
}

/** A refused step, flagging an exhausted identical refusal, timeout or
 * index-lock budget -- or a non-retryable preservation failure such as a
 * malformed index lock, which a resumed Session (a new id, so a zero count)
 * would only hit again -- so the tick withholds automatic resumption. */
function refusedPreservation(error: unknown): PreservationStep {
  const detail = (error as { details?: unknown } | null)?.details;
  const flags = !!detail && typeof detail === "object" ? detail as { identicalRefusalLimitReached?: unknown; retryable?: unknown } : {};
  const nonRetryable = error instanceof ArcadiaError && flags.retryable === false
    && (error.code === "PRESERVATION_GIT_TIMEOUT" || error.code === "PRESERVATION_INDEX_LOCKED");
  const identicalRefusalLimitReached = flags.identicalRefusalLimitReached === true || nonRetryable;
  return { kind: "refused", reason: error instanceof Error ? error.message : String(error), detail, identicalRefusalLimitReached };
}

/** Local, read-only classification of a candidate branch against its base. */
function integrationKind(repoRoot: string, baseBranch: string, branch: string): "fast-forward" | "already-integrated" | "not-needed" | null {
  if (!refExists(repoRoot, `refs/heads/${branch}`)) return null;
  if (branch === baseBranch) return "not-needed";
  if (isAncestor(repoRoot, branch, baseBranch) || isPatchEquivalent(repoRoot, baseBranch, branch)) return "already-integrated";
  if (isAncestor(repoRoot, baseBranch, branch)) return "fast-forward";
  return null;
}

/** Decision 0058's integration authority for this exact Session's Action, at `at`. */
function integrationAuthority(db: Database.Database, session: AgentSession, at: Date):
  { ok: true; policy: ProductionPolicyRecord } | { ok: false; reason: string } {
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok") {
    return { ok: false, reason: `Candidate integration requires a readable production policy: ${policyRead.reason}` };
  }
  const policy = policyRead.policy;
  const scope = policy.scope;
  if (policy.desiredState !== "active" || !scope) {
    return { ok: false, reason: "Managed production is Inactive; no candidate integration is authorized." };
  }
  if (
    !scope.projects.includes(session.project_slug) ||
    !scope.plans.includes(`${session.project_slug}/${session.plan_slug}`) ||
    !scope.actions.includes(actionKey(session))
  ) {
    return { ok: false, reason: `${actionKey(session)} is outside the authorized production scope.` };
  }
  const grant = scope.integrationGrant;
  if (!grant) {
    return { ok: false, reason: "No candidate-integration grant is recorded in the Active policy (Decision 0058)." };
  }
  const grantedActions = grant.actions.length > 0 ? grant.actions : scope.actions;
  if (!grantedActions.includes(actionKey(session))) {
    return { ok: false, reason: `The integration grant does not name ${actionKey(session)}.` };
  }
  if (Number.isNaN(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= at.getTime()) {
    return { ok: false, reason: `The integration grant expired at ${grant.expiresAt}.` };
  }
  return { ok: true, policy };
}

function refusal(reason: string, merge: string | null): IntegrationStep {
  return { kind: "refused", reason, operatorMergeCommand: merge };
}

/**
 * Integrate one Session's agent-owned branch into the governed base branch,
 * and only when Decision 0058's separately recorded, unexpired grant names
 * this exact Project, Plan and Action. Every other condition stops before any
 * Git write and reports the operator merge command instead.
 */
export function integrateSessionCandidate(
  input: SessionHandoffInput,
  deps: IntegrateSessionDeps = {}
): IntegrationStep {
  const { db, repoRoot, session, now, expectedCandidateHead } = input;
  const branch = session.branch;
  let baseBranch: string;
  try {
    baseBranch = resolveBaseBranch(repoRoot);
  } catch (error) {
    return refusal(error instanceof Error ? error.message : String(error), null);
  }
  const merge = operatorMergeCommand({ repoRoot, branch, baseBranch });

  if (!SAFE_TASK_BRANCH.test(branch)) {
    return refusal(`Branch ${branch} is not clearly agent-owned; the host will not integrate it.`, merge);
  }

  // The worktree must still be the exact agent-owned branch the Session reserved.
  const checkedOut = tryGit(session.worktree_path, ["symbolic-ref", "--short", "HEAD"]);
  if (checkedOut === null || checkedOut.trim() !== branch) {
    return refusal(`The Session worktree is no longer on its own branch ${branch}.`, merge);
  }

  // A candidate preserved under an operator Launch's authorization (Decision
  // 0096) was never delegated to production's validation, so a production grant
  // that merely names integration must not carry it into the base branch. Only
  // production itself delegating validation for this Action lifts that.
  if (findOperatorLaunchAuthorization(db, session.id)) {
    const policyRead = readProductionPolicySafely(db);
    if (policyRead.status !== "ok" || !productionAuthorizesValidation(policyRead.policy, session)) {
      return refusal("The candidate was preserved under an operator Launch authorization (Decision 0096), which never authorizes integration; merge it through its pull request.", merge);
    }
  }

  const authorized = integrationAuthority(db, session, now);
  if (!authorized.ok) return refusal(authorized.reason, merge);
  const policy = authorized.policy;

  const assertCandidateHead = (head: string): IntegrationStep | null => {
    const branchHead = tryGit(repoRoot, ["rev-parse", `refs/heads/${branch}`])?.trim();
    const worktreeHead = tryGit(session.worktree_path, ["rev-parse", "HEAD"])?.trim();
    return branchHead !== head || worktreeHead !== head
      ? refusal("The terminal candidate changed after its completion settlement was checked.", merge)
      : null;
  };
  if (expectedCandidateHead) {
    const changed = assertCandidateHead(expectedCandidateHead);
    if (changed) return changed;
  }

  const kind = integrationKind(repoRoot, baseBranch, branch);
  if (kind === null) {
    return refusal(`The candidate branch ${branch} cannot fast-forward the governed base branch ${baseBranch}.`, merge);
  }
  if (kind === "not-needed") {
    return { kind: "already_integrated", baseBranch };
  }
  if (kind === "already-integrated") {
    return { kind: "already_integrated", baseBranch };
  }

  // Only a real fast-forward writes the base, so only it needs the verdicts:
  // the exact head both current independent verdicts bind, nothing newer.
  let candidateHead = expectedCandidateHead;
  if (input.verdictGate) {
    const gate = input.verdictGate();
    if (!gate.satisfied) return refusal(gate.reason, merge);
    // The gate may have run a reviewer for minutes: Off, a new epoch, a
    // narrowed scope or a grant that expired in the meantime (checked against
    // a fresh clock) withholds the fast-forward, before any write. The
    // verdict itself stays recorded.
    const after = integrationAuthority(db, session, (input.clock ?? (() => now))());
    if (!after.ok || after.policy.epoch !== policy.epoch) {
      return refusal(`Production authority changed while the independent verdicts were checked; integration is withheld until a later tick${after.ok ? "" : ` (${after.reason})`}.`, merge);
    }
    if (candidateHead && candidateHead !== gate.binding.targetHead) {
      return refusal("The candidate's independent verdicts bind a different head than the settled candidate.", merge);
    }
    candidateHead = gate.binding.targetHead;
    const changed = assertCandidateHead(candidateHead);
    if (changed) return changed;
  }

  const commitSha = candidateHead ?? branch;
  const commits = countCommits(repoRoot, baseBranch, commitSha);
  try {
    if (deps.fastForward) deps.fastForward({ repoRoot, branch, commitSha });
    else git(repoRoot, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", commitSha]);
  } catch (error) {
    return refusal(error instanceof Error ? error.message : String(error), merge);
  }
  return { kind: "integrated", baseBranch, commits };
}

/**
 * The whole terminal-session handoff is deliberately three ordered calls, not
 * one: preserve (so a validation refusal leaves every candidate file in place),
 * reconcile through the existing canonical completion/pointer writers, then
 * integrate only under a valid grant. Integration must follow reconciliation so
 * the branch it fast-forwards already carries the completion settlement; doing
 * it before would land the agent's work without the pointer transition and the
 * worker would re-admit the same Action.
 */
export function handoffIntegrated(result: SessionHandoffResult): boolean {
  return result.integration.kind === "integrated" || result.integration.kind === "already_integrated";
}
