import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import type { GoBrokerAgent } from "../goBroker.js";
import { ENROLLMENT_REQUEST_MODES, ENROLLMENT_RESPONSE_TIMEOUT_MS, type EnrollmentRequestMode } from "./enrollmentRequestProtocol.js";

export const ENROLLMENT_MODES = ENROLLMENT_REQUEST_MODES;
export type EnrollmentMode = EnrollmentRequestMode;
export const SESSION_ATTEMPT_ROLES = ["planner", "critique", "development", "code-review", "qa"] as const;
export type SessionAttemptRole = typeof SESSION_ATTEMPT_ROLES[number];

/**
 * How long a pending enrollment row fences its Action before an exact replay
 * may take it over. It equals the transport's response budget: the host child
 * is killed at its execution timeout, so a row older than this has no live
 * writer and its effect (if any) is observable to `recover`.
 */
export const ENROLLMENT_PENDING_LEASE_MS = ENROLLMENT_RESPONSE_TIMEOUT_MS;

const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export interface EnrollmentClaim { id: string; worktree: string; generation: string | null }
export interface EnrollmentAdmission { id: string; requestId: string; epoch: number; status: string }
export interface EnrollmentPacket { invocationId: string; sha256: string }

export interface GovernedEnrollmentContext {
  projectSlug: string;
  planSlug: string;
  actionId: string;
  canonicalBrief: string;
  operatorGates: string[];
  /** The immutable build packet the host resolved, when one exists. */
  packet?: EnrollmentPacket | null;
  provider: string;
  model: string | null;
  effort: string | null;
  policyState: "active" | "off";
  policyEpoch: number;
  packetApproved: boolean;
  capacityAvailable: boolean;
  existingClaim: EnrollmentClaim | null;
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
  /** Native adoption names only the runtime to observe; supervision is proven by a host adapter. */
  nativeRuntimeId?: string;
}

/** What a host-registered adapter observed about a native runtime. Never caller-asserted. */
export interface NativeRuntimeObservation {
  stableIdentity: boolean;
  liveness: boolean;
  terminalOutcome: boolean;
  recovery: boolean;
}

export interface NativeRuntimeAdapter {
  id: string;
  observe(runtimeId: string): NativeRuntimeObservation;
}

/** The host effect a canonical adapter produced: the one principal, never a second. */
export interface EnrollmentEffect {
  id: string;
  worktree: string;
  claim: EnrollmentClaim | null;
  admission?: EnrollmentAdmission | null;
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
  packet: EnrollmentPacket | null;
  execution: { provider: string; model: string | null; effort: string | null };
  requirementId: string;
  inputRevision: string;
  /** The fenced Action claim the principal holds (candidate ownership), when one exists. */
  claim: EnrollmentClaim | null;
  /** The committed standing-policy admission a managed launch used; null for preparation. */
  admission: EnrollmentAdmission | null;
  principal: { kind: "prepared" | "managed-session" | "native-runtime"; id: string; worktree?: string };
  createdAt: string;
}

export interface EnrollmentAdapterInput {
  request: EnrollmentRequest;
  context: GovernedEnrollmentContext;
}

export interface EnrollmentDependencies {
  resolve(source: string): GovernedEnrollmentContext;
  prepare(input: EnrollmentAdapterInput): EnrollmentEffect;
  launch(input: EnrollmentAdapterInput): EnrollmentEffect;
  rollback?(input: EnrollmentAdapterInput): void;
  /**
   * Reconcile a host effect that may have completed before its receipt was
   * persisted (a lost response or a dead host child). Returns the effect only
   * when it is provably this request's own; otherwise null.
   */
  recover?(input: EnrollmentAdapterInput & { pending: { createdAt: string } }): EnrollmentEffect | null;
  /** The host-registered native adapter for this agent. Production registers none. */
  nativeAdapter?: NativeRuntimeAdapter | null;
  now?: () => Date;
  pendingLeaseMs?: number;
}

/** Canonical, order-fixed replay identity: every field that may change the effect. */
function requestFingerprint(request: EnrollmentRequest): string {
  return createHash("sha256").update(JSON.stringify([
    request.requestId, request.source, request.agent, request.callerId, request.mode,
    request.projectSlug, request.planSlug, request.actionId, request.requirementId,
    request.inputRevision, request.expectedPolicyEpoch ?? null, request.nativeRuntimeId ?? null
  ])).digest("hex");
}

interface EnrollmentRow {
  request_fingerprint: string;
  status: "pending" | "completed";
  receipt_json: string | null;
  created_at: string;
  lease_expires_at: string;
}

/**
 * Refusals that must happen before any row, admission, claim or candidate is
 * written. Every value comes from the host-derived context, not the caller.
 */
function assertEnrollmentPreconditions(request: EnrollmentRequest, context: GovernedEnrollmentContext, dependencies: EnrollmentDependencies): void {
  const expected = [request.projectSlug, request.planSlug, request.actionId];
  const actual = [context.projectSlug, context.planSlug, context.actionId];
  if (expected.some((value, index) => value !== actual[index])) {
    throw validationError("The governed Project, Plan, or Action changed before enrollment.", { code: "enrollment_governance_changed", expected, actual });
  }
  if (request.expectedPolicyEpoch !== undefined && request.expectedPolicyEpoch !== context.policyEpoch) {
    throw validationError("The managed-production policy epoch changed before enrollment.", {
      code: "stale_policy_epoch", expected: request.expectedPolicyEpoch, actual: context.policyEpoch
    });
  }
  if (request.mode === "prepare" && context.existingClaim) {
    // A live claim already names this Action's one principal. Handing it to a
    // second caller would create a duplicate principal; preparation refuses.
    throw validationError("This Action is already claimed by another candidate; enrollment did not hand it out.", {
      code: "action_claimed", claim: context.existingClaim
    });
  }
  if (request.mode === "managed-launch") {
    if (context.policyState === "off") throw validationError("Managed production is Off; enrollment created no admission or claim.", { code: "production_off" });
    if (!context.packetApproved) throw validationError("The governed build packet is not approved.", { code: "packet_approval_required" });
    if (!context.capacityAvailable) throw validationError("No configured provider capacity is available.", { code: "capacity_unavailable" });
  }
  if (request.mode === "native-adopt") {
    const adapter = dependencies.nativeAdapter ?? null;
    const runtimeId = request.nativeRuntimeId;
    const observed = adapter && runtimeId ? adapter.observe(runtimeId) : null;
    if (!observed || !observed.stableIdentity || !observed.liveness || !observed.terminalOutcome || !observed.recovery) {
      throw validationError("The native runtime cannot be durably supervised by this host.", {
        code: "native_runtime_not_supervisable",
        adapter: adapter?.id ?? null,
        observed,
        supportedRoute: { mode: "managed-launch", environment: "ARCADIA_ENROLLMENT_MODE=managed-launch", launcher: `arcadia-enroll-broker-${request.agent}` },
        remedy: "Rerun the fixed enroll launcher with ARCADIA_ENROLLMENT_MODE=managed-launch so launchGuardedHostSession supplies stable identity, liveness, terminal outcome, and recovery."
      });
    }
  }
}

/**
 * Fixed host enrollment. All governed facts are re-derived by `resolve`; the
 * caller can bind expectations but cannot supply a command, packet, worktree,
 * provider, model, claim, gate, adapter verdict, or executable. Effects are
 * delegated only to the canonical prepare/guarded-launch adapters supplied by
 * the host. Enrollment itself grants nothing: a managed launch is admitted only
 * by the existing standing policy, and preparation only by `arcadia go`'s claim.
 */
export function enrollGovernedSession(
  db: Database.Database,
  request: EnrollmentRequest,
  dependencies: EnrollmentDependencies
): EnrollmentReceipt {
  if (!BOUNDED_ID.test(request.requestId)) {
    throw validationError("Enrollment requires a stable bounded request id.", { code: "invalid_enrollment_identity" });
  }
  if (!BOUNDED_ID.test(request.callerId)) {
    throw validationError("Enrollment requires a stable bounded caller identity.", { code: "invalid_enrollment_identity" });
  }
  if (!ENROLLMENT_MODES.includes(request.mode)) {
    throw validationError("Unknown enrollment mode.", { code: "invalid_enrollment_mode", mode: request.mode });
  }
  const clock = dependencies.now ?? (() => new Date());
  const leaseMs = dependencies.pendingLeaseMs ?? ENROLLMENT_PENDING_LEASE_MS;
  const fingerprint = requestFingerprint(request);
  const prior = db.prepare("SELECT request_fingerprint, status, receipt_json, created_at, lease_expires_at FROM session_enrollments WHERE request_id = ?")
    .get(request.requestId) as EnrollmentRow | undefined;

  if (prior) {
    if (prior.request_fingerprint !== fingerprint) {
      throw validationError("Enrollment request id was already used with a different Action, caller, mode, or input.", {
        code: "enrollment_request_changed", requestId: request.requestId
      });
    }
    if (prior.status === "completed" && prior.receipt_json) return JSON.parse(prior.receipt_json) as EnrollmentReceipt;
    // Pending: a host effect may have finished before its receipt was written.
    const context = dependencies.resolve(request.source);
    const recovered = dependencies.recover?.({ request, context, pending: { createdAt: prior.created_at } }) ?? null;
    if (recovered) return completeEnrollment(db, request, context, recovered, prior.created_at, clock);
    const now = clock();
    if (Date.parse(prior.lease_expires_at) > now.getTime()) {
      throw validationError("This exact enrollment request is already in progress.", { code: "enrollment_in_progress", requestId: request.requestId });
    }
    // The earlier writer is gone and left no observable effect. Take the
    // pending row over atomically (compare-and-set on its lease) so two
    // concurrent replays cannot both re-run the effect.
    const taken = writeTransaction(db, () => db.prepare(`UPDATE session_enrollments SET lease_expires_at = ?, updated_at = ?
      WHERE request_id = ? AND status = 'pending' AND lease_expires_at = ?`)
      .run(new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), request.requestId, prior.lease_expires_at).changes === 1);
    if (!taken) throw validationError("This exact enrollment request is already in progress.", { code: "enrollment_in_progress", requestId: request.requestId });
    try {
      assertEnrollmentPreconditions(request, context, dependencies);
    } catch (error) {
      deletePending(db, request.requestId);
      throw error;
    }
    return runEnrollmentEffect(db, request, context, dependencies, prior.created_at, clock);
  }

  const context = dependencies.resolve(request.source);
  assertEnrollmentPreconditions(request, context, dependencies);
  const now = clock();
  const createdAt = now.toISOString();
  try {
    writeTransaction(db, () => {
      db.prepare(`INSERT INTO session_enrollments (
        request_id, request_fingerprint, project_slug, plan_slug, action_id, caller_id, mode, status, receipt_json,
        created_at, updated_at, lease_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`).run(
        request.requestId, fingerprint, context.projectSlug, context.planSlug, context.actionId,
        request.callerId, request.mode, createdAt, createdAt, new Date(now.getTime() + leaseMs).toISOString()
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
  return runEnrollmentEffect(db, request, context, dependencies, createdAt, clock);
}

function deletePending(db: Database.Database, requestId: string): void {
  writeTransaction(db, () => db.prepare("DELETE FROM session_enrollments WHERE request_id = ? AND status = 'pending'").run(requestId));
}

function runEnrollmentEffect(
  db: Database.Database,
  request: EnrollmentRequest,
  context: GovernedEnrollmentContext,
  dependencies: EnrollmentDependencies,
  createdAt: string,
  clock: () => Date
): EnrollmentReceipt {
  try {
    const effect: EnrollmentEffect = request.mode === "prepare"
      ? dependencies.prepare({ request, context })
      : request.mode === "managed-launch"
        ? dependencies.launch({ request, context })
        : { id: request.nativeRuntimeId!, worktree: "", claim: context.existingClaim, admission: null };
    return completeEnrollment(db, request, context, effect, createdAt, clock);
  } catch (error) {
    try { dependencies.rollback?.({ request, context }); } finally { deletePending(db, request.requestId); }
    throw error;
  }
}

function completeEnrollment(
  db: Database.Database,
  request: EnrollmentRequest,
  context: GovernedEnrollmentContext,
  effect: EnrollmentEffect,
  createdAt: string,
  clock: () => Date
): EnrollmentReceipt {
  const kind = request.mode === "prepare" ? "prepared" as const : request.mode === "managed-launch" ? "managed-session" as const : "native-runtime" as const;
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
    packet: context.packet ?? null,
    execution: { provider: context.provider, model: context.model, effort: context.effort },
    requirementId: request.requirementId,
    inputRevision: request.inputRevision,
    claim: effect.claim ?? null,
    admission: effect.admission ?? null,
    principal: kind === "native-runtime" ? { kind, id: effect.id } : { kind, id: effect.id, worktree: effect.worktree },
    createdAt
  };
  const updated = writeTransaction(db, () => db.prepare(`UPDATE session_enrollments SET status = 'completed', receipt_json = ?, updated_at = ?
    WHERE request_id = ? AND status = 'pending'`).run(JSON.stringify(receipt), clock().toISOString(), request.requestId).changes);
  if (updated !== 1) {
    // Another replay completed first; its receipt is the canonical one.
    const row = db.prepare("SELECT receipt_json FROM session_enrollments WHERE request_id = ? AND status = 'completed'")
      .get(request.requestId) as { receipt_json: string } | undefined;
    if (row) return JSON.parse(row.receipt_json) as EnrollmentReceipt;
    throw validationError("The enrollment request row disappeared before its receipt was recorded.", { code: "enrollment_in_progress", requestId: request.requestId });
  }
  return receipt;
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

/** True when this actor ever held a development attempt for the requirement, under any input revision. */
function actedAsDeveloper(db: Database.Database, requirementId: string, actorId: string): boolean {
  return db.prepare(`SELECT 1 FROM session_role_attempts
    WHERE requirement_id = ? AND role = 'development' AND actor_id = ? LIMIT 1`).get(requirementId, actorId) !== undefined;
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
    if ((input.role === "code-review" || input.role === "qa") && actedAsDeveloper(db, input.requirementId, input.actorId)) {
      throw validationError("Independent review and QA cannot be allocated to the developer.", { code: "independent_actor_required" });
    }
    if (input.mutationOwner) {
      // One mutation-owning principal per requirement, across every input
      // revision: a revised input never admits a second concurrent developer.
      const owner = db.prepare(`SELECT request_id FROM session_role_attempts
        WHERE requirement_id = ? AND mutation_owner = 1 AND status IN ('pending', 'running') LIMIT 1`)
        .get(input.requirementId) as { request_id: string } | undefined;
      if (owner) {
        throw validationError("Another development attempt already owns this requirement's mutations.", {
          code: "mutation_owner_active", requestId: owner.request_id
        });
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
    if ((row.role === "code-review" || row.role === "qa") && actedAsDeveloper(db, row.requirement_id, input.actorId)) {
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
