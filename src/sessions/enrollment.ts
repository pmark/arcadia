import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import type { GoBrokerAgent } from "../goBroker.js";

export const ENROLLMENT_MODES = ["prepare", "managed-launch", "native-adopt"] as const;
export type EnrollmentMode = typeof ENROLLMENT_MODES[number];
export const SESSION_ATTEMPT_ROLES = ["planner", "critique", "development", "code-review", "qa"] as const;
export type SessionAttemptRole = typeof SESSION_ATTEMPT_ROLES[number];

export interface GovernedEnrollmentContext {
  projectSlug: string;
  planSlug: string;
  actionId: string;
  canonicalBrief: string;
  operatorGates: string[];
  provider: string;
  model: string;
  effort: string | null;
  policyState: "active" | "off";
  policyEpoch: number;
  packetApproved: boolean;
  capacityAvailable: boolean;
  existingClaim: { id: string; worktree: string; generation: string } | null;
}

export interface EnrollmentRequest {
  requestId: string;
  source: string;
  agent: GoBrokerAgent;
  callerId: string;
  mode: EnrollmentMode;
  projectSlug: string;
  planSlug: string;
  actionId: string;
  requirementId: string;
  inputRevision: string;
  expectedPolicyEpoch?: number;
  nativeAdapter?: {
    adapterId: string;
    runtimeId: string;
    stableIdentity: boolean;
    livenessObservable: boolean;
    terminalOutcomeObservable: boolean;
    recoveryObservable: boolean;
  };
}

export interface EnrollmentReceipt {
  enrollmentId: string;
  requestId: string;
  mode: EnrollmentMode;
  projectSlug: string;
  planSlug: string;
  actionId: string;
  callerId: string;
  canonicalBrief: string;
  operatorGates: string[];
  execution: { provider: string; model: string; effort: string | null };
  requirementId: string;
  inputRevision: string;
  claim: GovernedEnrollmentContext["existingClaim"];
  principal: { kind: "prepared" | "managed-session" | "native-runtime"; id: string; worktree?: string };
  createdAt: string;
}

export interface EnrollmentDependencies {
  resolve(source: string): GovernedEnrollmentContext;
  prepare(input: { request: EnrollmentRequest; context: GovernedEnrollmentContext }): { id: string; worktree: string };
  launch(input: { request: EnrollmentRequest; context: GovernedEnrollmentContext }): { id: string; worktree: string };
  rollback?(input: { request: EnrollmentRequest; context: GovernedEnrollmentContext }): void;
  /** Reconcile a host effect that may have completed before its response was persisted. */
  recover?(input: { request: EnrollmentRequest; context: GovernedEnrollmentContext }): EnrollmentReceipt | null;
  now?: () => Date;
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requestFingerprint(request: EnrollmentRequest): string {
  return stableFingerprint(request);
}

function nativeSupervisable(request: EnrollmentRequest): boolean {
  const adapter = request.nativeAdapter;
  return !!adapter && adapter.stableIdentity && adapter.livenessObservable &&
    adapter.terminalOutcomeObservable && adapter.recoveryObservable;
}

/**
 * Fixed host enrollment. All governed facts are re-derived by `resolve`; the
 * caller can bind expectations but cannot supply a command, packet, worktree,
 * provider, model, claim, gate, or executable. Effects are delegated only to
 * the canonical prepare/guarded-launch adapters supplied by the host.
 */
export function enrollGovernedSession(
  db: Database.Database,
  request: EnrollmentRequest,
  dependencies: EnrollmentDependencies
): EnrollmentReceipt {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.requestId)) {
    throw validationError("Enrollment requires a stable bounded request id.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.callerId)) {
    throw validationError("Enrollment requires a stable bounded caller identity.");
  }
  const fingerprint = requestFingerprint(request);
  const prior = db.prepare("SELECT request_fingerprint, status, receipt_json FROM session_enrollments WHERE request_id = ?")
    .get(request.requestId) as { request_fingerprint: string; status: string; receipt_json: string | null } | undefined;
  if (prior) {
    if (prior.request_fingerprint !== fingerprint) {
      throw validationError("Enrollment request id was already used with a different Action, caller, mode, or input.", {
        code: "enrollment_request_changed", requestId: request.requestId
      });
    }
    if (prior.status === "completed" && prior.receipt_json) return JSON.parse(prior.receipt_json) as EnrollmentReceipt;
    if (dependencies.recover) {
      const recovered = dependencies.recover({ request, context: dependencies.resolve(request.source) });
      if (recovered) {
        const at = (dependencies.now ?? (() => new Date()))().toISOString();
        writeTransaction(db, () => db.prepare("UPDATE session_enrollments SET status = 'completed', receipt_json = ?, updated_at = ? WHERE request_id = ?")
          .run(JSON.stringify(recovered), at, request.requestId));
        return recovered;
      }
    }
    throw validationError("This exact enrollment request is already in progress.", { code: "enrollment_in_progress", requestId: request.requestId });
  }

  const context = dependencies.resolve(request.source);
  const expected = [request.projectSlug, request.planSlug, request.actionId];
  const actual = [context.projectSlug, context.planSlug, context.actionId];
  if (expected.some((value, index) => value !== actual[index])) {
    throw validationError("The governed Project, Plan, or Action changed before enrollment.", { code: "enrollment_governance_changed", expected, actual });
  }
  if (request.expectedPolicyEpoch !== undefined && request.expectedPolicyEpoch !== context.policyEpoch) {
    throw validationError("The managed-production policy epoch changed before enrollment.", { code: "stale_policy_epoch" });
  }
  if (request.mode === "managed-launch") {
    if (context.policyState === "off") throw validationError("Managed production is Off; enrollment created no admission or claim.", { code: "production_off" });
    if (!context.packetApproved) throw validationError("The governed build packet is not approved.", { code: "packet_approval_required" });
    if (!context.capacityAvailable) throw validationError("No configured provider capacity is available.", { code: "capacity_unavailable" });
  }
  if (request.mode === "native-adopt" && !nativeSupervisable(request)) {
    throw validationError("The native runtime cannot be durably supervised by this host.", {
      code: "native_runtime_not_supervisable",
      remedy: "Use managed-launch enrollment so launchGuardedHostSession supplies stable identity, liveness, terminal outcome, and recovery."
    });
  }

  const now = (dependencies.now ?? (() => new Date()))().toISOString();
  try {
    writeTransaction(db, () => {
      db.prepare(`INSERT INTO session_enrollments (
        request_id, request_fingerprint, project_slug, plan_slug, action_id, caller_id, mode, status, receipt_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`).run(
        request.requestId, fingerprint, context.projectSlug, context.planSlug, context.actionId,
        request.callerId, request.mode, now, now
      );
    });
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith("SQLITE_CONSTRAINT")) {
      throw validationError("Another enrollment already owns this Action's host transaction.", {
        code: "enrollment_in_progress", projectSlug: context.projectSlug, planSlug: context.planSlug, actionId: context.actionId
      });
    }
    throw error;
  }

  try {
    const principal = request.mode === "prepare"
      ? { kind: "prepared" as const, ...dependencies.prepare({ request, context }) }
      : request.mode === "managed-launch"
        ? { kind: "managed-session" as const, ...dependencies.launch({ request, context }) }
        : { kind: "native-runtime" as const, id: request.nativeAdapter!.runtimeId };
    const receipt: EnrollmentReceipt = {
      enrollmentId: `enrollment_${randomUUID().replaceAll("-", "")}`,
      requestId: request.requestId,
      mode: request.mode,
      projectSlug: context.projectSlug,
      planSlug: context.planSlug,
      actionId: context.actionId,
      callerId: request.callerId,
      canonicalBrief: context.canonicalBrief,
      operatorGates: [...context.operatorGates],
      execution: { provider: context.provider, model: context.model, effort: context.effort },
      requirementId: request.requirementId,
      inputRevision: request.inputRevision,
      claim: context.existingClaim,
      principal,
      createdAt: now
    };
    writeTransaction(db, () => db.prepare("UPDATE session_enrollments SET status = 'completed', receipt_json = ?, updated_at = ? WHERE request_id = ?")
      .run(JSON.stringify(receipt), now, request.requestId));
    return receipt;
  } catch (error) {
    try { dependencies.rollback?.({ request, context }); } finally {
      writeTransaction(db, () => db.prepare("DELETE FROM session_enrollments WHERE request_id = ? AND status = 'pending'").run(request.requestId));
    }
    throw error;
  }
}

export interface AllocateAttemptInput {
  requirementId: string;
  inputRevision: string;
  role: SessionAttemptRole;
  requestId: string;
  actorId: string;
  mutationOwner: boolean;
  retryAuthorized?: boolean;
  authorityCurrent: boolean;
  maxOrdinal?: number;
  now?: Date;
}

export function allocateSessionRoleAttempt(db: Database.Database, input: AllocateAttemptInput) {
  if (!input.authorityCurrent) throw validationError("Attempt authority is stale.", { code: "attempt_authority_stale" });
  if (!SESSION_ATTEMPT_ROLES.includes(input.role)) throw validationError("Unknown session attempt role.", { code: "unknown_attempt_role" });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.requestId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.actorId)) {
    throw validationError("Attempt request and actor identities must be stable and bounded.", { code: "invalid_attempt_identity" });
  }
  if (!Number.isInteger(input.maxOrdinal ?? 3) || (input.maxOrdinal ?? 3) < 1) {
    throw validationError("Attempt limit must be a positive integer.", { code: "invalid_attempt_limit" });
  }
  if (input.mutationOwner !== (input.role === "development")) {
    throw validationError("Only the development role may own mutations; every helper is read-only.", { code: "invalid_mutation_owner" });
  }
  return writeTransaction(db, () => {
    const replay = db.prepare("SELECT * FROM session_role_attempts WHERE request_id = ?").get(input.requestId) as any;
    if (replay) {
      const matches = replay.requirement_id === input.requirementId && replay.input_revision === input.inputRevision &&
        replay.role === input.role && replay.actor_id === input.actorId && replay.mutation_owner === Number(input.mutationOwner);
      if (!matches) throw validationError("Attempt request replay changed identity or input.", { code: "attempt_request_changed" });
      return replay;
    }
    if (input.role === "code-review" || input.role === "qa") {
      const developer = db.prepare(`SELECT actor_id FROM session_role_attempts
        WHERE requirement_id = ? AND input_revision = ? AND role = 'development' ORDER BY ordinal DESC LIMIT 1`)
        .get(input.requirementId, input.inputRevision) as { actor_id: string } | undefined;
      if (developer?.actor_id === input.actorId) {
        throw validationError("Independent review and QA cannot be allocated to the developer.", { code: "independent_actor_required" });
      }
    }
    const previous = db.prepare(`SELECT * FROM session_role_attempts
      WHERE requirement_id = ? AND input_revision = ? AND role = ? ORDER BY ordinal DESC LIMIT 1`)
      .get(input.requirementId, input.inputRevision, input.role) as any;
    if (previous && (previous.status !== "failed" || !input.retryAuthorized)) {
      throw validationError("A next attempt requires an explicitly authorized retry after terminal failure.", { code: "attempt_retry_not_authorized" });
    }
    const ordinal = (previous?.ordinal ?? 0) + 1;
    if (ordinal > (input.maxOrdinal ?? 3)) throw validationError("The bounded attempt limit is exhausted.", { code: "attempt_limit_exhausted" });
    const at = (input.now ?? new Date()).toISOString();
    const row = {
      id: `attempt_${randomUUID().replaceAll("-", "")}`,
      requirement_id: input.requirementId,
      input_revision: input.inputRevision,
      role: input.role,
      ordinal,
      request_id: input.requestId,
      actor_id: input.actorId,
      mutation_owner: Number(input.mutationOwner),
      status: "pending",
      target_head: null,
      criteria_fingerprint: null,
      evidence_fingerprint: null,
      terminal_receipt_json: null,
      created_at: at,
      updated_at: at
    };
    db.prepare(`INSERT INTO session_role_attempts VALUES (
      @id,@requirement_id,@input_revision,@role,@ordinal,@request_id,@actor_id,@mutation_owner,@status,
      @target_head,@criteria_fingerprint,@evidence_fingerprint,@terminal_receipt_json,@created_at,@updated_at
    )`).run(row);
    return row;
  });
}

export function recordSessionRoleAttemptTerminal(db: Database.Database, input: {
  requestId: string; actorId: string; status: "passed" | "failed"; targetHead?: string;
  criteriaFingerprint?: string; evidenceFingerprint?: string; receipt: unknown;
}) {
  return writeTransaction(db, () => {
    const row = db.prepare("SELECT * FROM session_role_attempts WHERE request_id = ?").get(input.requestId) as any;
    if (!row) throw validationError("Attempt does not exist.");
    if (row.actor_id !== input.actorId) throw validationError("Only the allocated actor may finish this attempt.", { code: "attempt_actor_changed" });
    if (row.status === "passed" || row.status === "failed") {
      const unchanged = row.status === input.status && row.target_head === (input.targetHead ?? null) &&
        row.criteria_fingerprint === (input.criteriaFingerprint ?? null) &&
        row.evidence_fingerprint === (input.evidenceFingerprint ?? null) &&
        row.terminal_receipt_json === JSON.stringify(input.receipt);
      if (!unchanged) throw validationError("A terminal attempt receipt is immutable.", { code: "attempt_terminal_changed" });
      return row;
    }
    const developer = db.prepare(`SELECT actor_id FROM session_role_attempts
      WHERE requirement_id = ? AND input_revision = ? AND role = 'development' ORDER BY ordinal DESC LIMIT 1`)
      .get(row.requirement_id, row.input_revision) as { actor_id: string } | undefined;
    if ((row.role === "code-review" || row.role === "qa") && developer?.actor_id === input.actorId) {
      throw validationError("Independent review and QA cannot be supplied by the developer.", { code: "independent_actor_required" });
    }
    if ((row.role === "code-review" || row.role === "qa") && input.status === "passed" &&
      (!input.targetHead || !input.criteriaFingerprint || !input.evidenceFingerprint)) {
      throw validationError("A passing review or QA verdict must bind the exact head, criteria, and evidence.", { code: "verdict_binding_required" });
    }
    const at = new Date().toISOString();
    db.prepare(`UPDATE session_role_attempts SET status = ?, target_head = ?, criteria_fingerprint = ?,
      evidence_fingerprint = ?, terminal_receipt_json = ?, updated_at = ? WHERE request_id = ?`)
      .run(input.status, input.targetHead ?? null, input.criteriaFingerprint ?? null,
        input.evidenceFingerprint ?? null, JSON.stringify(input.receipt), at, input.requestId);
    return db.prepare("SELECT * FROM session_role_attempts WHERE request_id = ?").get(input.requestId);
  });
}

export function attemptVerdictIsCurrent(attempt: any, current: {
  head: string; criteriaFingerprint: string; evidenceFingerprint: string;
}): boolean {
  return attempt?.status === "passed" && attempt.target_head === current.head &&
    attempt.criteria_fingerprint === current.criteriaFingerprint &&
    attempt.evidence_fingerprint === current.evidenceFingerprint;
}

export interface SerialAction { id: string; status: "open" | "done"; dependsOn: string[]; }
export function nextDependencyReadyAction(actions: SerialAction[], productionState: "active" | "off"): SerialAction | null {
  if (productionState === "off") return null;
  const done = new Set(actions.filter(action => action.status === "done").map(action => action.id));
  return actions.find(action => action.status !== "done" && action.dependsOn.every(dependency => done.has(dependency))) ?? null;
}
