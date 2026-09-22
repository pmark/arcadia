import type Database from "better-sqlite3";
import type { AgentSession } from "../sessions/index.js";
import type { CandidatePreservationDeps, CandidatePreservationReceipt, PreservationState, RemotePreservationAuthorization } from "../sessions/candidatePreservation.js";
import { preserveCandidate, systemPreservationRemote } from "../sessions/candidatePreservation.js";
import { validatePreservationCandidate } from "../sessions/preservationValidation.js";
import { countCommits, git, isAncestor, isPatchEquivalent, refExists, resolveBaseBranch, SAFE_TASK_BRANCH, tryGit } from "../git/worktrees.js";
import { readProductionPolicySafely } from "./policy.js";

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
  | { kind: "preserved"; receiptId: string; commitSha: string; state: PreservationState; replayed: boolean; baseBranch: string }
  | { kind: "not_applicable"; reason: string }
  | { kind: "refused"; reason: string; detail?: unknown };

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
  fastForward?: (input: { repoRoot: string; branch: string }) => void;
}

export interface SessionHandoffInput {
  db: Database.Database;
  workspace: string;
  repoRoot: string;
  session: AgentSession;
  now: Date;
}

function actionKey(session: AgentSession): string {
  return `${session.project_slug}/${session.action_id}`;
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
  const scope = policy.scope;
  const validationAuthorized =
    policy.desiredState === "active" &&
    !!scope?.projects.includes(session.project_slug) &&
    scope.plans.includes(`${session.project_slug}/${session.plan_slug}`) &&
    scope.actions.includes(actionKey(session)) &&
    scope.mechanicalTransitions.includes("validation");
  if (!validationAuthorized) {
    return {
      kind: "refused",
      reason:
        "Host-side validation is not authorized for this Action, so the candidate will not be preserved. " +
        "The production policy must delegate the validation transition for exactly this Project, Plan and Action."
    };
  }

  const validate = deps.validate ?? validatePreservationCandidate;
  let validation: ReturnType<typeof validatePreservationCandidate>;
  try {
    validation = validate(db, workspace, session);
  } catch (error) {
    return { kind: "refused", reason: error instanceof Error ? error.message : String(error), detail: (error as { details?: unknown }).details };
  }

  const remotePreservation: RemotePreservationAuthorization =
    policy.desiredState === "active" && scope?.remotePreservation === true
      ? { authorized: true, qaPlan: `Preserved candidate for ${actionKey(session)} on ${baseBranch}.` }
      : { authorized: false, reason: "The Active policy does not authorize remote preservation." };

  const preserve = deps.preserve ?? preserveCandidate;
  try {
    const receipt: CandidatePreservationReceipt = preserve(
      db,
      {
        requestId: `worker-tick-preserve-${session.id}`,
        repositoryPath: repoRoot,
        candidateWorktreePath: session.worktree_path,
        branch: session.branch,
        baseBranch,
        baseRevision: session.base_revision,
        actionId: session.action_id,
        packetSha256: session.packet_sha256,
        policyEpoch: policy.epoch,
        policyRevision: policy.revision,
        validation,
        remotePreservation,
        now: input.now
      },
      { remote: deps.remote ?? systemPreservationRemote }
    );
    return {
      kind: "preserved",
      receiptId: receipt.id,
      commitSha: receipt.commitSha,
      state: receipt.preservationState,
      replayed: receipt.replayed,
      baseBranch
    };
  } catch (error) {
    return { kind: "refused", reason: error instanceof Error ? error.message : String(error), detail: (error as { details?: unknown }).details };
  }
}

/** Local, read-only classification of a candidate branch against its base. */
function integrationKind(repoRoot: string, baseBranch: string, branch: string): "fast-forward" | "already-integrated" | "not-needed" | null {
  if (!refExists(repoRoot, `refs/heads/${branch}`)) return null;
  if (branch === baseBranch) return "not-needed";
  if (isAncestor(repoRoot, branch, baseBranch) || isPatchEquivalent(repoRoot, baseBranch, branch)) return "already-integrated";
  if (isAncestor(repoRoot, baseBranch, branch)) return "fast-forward";
  return null;
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
  const { db, repoRoot, session, now } = input;
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

  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok") {
    return refusal(`Candidate integration requires a readable production policy: ${policyRead.reason}`, merge);
  }
  const policy = policyRead.policy;
  const scope = policy.scope;
  if (policy.desiredState !== "active" || !scope) {
    return refusal("Managed production is Inactive; no candidate integration is authorized.", merge);
  }
  if (
    !scope.projects.includes(session.project_slug) ||
    !scope.plans.includes(`${session.project_slug}/${session.plan_slug}`) ||
    !scope.actions.includes(actionKey(session))
  ) {
    return refusal(`${actionKey(session)} is outside the authorized production scope.`, merge);
  }

  const grant = scope.integrationGrant;
  if (!grant) {
    return refusal("No candidate-integration grant is recorded in the Active policy (Decision 0058).", merge);
  }
  const grantedActions = grant.actions.length > 0 ? grant.actions : scope.actions;
  if (!grantedActions.includes(actionKey(session))) {
    return refusal(`The integration grant does not name ${actionKey(session)}.`, merge);
  }
  if (Number.isNaN(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now.getTime()) {
    return refusal(`The integration grant expired at ${grant.expiresAt}.`, merge);
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

  const commits = countCommits(repoRoot, baseBranch, branch);
  try {
    if (deps.fastForward) deps.fastForward({ repoRoot, branch });
    else git(repoRoot, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", branch]);
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
