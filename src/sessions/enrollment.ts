import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { normalizeError, validationError } from "../cli/errors.js";
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
 * is killed at its execution timeout. A takeover is safe even if the first
 * writer outlives it, because recovery adopts only positively-identified own
 * effects and the canonical adapters refuse a second claim or lease.
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
  /** Any live claim on this Action, whoever made it. */
  existingClaim: EnrollmentClaim | null;
  /** Any prepared or running Session lease on this repository, whoever launched it. */
  existingSession?: { id: string; worktree: string; actionId: string } | null;
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

/** The durable record of a not-yet-completed request, including the effect marker its adapter wrote atomically. */
export interface EnrollmentPending {
  /** The request this row belongs to (not necessarily the caller's: a stale blocking row is recovered too). */
  requestId: string;
  mode: EnrollmentMode;
  createdAt: string;
  effectClaimId: string | null;
  effectClaimGeneration: string | null;
  effectWorktree: string | null;
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
   * Return this request's own live effect, identified only by positive
   * evidence (the marker its adapter recorded atomically with the claim, or a
   * lease bound to this request's admission). Anything else -- a claim or
   * Session some other caller made -- must return null.
   */
  recover?(input: EnrollmentAdapterInput & { pending: EnrollmentPending }): EnrollmentEffect | null;
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
    request.inputRevision, request.nativeRuntimeId ?? null
  ])).digest("hex");
}

interface EnrollmentRow {
  request_id: string;
  mode: EnrollmentMode;
  request_fingerprint: string;
  status: "pending" | "completed" | "failed";
  receipt_json: string | null;
  created_at: string;
  lease_expires_at: string;
  effect_claim_id: string | null;
  effect_claim_generation: string | null;
  effect_worktree: string | null;
}

const ROW_COLUMNS = `request_id, mode, request_fingerprint, status, receipt_json, created_at, lease_expires_at,
  effect_claim_id, effect_claim_generation, effect_worktree`;

function readRow(db: Database.Database, requestId: string): EnrollmentRow | undefined {
  return db.prepare(`SELECT ${ROW_COLUMNS} FROM session_enrollments WHERE request_id = ?`).get(requestId) as EnrollmentRow | undefined;
}

function pendingView(row: EnrollmentRow): EnrollmentPending {
  return {
    requestId: row.request_id,
    mode: row.mode,
    createdAt: row.created_at,
    effectClaimId: row.effect_claim_id,
    effectClaimGeneration: row.effect_claim_generation,
    effectWorktree: row.effect_worktree
  };
}

/**
 * Called by the preparation adapter (`arcadia go`) inside the same write
 * transaction that creates the Action claim, so the claim and this request's
 * positive evidence of owning it commit together or not at all. Refuses when
 * the request is no longer pending, which rolls the claim back.
 */
export function recordEnrollmentClaim(db: Database.Database, requestId: string, claim: { id: string; worktree_path: string; claim_generation: string | null }): void {
  const changed = db.prepare(`UPDATE session_enrollments SET effect_claim_id = ?, effect_claim_generation = ?, effect_worktree = ?
    WHERE request_id = ? AND status = 'pending'`).run(claim.id, claim.claim_generation, claim.worktree_path, requestId).changes;
  if (changed !== 1) {
    throw validationError("The enrollment request is no longer pending; the candidate claim was not created.", {
      code: "enrollment_request_not_pending", requestId
    });
  }
}

/**
 * Refusals that must happen before any row, admission, claim or candidate is
 * written. Every value comes from the host-derived context, not the caller.
 * `ownEffect` is true only when `recover` positively identified this request's
 * own claim or Session, which then is not a conflict with itself.
 */
function assertEnrollmentPreconditions(
  request: EnrollmentRequest,
  context: GovernedEnrollmentContext,
  dependencies: EnrollmentDependencies,
  ownEffect: boolean
): void {
  const expected = [request.projectSlug, request.planSlug, request.actionId];
  const actual = [context.projectSlug, context.planSlug, context.actionId];
  if (expected.some((value, index) => value !== actual[index])) {
    throw validationError("The governed Project, Plan, or Action changed before enrollment.", { code: "enrollment_governance_changed", expected, actual });
  }
  if (!ownEffect) {
    // Enrollment hands out only a candidate or Session this request creates.
    // A claim or lease anyone else holds -- another helper, the production
    // tick, an operator -- is never re-issued to this caller.
    if (context.existingClaim) {
      throw validationError("This Action is already claimed; enrollment does not hand another owner's candidate or Session to this caller.", {
        code: "action_claimed", claim: context.existingClaim
      });
    }
    const session = context.existingSession ?? null;
    if (session) {
      throw validationError(session.actionId === context.actionId
        ? "This Action already has a prepared or running Session; enrollment does not re-issue it to this caller."
        : "The repository already holds a prepared or running Session for another Action.", {
        code: session.actionId === context.actionId ? "action_claimed" : "repository_leased", sessionId: session.id
      });
    }
  }
  // An effect that already happened (positively recovered) is handed back on
  // governance identity alone; launch gates apply only to new effects.
  if (ownEffect) return;
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

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

/**
 * Fixed host enrollment. All governed facts are re-derived by `resolve`; the
 * caller can bind expectations but cannot supply a command, packet, worktree,
 * provider, model, claim, gate, adapter verdict, or executable. Effects are
 * delegated only to the canonical prepare/guarded-launch adapters supplied by
 * the host. Enrollment itself grants nothing: a managed launch is admitted only
 * by the existing standing policy, and preparation only by `arcadia go`'s claim.
 *
 * Row lifecycle: `pending` while an effect may be in flight (never deleted
 * once an effect may have happened), `completed` with the receipt, `failed`
 * only after recovery found no own effect. A failed row keeps its fingerprint,
 * so a changed replay still refuses and the exact replay may retry.
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
  const prior = readRow(db, request.requestId);

  if (prior) {
    if (prior.request_fingerprint !== fingerprint) {
      throw validationError("Enrollment request id was already used with a different Action, caller, mode, or input.", {
        code: "enrollment_request_changed", requestId: request.requestId
      });
    }
    if (prior.status === "completed" && prior.receipt_json) return JSON.parse(prior.receipt_json) as EnrollmentReceipt;
    const context = dependencies.resolve(request.source);
    // A host effect may have finished before its receipt was written. Only
    // positive evidence of this request's own effect is adopted.
    const recovered = dependencies.recover?.({ request, context, pending: pendingView(prior) }) ?? null;
    if (recovered) {
      assertEnrollmentPreconditions(request, context, dependencies, true);
      return completeEnrollment(db, request, context, recovered, prior.created_at, clock);
    }
    const now = clock();
    if (prior.status === "pending" && Date.parse(prior.lease_expires_at) > now.getTime()) {
      throw validationError("This exact enrollment request is already in progress.", { code: "enrollment_in_progress", requestId: request.requestId });
    }
    // No own effect exists. Refuse before any mutation if the gates no longer
    // hold; a pending row with no effect becomes a failed (retryable) record.
    try {
      assertEnrollmentPreconditions(request, context, dependencies, false);
    } catch (error) {
      if (prior.status === "pending") markFailed(db, request.requestId, prior.lease_expires_at, error, clock);
      throw error;
    }
    // Take the row over atomically (compare-and-set on status and lease) so two
    // concurrent replays cannot both re-run the effect.
    let taken = false;
    const heldLease = new Date(now.getTime() + leaseMs).toISOString();
    try {
      taken = writeTransaction(db, () => db.prepare(`UPDATE session_enrollments SET status = 'pending', lease_expires_at = ?, updated_at = ?, failure_json = NULL
        WHERE request_id = ? AND status = ? AND lease_expires_at = ?`)
        .run(heldLease, now.toISOString(), request.requestId, prior.status, prior.lease_expires_at).changes === 1);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    if (!taken) throw validationError("This exact enrollment request is already in progress.", { code: "enrollment_in_progress", requestId: request.requestId });
    return runEnrollmentEffect(db, request, context, dependencies, prior.created_at, heldLease, clock);
  }

  const context = dependencies.resolve(request.source);
  assertEnrollmentPreconditions(request, context, dependencies, false);
  const now = clock();
  const createdAt = now.toISOString();
  const heldLease = new Date(now.getTime() + leaseMs).toISOString();
  const insert = () => writeTransaction(db, () => {
    db.prepare(`INSERT INTO session_enrollments (
      request_id, request_fingerprint, project_slug, plan_slug, action_id, caller_id, mode, status, receipt_json,
      created_at, updated_at, lease_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`).run(
      request.requestId, fingerprint, context.projectSlug, context.planSlug, context.actionId,
      request.callerId, request.mode, createdAt, createdAt, heldLease
    );
  });
  try {
    insert();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another request's pending row holds this Action. Free it only when its
    // lease expired and recovery proves it left no effect; never hand its
    // effect to this caller.
    freeAbandonedPendingAction(db, request, context, dependencies, now, clock);
    try {
      insert();
    } catch (retryError) {
      if (!isUniqueViolation(retryError)) throw retryError;
      throw validationError("Another enrollment already owns this Action's host transaction.", {
        code: "enrollment_in_progress", projectSlug: context.projectSlug, planSlug: context.planSlug, actionId: context.actionId
      });
    }
  }
  return runEnrollmentEffect(db, request, context, dependencies, createdAt, heldLease, clock);
}

function freeAbandonedPendingAction(
  db: Database.Database,
  request: EnrollmentRequest,
  context: GovernedEnrollmentContext,
  dependencies: EnrollmentDependencies,
  now: Date,
  clock: () => Date
): void {
  const blocker = db.prepare(`SELECT ${ROW_COLUMNS} FROM session_enrollments
    WHERE project_slug = ? AND plan_slug = ? AND action_id = ? AND status = 'pending' AND request_id != ?`)
    .get(context.projectSlug, context.planSlug, context.actionId, request.requestId) as EnrollmentRow | undefined;
  if (!blocker) {
    throw validationError("This exact enrollment request is already in progress.", { code: "enrollment_in_progress", requestId: request.requestId });
  }
  if (Date.parse(blocker.lease_expires_at) > now.getTime()) {
    throw validationError("Another enrollment request is preparing this Action now.", {
      code: "enrollment_in_progress", blockingRequestId: blocker.request_id, leaseExpiresAt: blocker.lease_expires_at,
      remedy: "Wait for that request to finish or for its lease to expire, then request enrollment again."
    });
  }
  const effect = dependencies.recover?.({ request, context, pending: pendingView(blocker) }) ?? null;
  if (effect) {
    throw validationError("An earlier enrollment request already produced this Action's principal; it is not handed to this caller.", {
      code: "action_claimed", blockingRequestId: blocker.request_id,
      remedy: `Only the caller of ${blocker.request_id} may replay it to receive its receipt.`
    });
  }
  markFailed(db, blocker.request_id, blocker.lease_expires_at, validationError("Abandoned: its lease expired with no recoverable effect, freeing the Action for another caller.", {
    code: "enrollment_abandoned", freedFor: request.requestId
  }), clock);
}

/** Only the writer still holding `leaseExpiresAt` may fail the row; a takeover's lease is never clobbered. */
function markFailed(db: Database.Database, requestId: string, leaseExpiresAt: string, error: unknown, clock: () => Date): void {
  const { code, message, details } = normalizeError(error);
  const at = clock().toISOString();
  writeTransaction(db, () => db.prepare(`UPDATE session_enrollments SET status = 'failed', lease_expires_at = ?, updated_at = ?, failure_json = ?
    WHERE request_id = ? AND status = 'pending' AND lease_expires_at = ?`)
    .run(at, at, JSON.stringify({ code, message, refusal: details.code ?? null }), requestId, leaseExpiresAt));
}

function runEnrollmentEffect(
  db: Database.Database,
  request: EnrollmentRequest,
  context: GovernedEnrollmentContext,
  dependencies: EnrollmentDependencies,
  createdAt: string,
  heldLease: string,
  clock: () => Date
): EnrollmentReceipt {
  let effect: EnrollmentEffect;
  try {
    effect = request.mode === "prepare"
      ? dependencies.prepare({ request, context })
      : request.mode === "managed-launch"
        ? dependencies.launch({ request, context })
        : { id: request.nativeRuntimeId!, worktree: "", claim: null, admission: null };
  } catch (error) {
    // The adapter threw, but its effect may still have committed. Adopt it if
    // this request provably owns it; otherwise the row stays a durable record:
    // failed when recovery positively found nothing, pending when even that
    // could not be determined.
    const row = readRow(db, request.requestId);
    const own = row ? dependencies.recover?.({ request, context, pending: pendingView(row) }) ?? null : null;
    if (own) return completeEnrollment(db, request, context, own, createdAt, clock);
    try { dependencies.rollback?.({ request, context }); } finally { markFailed(db, request.requestId, heldLease, error, clock); }
    throw error;
  }
  // Outside the catch: a receipt write that fails (busy database, a racing
  // completion) leaves the row pending for recovery, never deleted.
  return completeEnrollment(db, request, context, effect, createdAt, clock);
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
  const updated = writeTransaction(db, () => db.prepare(`UPDATE session_enrollments SET status = 'completed', receipt_json = ?, updated_at = ?, failure_json = NULL
    WHERE request_id = ? AND status IN ('pending', 'failed')`).run(JSON.stringify(receipt), clock().toISOString(), request.requestId).changes);
  if (updated !== 1) {
    // Another replay completed first; its receipt is the canonical one.
    const row = readRow(db, request.requestId);
    if (row?.status === "completed" && row.receipt_json) return JSON.parse(row.receipt_json) as EnrollmentReceipt;
    throw validationError("The enrollment request row changed before its receipt was recorded.", { code: "enrollment_in_progress", requestId: request.requestId });
  }
  return receipt;
}

/** The exact candidate state an independent verdict judges: head, governed criteria, and validation evidence. */
export interface VerdictBinding {
  targetHead: string;
  criteriaFingerprint: string;
  evidenceFingerprint: string;
}

export interface SessionRoleAttempt {
  id: string;
  requirement_id: string;
  input_revision: string;
  role: SessionAttemptRole;
  ordinal: number;
  request_id: string;
  actor_id: string;
  mutation_owner: number;
  status: "pending" | "running" | "passed" | "failed";
  target_head: string | null;
  criteria_fingerprint: string | null;
  evidence_fingerprint: string | null;
  terminal_receipt_json: string | null;
  created_at: string;
  updated_at: string;
}

export const INDEPENDENT_VERDICT_ROLES = ["code-review", "qa"] as const;
export type IndependentVerdictRole = typeof INDEPENDENT_VERDICT_ROLES[number];
function isVerdictRole(role: string): role is IndependentVerdictRole {
  return (INDEPENDENT_VERDICT_ROLES as readonly string[]).includes(role);
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
  /**
   * Required for code review and QA: the binding a deterministic readiness
   * check produced before any reviewer inference may start. The attempt is
   * pinned to it, and its terminal verdict may never name another.
   */
  binding?: VerdictBinding;
  /**
   * Planner and critique only: the request id of the latest attempt, which
   * passed, that the caller has deterministically shown no longer stands (the
   * launch preview needs planning again under the same input). It allows the
   * next bounded ordinal without pretending the earlier attempt failed.
   */
  supersedesPassed?: string;
  now?: Date;
}

function sameBinding(row: Pick<SessionRoleAttempt, "target_head" | "criteria_fingerprint" | "evidence_fingerprint">, binding: VerdictBinding | undefined): boolean {
  return row.target_head === (binding?.targetHead ?? null) &&
    row.criteria_fingerprint === (binding?.criteriaFingerprint ?? null) &&
    row.evidence_fingerprint === (binding?.evidenceFingerprint ?? null);
}

/** True when this actor ever held a development attempt for the requirement, under any input revision. */
export function actedAsDeveloper(db: Database.Database, requirementId: string, actorId: string): boolean {
  return db.prepare(`SELECT 1 FROM session_role_attempts
    WHERE requirement_id = ? AND role = 'development' AND actor_id = ? LIMIT 1`).get(requirementId, actorId) !== undefined;
}

/** The one pending or running mutation-owning attempt for a requirement, if any (the unique owner index allows at most one). */
export function liveMutationOwner(db: Database.Database, requirementId: string): SessionRoleAttempt | null {
  return (db.prepare(`SELECT * FROM session_role_attempts
    WHERE requirement_id = ? AND mutation_owner = 1 AND status IN ('pending', 'running') LIMIT 1`)
    .get(requirementId) as SessionRoleAttempt | undefined) ?? null;
}

/** The highest-ordinal attempt for one role of one requirement input. */
export function latestRoleAttempt(db: Database.Database, requirementId: string, inputRevision: string, role: SessionAttemptRole): SessionRoleAttempt | null {
  return (db.prepare(`SELECT * FROM session_role_attempts
    WHERE requirement_id = ? AND input_revision = ? AND role = ? ORDER BY ordinal DESC LIMIT 1`)
    .get(requirementId, inputRevision, role) as SessionRoleAttempt | undefined) ?? null;
}

/** Every attempt one role of one requirement input made on an exact head, oldest first. */
export function roleAttemptsOnHead(db: Database.Database, requirementId: string, inputRevision: string, role: SessionAttemptRole, head: string): SessionRoleAttempt[] {
  return db.prepare(`SELECT * FROM session_role_attempts
    WHERE requirement_id = ? AND input_revision = ? AND role = ? AND target_head = ? ORDER BY ordinal`)
    .all(requirementId, inputRevision, role, head) as SessionRoleAttempt[];
}

export function getSessionRoleAttempt(db: Database.Database, requestId: string): SessionRoleAttempt | null {
  return (db.prepare("SELECT * FROM session_role_attempts WHERE request_id = ?").get(requestId) as SessionRoleAttempt | undefined) ?? null;
}

/**
 * pending -> running once the attempt's principal actually started. Idempotent
 * for an already-running attempt; a terminal attempt is never reopened.
 */
export function markSessionRoleAttemptRunning(db: Database.Database, input: { requestId: string; actorId: string; now?: Date }): SessionRoleAttempt {
  return writeTransaction(db, () => {
    const row = getSessionRoleAttempt(db, input.requestId);
    if (!row) throw validationError("Attempt does not exist.", { code: "attempt_missing", requestId: input.requestId });
    if (row.actor_id !== input.actorId) throw validationError("Only the allocated actor may run this attempt.", { code: "attempt_actor_changed" });
    if (row.status === "running") return row;
    if (row.status !== "pending") throw validationError("A terminal attempt is never reopened.", { code: "attempt_terminal", requestId: input.requestId, status: row.status });
    db.prepare("UPDATE session_role_attempts SET status = 'running', updated_at = ? WHERE request_id = ? AND status = 'pending'")
      .run((input.now ?? new Date()).toISOString(), input.requestId);
    return getSessionRoleAttempt(db, input.requestId)!;
  });
}

export function allocateSessionRoleAttempt(db: Database.Database, input: AllocateAttemptInput): SessionRoleAttempt {
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
  const binding = input.binding;
  if (isVerdictRole(input.role) && (!binding?.targetHead || !binding.criteriaFingerprint || !binding.evidenceFingerprint)) {
    // Deterministic readiness precedes inference: no reviewer attempt exists
    // until the exact head, criteria and evidence it will judge are known.
    throw validationError("Code review and QA attempts require the deterministic readiness binding before any reviewer runs.", { code: "verdict_readiness_required" });
  }
  if (!isVerdictRole(input.role) && binding) {
    throw validationError("Only code review and QA attempts carry a verdict binding.", { code: "invalid_attempt_binding" });
  }
  return writeTransaction(db, () => {
    const replay = getSessionRoleAttempt(db, input.requestId);
    if (replay) {
      const matches = replay.requirement_id === input.requirementId && replay.input_revision === input.inputRevision &&
        replay.role === input.role && replay.actor_id === input.actorId && replay.mutation_owner === Number(input.mutationOwner) &&
        (!isVerdictRole(input.role) || sameBinding(replay, binding));
      if (!matches) throw validationError("Attempt request replay changed identity or input.", { code: "attempt_request_changed" });
      return replay;
    }
    if (isVerdictRole(input.role) && actedAsDeveloper(db, input.requirementId, input.actorId)) {
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
    const previous = latestRoleAttempt(db, input.requirementId, input.inputRevision, input.role);
    // A finished verdict on a head, criteria or evidence that has since
    // changed is superseded: judging the new binding is a new attempt, still
    // bounded by the ordinal limit, never a retry of the old one. Re-judging
    // the same binding after a failure is a retry and needs authorization.
    const supersededVerdict = previous !== null && isVerdictRole(input.role) &&
      (previous.status === "passed" || previous.status === "failed") && !sameBinding(previous, binding);
    const supersededHelper = previous !== null && (input.role === "planner" || input.role === "critique") &&
      previous.status === "passed" && input.supersedesPassed === previous.request_id;
    if (previous && !supersededVerdict && !supersededHelper && (previous.status !== "failed" || !input.retryAuthorized)) {
      throw validationError("A next attempt requires an explicitly authorized retry after terminal failure.", {
        code: previous.status === "pending" || previous.status === "running" ? "attempt_in_progress" : "attempt_retry_not_authorized",
        requestId: previous.request_id,
        status: previous.status
      });
    }
    const ordinal = (previous?.ordinal ?? 0) + 1;
    if (ordinal > (input.maxOrdinal ?? 3)) {
      throw validationError("The bounded attempt limit is exhausted.", {
        code: "attempt_limit_exhausted", requirementId: input.requirementId, role: input.role, limit: input.maxOrdinal ?? 3
      });
    }
    const at = (input.now ?? new Date()).toISOString();
    const row: SessionRoleAttempt = {
      id: `attempt_${randomUUID().replaceAll("-", "")}`,
      requirement_id: input.requirementId,
      input_revision: input.inputRevision,
      role: input.role,
      ordinal,
      request_id: input.requestId,
      actor_id: input.actorId,
      mutation_owner: Number(input.mutationOwner),
      status: "pending",
      target_head: binding?.targetHead ?? null,
      criteria_fingerprint: binding?.criteriaFingerprint ?? null,
      evidence_fingerprint: binding?.evidenceFingerprint ?? null,
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
  criteriaFingerprint?: string; evidenceFingerprint?: string; receipt: unknown; now?: Date;
}): SessionRoleAttempt {
  return writeTransaction(db, () => {
    const row = getSessionRoleAttempt(db, input.requestId);
    if (!row) throw validationError("Attempt does not exist.", { code: "attempt_missing", requestId: input.requestId });
    if (row.actor_id !== input.actorId) throw validationError("Only the allocated actor may finish this attempt.", { code: "attempt_actor_changed" });
    // A verdict attempt was pinned to its readiness binding at allocation; its
    // terminal receipt may restate that binding but never name another one.
    const pinned = isVerdictRole(row.role) && row.target_head !== null;
    const targetHead = input.targetHead ?? (pinned ? row.target_head : null);
    const criteriaFingerprint = input.criteriaFingerprint ?? (pinned ? row.criteria_fingerprint : null);
    const evidenceFingerprint = input.evidenceFingerprint ?? (pinned ? row.evidence_fingerprint : null);
    if (row.status === "passed" || row.status === "failed") {
      const unchanged = row.status === input.status && row.target_head === targetHead &&
        row.criteria_fingerprint === criteriaFingerprint &&
        row.evidence_fingerprint === evidenceFingerprint &&
        row.terminal_receipt_json === JSON.stringify(input.receipt);
      if (!unchanged) throw validationError("A terminal attempt receipt is immutable.", { code: "attempt_terminal_changed" });
      return row;
    }
    if (pinned && (targetHead !== row.target_head || criteriaFingerprint !== row.criteria_fingerprint || evidenceFingerprint !== row.evidence_fingerprint)) {
      throw validationError("A verdict may judge only the binding its attempt was allocated for.", { code: "attempt_binding_changed", requestId: input.requestId });
    }
    if (isVerdictRole(row.role) && actedAsDeveloper(db, row.requirement_id, input.actorId)) {
      throw validationError("Independent review and QA cannot be supplied by the developer.", { code: "independent_actor_required" });
    }
    if (isVerdictRole(row.role) && input.status === "passed" && (!targetHead || !criteriaFingerprint || !evidenceFingerprint)) {
      throw validationError("A passing review or QA verdict must bind the exact head, criteria, and evidence.", { code: "verdict_binding_required" });
    }
    const at = (input.now ?? new Date()).toISOString();
    db.prepare(`UPDATE session_role_attempts SET status = ?, target_head = ?, criteria_fingerprint = ?,
      evidence_fingerprint = ?, terminal_receipt_json = ?, updated_at = ? WHERE request_id = ?`)
      .run(input.status, targetHead, criteriaFingerprint, evidenceFingerprint, JSON.stringify(input.receipt), at, input.requestId);
    return getSessionRoleAttempt(db, input.requestId)!;
  });
}

export function attemptVerdictIsCurrent(attempt: Pick<SessionRoleAttempt, "status" | "target_head" | "criteria_fingerprint" | "evidence_fingerprint"> | null | undefined, current: {
  head: string; criteriaFingerprint: string; evidenceFingerprint: string;
}): boolean {
  return attempt?.status === "passed" && attempt.target_head === current.head &&
    attempt.criteria_fingerprint === current.criteriaFingerprint &&
    attempt.evidence_fingerprint === current.evidenceFingerprint;
}
