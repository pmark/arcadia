import type Database from "better-sqlite3";
import { canonicalPath, getSession, type AgentSession } from "../sessions/index.js";
import { createSystemPreservationRemote } from "../sessions/candidatePreservation.js";
import { verifyFixtureStandingExit, type FixtureStandingBasis } from "../sessions/fixtureStandingLaunch.js";
import { findAcceptedTerminalCompletion } from "../sessions/reconciliation.js";
import {
  listPendingOperatorLaunchPublications,
  operatorLaunchAuthorityFor,
  recordOperatorLaunchUse,
  type OperatorLaunchAuthorization,
  type OperatorLaunchPublishState
} from "../sessions/operatorLaunch.js";
import { preserveSessionCandidate, productionAuthorizesValidation, type PreservationStep, type PreserveSessionDeps } from "./sessionHandoff.js";
import { readProductionPolicySafely } from "./policy.js";

/**
 * The exit half of Decision 0096: what the managed tick does, with production
 * NOT Active, for a Session whose confirmed operator Launch minted a one-shot
 * authorization. It adds no reconciler. The tick's existing dead-tmux branch
 * still preserves, reconciles and (only under production's own grant)
 * integrates; this module only decides whether an operator authorization
 * stands in for the missing production delegation, and runs the draft-PR step
 * after an accepted completion through the same `preserveSessionCandidate`.
 *
 *   exit tick:  validate + commit + push   (phase "commit": no PR yet)
 *               reconcile                  (the existing writer)
 *               accepted_completion only:  draft PR (phase "publish")
 *
 * Nothing here merges, integrates, readies a PR or touches production state.
 */

export type OperatorExit =
  | { kind: "authorized"; authorization: OperatorLaunchAuthorization }
  | { kind: "refused"; reason: string };

/**
 * The authorization that applies to this first exit, or null when there is
 * nothing to apply: no operator Launch minted one, or production already
 * authorizes the Action itself (production's path governs, unchanged).
 */
export function operatorLaunchForExit(db: Database.Database, session: AgentSession, now: Date): OperatorExit | null {
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status === "ok" && productionAuthorizesValidation(policyRead.policy, session)) return null;
  const authority = operatorLaunchAuthorityFor(db, session, now);
  if (authority.ok) return { kind: "authorized", authorization: authority.authorization };
  return authority.code === "none" ? null : { kind: "refused", reason: authority.reason };
}

function publishRequestId(sessionId: string): string {
  return `operator-launch-publish-${sessionId}`;
}

function pullRequestFor(db: Database.Database, sessionId: string): { url: string | null; number: number | null } {
  try {
    const row = db.prepare("SELECT pull_request_url, pull_request_number FROM candidate_preservation_receipts WHERE request_id = ?")
      .get(publishRequestId(sessionId)) as { pull_request_url: string | null; pull_request_number: number | null } | undefined;
    return { url: row?.pull_request_url ?? null, number: row?.pull_request_number ?? null };
  } catch {
    return { url: null, number: null };
  }
}

/**
 * Decision 0100: a `fixture_standing` authorization re-checks, right before the
 * push and again before the pull request, that the window is still open and the
 * repository still points only at registered fixtures; `gh` is then pinned to
 * that repository. Any other authorization passes through untouched.
 */
function fixtureExitGate(
  authorization: OperatorLaunchAuthorization, repoRoot: string, now: Date, deps: PreserveSessionDeps
): { ok: true; deps: PreserveSessionDeps } | { ok: false; reason: string } {
  if (authorization.source !== "fixture_standing") return { ok: true, deps };
  const standing = authorization.standing_json ? JSON.parse(authorization.standing_json) as FixtureStandingBasis : null;
  if (!standing) return { ok: false, reason: "A standing fixture authorization carries no Decision 0100 basis; nothing is pushed or opened." };
  const check = verifyFixtureStandingExit(standing, repoRoot, now);
  if (!check.ok) return check;
  return { ok: true, deps: deps.remote || !check.ghRepo ? deps : { ...deps, remote: createSystemPreservationRemote({ ghRepo: check.ghRepo }) } };
}

/** Validate, commit and push the branch (no pull request), under the Session's authorization, before reconciliation. */
export function preserveOperatorLaunchExit(
  input: { db: Database.Database; workspace: string; repoRoot: string; session: AgentSession; authorization: OperatorLaunchAuthorization; now: Date },
  deps: PreserveSessionDeps
): PreservationStep {
  const { db, workspace, repoRoot, session, authorization, now } = input;
  const gate = fixtureExitGate(authorization, repoRoot, now, deps);
  if (!gate.ok) return { kind: "refused", reason: gate.reason };
  return preserveSessionCandidate({
    db, workspace, repoRoot, session, now,
    operatorLaunch: { authorizationId: authorization.id, phase: "commit" }
  }, gate.deps);
}

export interface OperatorLaunchConclusion {
  authorizationId: string;
  outcome: string;
  publishState: OperatorLaunchPublishState;
  publish: PreservationStep | null;
  pullRequestUrl: string | null;
}

function publish(
  input: { db: Database.Database; workspace: string; repoRoot: string; session: AgentSession; authorization: OperatorLaunchAuthorization; now: Date },
  deps: PreserveSessionDeps
): { step: PreservationStep; state: OperatorLaunchPublishState; pullRequest: { url: string | null; number: number | null } } {
  const { db, workspace, repoRoot, session, authorization, now } = input;
  const gate = fixtureExitGate(authorization, repoRoot, now, deps);
  // A refused fixture gate is final (the window or the remotes will not heal): no retry.
  if (!gate.ok) return { step: { kind: "refused", reason: gate.reason }, state: "failed", pullRequest: { url: null, number: null } };
  const step = preserveSessionCandidate({
    db, workspace, repoRoot, session, now, terminalRecovery: true,
    operatorLaunch: { authorizationId: authorization.id, phase: "publish", requestId: publishRequestId(session.id) }
  }, gate.deps);
  const pullRequest = pullRequestFor(db, session.id);
  // A PR url exists only when the draft PR was really opened or updated.
  const state: OperatorLaunchPublishState = step.kind === "preserved" && step.state === "IN PR" && pullRequest.url ? "done" : "pending";
  return { step, state, pullRequest };
}

/**
 * After reconciliation: on `accepted_completion` only, open or update the
 * draft PR; in every case use the authorization up and write its receipt. A
 * failed PR step leaves the authorization `pending` for a bounded retry
 * ({@link retryOperatorLaunchPublications}); the candidate itself is already
 * committed and pushed.
 */
export function concludeOperatorLaunchExit(
  input: {
    db: Database.Database; workspace: string; repoRoot: string; session: AgentSession;
    authorization: OperatorLaunchAuthorization; now: Date;
    commit: PreservationStep; reconcileOutcome: string; reconcileReason: string;
  },
  deps: PreserveSessionDeps
): OperatorLaunchConclusion {
  const { db, authorization, now, commit } = input;
  const accepted = input.reconcileOutcome === "accepted_completion";
  const published = accepted ? publish(input, deps) : null;
  const publishState: OperatorLaunchPublishState = published ? published.state : "none";
  recordOperatorLaunchUse(db, authorization.id, {
    outcome: input.reconcileOutcome,
    publishState,
    publishAttempted: published !== null,
    detail: {
      reconcileReason: input.reconcileReason,
      commit: commit.kind === "preserved"
        ? { kind: "preserved", commitSha: commit.commitSha, state: commit.state }
        : { kind: commit.kind, reason: commit.reason },
      pullRequest: published ? {
        kind: published.step.kind,
        ...(published.step.kind === "refused" ? { reason: published.step.reason } : {}),
        url: published.pullRequest.url, number: published.pullRequest.number
      } : null,
      merged: false
    }
  }, now);
  return {
    authorizationId: authorization.id,
    outcome: input.reconcileOutcome,
    publishState,
    publish: published ? published.step : null,
    pullRequestUrl: published?.pullRequest.url ?? null
  };
}

/**
 * A draft PR that could not be opened at the exit tick is retried on later
 * ticks (a transient `gh` or network failure), bounded by
 * `OPERATOR_LAUNCH_MAX_PUBLISH_ATTEMPTS` and the authorization's 24 hours. Only
 * for a Session that is still `accepted_completion`.
 */
export function retryOperatorLaunchPublications(
  input: { db: Database.Database; workspace: string; repoRoot: string; now: Date; log: (message: string) => void },
  deps: PreserveSessionDeps
): void {
  const { db, workspace, repoRoot, now, log } = input;
  for (const authorization of listPendingOperatorLaunchPublications(db, canonicalPath(repoRoot))) {
    const session = getSession(db, authorization.session_id);
    if (!session) continue;
    const live = session.status === "prepared" || session.status === "running";
    const close = (outcome: string, why: string) => {
      recordOperatorLaunchUse(db, authorization.id, { outcome, publishState: "none", detail: { closed: why } }, now);
      log(`Operator launch authorization ${authorization.id} for Session ${session.id} closed: ${why}`);
    };
    // Production now delegates validation for this Action itself: its own path
    // owns the exit, and the operator authorization has nothing left to do.
    const policyRead = readProductionPolicySafely(db);
    if (!live && policyRead.status === "ok" && productionAuthorizesValidation(policyRead.policy, session)) {
      close("superseded_by_production", "production authorizes this Action itself");
      continue;
    }
    if (authorization.used_at === null) {
      // Not yet handled by an exit tick: only a Session that has been reconciled
      // as an accepted completion is owed anything here (a live one keeps its
      // authorization for its own exit).
      if (live) continue;
      if (!findAcceptedTerminalCompletion(db, session)) {
        // Reconciled without the worker's exit handling (an operator ran
        // `arcadia session reconcile`, or it did not end accepted): nothing was
        // committed or pushed under this authorization and none will be.
        close("not_applicable", `the Session ended ${session.status} outside the worker's exit handling; nothing was committed, pushed or opened`);
        continue;
      }
    }
    const authority = operatorLaunchAuthorityFor(db, session, now, authorization.id);
    if (!authority.ok) {
      recordOperatorLaunchUse(db, authorization.id, {
        outcome: authorization.outcome ?? "accepted_completion", publishState: "failed",
        detail: { retryRefused: authority.reason }
      }, now);
      log(`Operator launch draft PR for Session ${session.id} will not be retried: ${authority.reason}`);
      continue;
    }
    const published = publish({ db, workspace, repoRoot, session, authorization, now }, deps);
    recordOperatorLaunchUse(db, authorization.id, {
      outcome: authorization.outcome ?? "accepted_completion", publishState: published.state, publishAttempted: true,
      detail: {
        retry: true,
        pullRequest: {
          kind: published.step.kind,
          ...(published.step.kind === "refused" ? { reason: published.step.reason } : {}),
          url: published.pullRequest.url, number: published.pullRequest.number
        }
      }
    }, now);
    log(published.state === "done"
      ? `Operator launch draft PR for Session ${session.id} opened on retry: ${published.pullRequest.url}`
      : `Operator launch draft PR for Session ${session.id} still not opened${published.step.kind === "refused" ? `: ${published.step.reason}` : ""}.`);
  }
}
