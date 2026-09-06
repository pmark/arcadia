import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { writeTransaction } from "../db/connection.js";
import { validationError } from "../cli/errors.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

/**
 * Managed production policy: the durable answer to "may Arcadia admit new
 * work on its own right now, and within exactly what bounds?"
 *
 * Contract 17 splits two things that are easy to confuse. *Active* is a
 * standing permission the operator grants once; *building* is an observation
 * about what happens to be running. This module owns only the permission. It
 * launches nothing, reads no provider, and starts no process — later Actions
 * in this Plan consume `issueAdmission`/`commitAdmission` to do that.
 *
 * Two invariants shape the design:
 *
 * - **Off is durable and fences forward.** Deactivation bumps a monotonic
 *   revision and fences every admission that was issued but not yet committed
 *   to a launch. Work already committed keeps running and is reconciled; it is
 *   identified as existing work, never concealed.
 * - **Absence of an answer is never Inactive.** A policy store that cannot be
 *   read reports `unavailable`. Callers must refuse to admit on `unavailable`
 *   and must not report a confirmed Off, because neither is known.
 */

export type ProductionDesiredState = "active" | "inactive";

/** Mechanical transitions activation may delegate. Judgment is never on this list. */
export type MechanicalTransition = "validation" | "acceptance" | "pointer";

export const MECHANICAL_TRANSITIONS: readonly MechanicalTransition[] = [
  "validation",
  "acceptance",
  "pointer"
];

/**
 * Control values frozen from contract 20 before any live rehearsal. They are
 * constants rather than configuration on purpose: the acceptance evidence has
 * to name the numbers it was measured against.
 */
export const PRODUCTION_CONTROL_DEADLINES = {
  /** Durable Off must be acknowledged within this on a healthy host. */
  offAcknowledgementMs: 2_000,
  /** If persistence is unavailable, the failure must be visible by this. */
  offFailureVisibleMs: 5_000,
  /** Producer tick used by the host worker. */
  producerTickMs: 2_000,
  /** Eligible work should be admitted within this many producer ticks. */
  admissionLatencyTicks: 2,
  /** An issued admission that is never committed expires here. */
  admissionReceiptTtlMs: 30_000,
  /** Finite repair budget per Action, so failures cannot loop on tokens. */
  maxRepairAttemptsPerAction: 2,
  /** Deadline for any single provider call made under this policy. */
  providerCallDeadlineMs: 120_000
} as const;

export interface ProductionScope {
  /** The operator's whole-Plan intent, carried so routine work needs no relay. */
  intent: string;
  projects: string[];
  /** `<project-slug>/<plan-slug>` */
  plans: string[];
  /** Ordered `<project-slug>/<action-id>` keys admitted under this authorization. */
  actions: string[];
  providers: string[];
  maxConcurrentSessions: number;
  mechanicalTransitions: MechanicalTransition[];
}

export interface ProductionAuthorityReceipt {
  requestId: string;
  grantedBy: string;
  grantedAt: string;
  decisionRef: string | null;
  /** Fingerprint of the previewed scope. Activation refuses a different one. */
  scopeFingerprint: string;
}

export interface ProductionPolicyRecord {
  desiredState: ProductionDesiredState;
  revision: number;
  epoch: number;
  scope: ProductionScope | null;
  authority: ProductionAuthorityReceipt | null;
  revokedAt: string | null;
  updatedAt: string;
}

export type ProductionPolicyRead =
  | { status: "ok"; policy: ProductionPolicyRecord; observedAt: string }
  | { status: "unavailable"; reason: string; observedAt: string };

export type AdmissionRefusalCode =
  | "policy_unavailable"
  | "production_inactive"
  | "stale_epoch"
  | "outside_scope"
  | "provider_not_permitted"
  | "concurrency_limit"
  | "admission_expired"
  | "admission_already_settled";

export interface AdmissionRequest {
  requestId: string;
  actionKey: string;
  projectSlug: string;
  planSlug: string;
  provider: string;
  /**
   * Epoch the caller believes it is operating under. A tick that resolved work
   * before an Off/reactivate cycle carries the old epoch and is fenced here.
   */
  expectedEpoch?: number;
  now?: Date;
}

export interface AdmissionReceipt {
  id: string;
  requestId: string;
  actionKey: string;
  projectSlug: string;
  planSlug: string;
  provider: string;
  epoch: number;
  policyRevision: number;
  status: "issued" | "committed" | "released" | "fenced";
  issuedAt: string;
  expiresAt: string;
  committedAt: string | null;
  releasedAt: string | null;
  fencedAt: string | null;
  fencedReason: string | null;
}

export type AdmissionOutcome =
  | { admitted: true; receipt: AdmissionReceipt }
  | { admitted: false; code: AdmissionRefusalCode; reason: string; receipt: AdmissionReceipt | null };

interface PolicyRow {
  desired_state: string;
  revision: number;
  epoch: number;
  scope_json: string | null;
  authority_json: string | null;
  revoked_at: string | null;
  updated_at: string;
}

interface AdmissionRow {
  id: string;
  request_id: string;
  action_key: string;
  project_slug: string;
  plan_slug: string;
  provider: string;
  epoch: number;
  policy_revision: number;
  status: string;
  issued_at: string;
  expires_at: string;
  committed_at: string | null;
  released_at: string | null;
  fenced_at: string | null;
  fenced_reason: string | null;
}

export function ensureProductionPolicyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_policy (
      id TEXT PRIMARY KEY CHECK (id = 'workspace'),
      desired_state TEXT NOT NULL CHECK (desired_state IN ('active', 'inactive')),
      revision INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      scope_json TEXT,
      authority_json TEXT,
      revoked_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO production_policy
      (id, desired_state, revision, epoch, scope_json, authority_json, revoked_at, updated_at)
      VALUES ('workspace', 'inactive', 0, 0, NULL, NULL, NULL, '1970-01-01T00:00:00.000Z');
    CREATE TABLE IF NOT EXISTS production_policy_receipts (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      transition TEXT NOT NULL CHECK (transition IN ('activate', 'deactivate')),
      revision_before INTEGER NOT NULL,
      revision_after INTEGER NOT NULL,
      epoch_after INTEGER NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_admissions (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      action_key TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      plan_slug TEXT NOT NULL,
      provider TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      policy_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('issued', 'committed', 'released', 'fenced')),
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      committed_at TEXT,
      released_at TEXT,
      fenced_at TEXT,
      fenced_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS production_admissions_status
      ON production_admissions (status, epoch);
  `);
}

export function normalizeProductionScope(input: Partial<ProductionScope>): ProductionScope {
  const intent = (input.intent ?? "").trim();
  if (!intent) {
    throw validationError("Production scope needs the operator's whole-Plan intent.", {
      field: "intent"
    });
  }

  const projects = uniqueSorted(input.projects ?? []);
  const plans = uniqueSorted(input.plans ?? []);
  const providers = uniqueSorted(input.providers ?? []);
  // Action order is the authorization's own ordering, so it is preserved, not sorted.
  const actions = dedupePreservingOrder(input.actions ?? []);

  if (projects.length === 0) {
    throw validationError("Production scope needs at least one Project.", { field: "projects" });
  }
  if (plans.length === 0) {
    throw validationError("Production scope needs at least one Plan.", { field: "plans" });
  }
  if (providers.length === 0) {
    throw validationError("Production scope needs at least one permitted provider.", {
      field: "providers"
    });
  }

  const maxConcurrentSessions = input.maxConcurrentSessions ?? 1;
  if (!Number.isInteger(maxConcurrentSessions) || maxConcurrentSessions < 1) {
    throw validationError("Concurrency must be a positive whole number of Sessions.", {
      field: "maxConcurrentSessions",
      value: input.maxConcurrentSessions
    });
  }

  const mechanicalTransitions = uniqueSorted(
    input.mechanicalTransitions ?? []
  ) as MechanicalTransition[];
  for (const transition of mechanicalTransitions) {
    if (!MECHANICAL_TRANSITIONS.includes(transition)) {
      throw validationError(`Unknown mechanical transition "${transition}".`, {
        field: "mechanicalTransitions",
        permitted: [...MECHANICAL_TRANSITIONS]
      });
    }
  }

  return { intent, projects, plans, actions, providers, maxConcurrentSessions, mechanicalTransitions };
}

/** Stable fingerprint of exactly what the operator was shown before granting. */
export function fingerprintProductionScope(scope: ProductionScope): string {
  const canonical = JSON.stringify({
    intent: scope.intent,
    projects: scope.projects,
    plans: scope.plans,
    actions: scope.actions,
    providers: scope.providers,
    maxConcurrentSessions: scope.maxConcurrentSessions,
    mechanicalTransitions: scope.mechanicalTransitions
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function readProductionPolicy(db: Database.Database): ProductionPolicyRecord {
  const row = db
    .prepare(
      `SELECT desired_state, revision, epoch, scope_json, authority_json, revoked_at, updated_at
         FROM production_policy WHERE id = 'workspace'`
    )
    .get() as PolicyRow | undefined;
  if (!row) {
    throw new Error("Production policy row is missing from the workspace store.");
  }
  return {
    desiredState: row.desired_state as ProductionDesiredState,
    revision: row.revision,
    epoch: row.epoch,
    scope: row.scope_json ? (JSON.parse(row.scope_json) as ProductionScope) : null,
    authority: row.authority_json
      ? (JSON.parse(row.authority_json) as ProductionAuthorityReceipt)
      : null,
    revokedAt: row.revoked_at,
    updatedAt: row.updated_at
  };
}

/**
 * The only read the control surface may use. A store that cannot answer
 * reports `unavailable` — the caller shows that, and never an inferred
 * Inactive, because an unknown policy is not a confirmed Off.
 */
export function readProductionPolicySafely(db: Database.Database): ProductionPolicyRead {
  const observedAt = nowIso();
  try {
    return { status: "ok", policy: readProductionPolicy(db), observedAt };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
      observedAt
    };
  }
}

export interface ActivateProductionInput {
  requestId: string;
  scope: ProductionScope;
  scopeFingerprint: string;
  grantedBy: string;
  decisionRef?: string | null;
  /** Revision the operator was shown. A moved policy refuses rather than overwrites. */
  expectedRevision?: number;
  now?: Date;
}

export interface ProductionTransitionResult {
  transition: "activate" | "deactivate";
  policy: ProductionPolicyRecord;
  revisionBefore: number;
  replayed: boolean;
  /** Fenced issued-but-uncommitted admissions; deactivate only. */
  fenced: AdmissionReceipt[];
  /** Committed work that keeps running past the cutoff; deactivate only. */
  committed: AdmissionReceipt[];
  elapsedMs: number;
  withinAcknowledgementDeadline: boolean;
}

export function activateProduction(
  db: Database.Database,
  input: ActivateProductionInput
): ProductionTransitionResult {
  const startedAt = Date.now();
  const at = (input.now ?? new Date()).toISOString();

  const expected = fingerprintProductionScope(input.scope);
  if (expected !== input.scopeFingerprint) {
    throw validationError(
      "Activation scope no longer matches the previewed scope; preview again before granting.",
      { previewed: input.scopeFingerprint, current: expected }
    );
  }

  const result = writeTransaction(db, () => {
    const replay = findTransitionReceipt(db, input.requestId);
    if (replay) {
      return { replayed: true, revisionBefore: replay.revision_before };
    }

    const before = readProductionPolicy(db);
    if (input.expectedRevision !== undefined && input.expectedRevision !== before.revision) {
      throw validationError("Production policy moved since it was previewed.", {
        expectedRevision: input.expectedRevision,
        currentRevision: before.revision
      });
    }

    const authority: ProductionAuthorityReceipt = {
      requestId: input.requestId,
      grantedBy: input.grantedBy,
      grantedAt: at,
      decisionRef: input.decisionRef ?? null,
      scopeFingerprint: input.scopeFingerprint
    };

    db.prepare(
      `UPDATE production_policy
          SET desired_state = 'active', revision = revision + 1, epoch = epoch + 1,
              scope_json = ?, authority_json = ?, revoked_at = NULL, updated_at = ?
        WHERE id = 'workspace'`
    ).run(JSON.stringify(input.scope), JSON.stringify(authority), at);

    const after = readProductionPolicy(db);
    recordTransitionReceipt(db, {
      requestId: input.requestId,
      transition: "activate",
      revisionBefore: before.revision,
      revisionAfter: after.revision,
      epochAfter: after.epoch,
      receipt: { authority, scope: input.scope },
      at
    });
    return { replayed: false, revisionBefore: before.revision };
  });

  const elapsedMs = Date.now() - startedAt;
  return {
    transition: "activate",
    policy: readProductionPolicy(db),
    revisionBefore: result.revisionBefore,
    replayed: result.replayed,
    fenced: [],
    committed: [],
    elapsedMs,
    withinAcknowledgementDeadline: elapsedMs <= PRODUCTION_CONTROL_DEADLINES.offAcknowledgementMs
  };
}

export interface DeactivateProductionInput {
  requestId: string;
  reason?: string;
  now?: Date;
}

/**
 * Off. New admissions stop at once and every issued-but-uncommitted admission
 * is fenced inside the same transaction that flips the state, so the cutoff is
 * exactly "did this admission reach `committed` before Off committed?".
 * Committed work is returned so the caller can name it rather than hide it.
 */
export function deactivateProduction(
  db: Database.Database,
  input: DeactivateProductionInput
): ProductionTransitionResult {
  const startedAt = Date.now();
  const at = (input.now ?? new Date()).toISOString();

  const result = writeTransaction(db, () => {
    const replay = findTransitionReceipt(db, input.requestId);
    if (replay) {
      return { replayed: true, revisionBefore: replay.revision_before, fenced: [] as AdmissionReceipt[] };
    }

    const before = readProductionPolicy(db);
    const pending = listAdmissionRows(db, "issued");

    db.prepare(
      `UPDATE production_policy
          SET desired_state = 'inactive', revision = revision + 1,
              scope_json = NULL, authority_json = NULL, revoked_at = ?, updated_at = ?
        WHERE id = 'workspace'`
    ).run(at, at);

    db.prepare(
      `UPDATE production_admissions
          SET status = 'fenced', fenced_at = ?, fenced_reason = 'production_off'
        WHERE status = 'issued'`
    ).run(at);

    const after = readProductionPolicy(db);
    recordTransitionReceipt(db, {
      requestId: input.requestId,
      transition: "deactivate",
      revisionBefore: before.revision,
      revisionAfter: after.revision,
      epochAfter: after.epoch,
      receipt: {
        reason: input.reason ?? null,
        fencedAdmissions: pending.map((row) => row.request_id)
      },
      at
    });

    return {
      replayed: false,
      revisionBefore: before.revision,
      fenced: pending.map((row) => ({ ...toReceipt(row), status: "fenced" as const, fencedAt: at, fencedReason: "production_off" }))
    };
  });

  const elapsedMs = Date.now() - startedAt;
  return {
    transition: "deactivate",
    policy: readProductionPolicy(db),
    revisionBefore: result.revisionBefore,
    replayed: result.replayed,
    fenced: result.fenced,
    committed: listAdmissionRows(db, "committed").map(toReceipt),
    elapsedMs,
    withinAcknowledgementDeadline: elapsedMs <= PRODUCTION_CONTROL_DEADLINES.offAcknowledgementMs
  };
}

/**
 * Reserve one admission slot. This is a reservation, not a launch: nothing
 * starts until `commitAdmission` redeems it, and Off in between fences it.
 */
export function issueAdmission(db: Database.Database, request: AdmissionRequest): AdmissionOutcome {
  const at = (request.now ?? new Date()).toISOString();
  const expiresAt = new Date(
    Date.parse(at) + PRODUCTION_CONTROL_DEADLINES.admissionReceiptTtlMs
  ).toISOString();

  return writeTransaction(db, () => {
    const existing = findAdmissionRow(db, request.requestId);
    if (existing) {
      const receipt = toReceipt(existing);
      return existing.status === "issued" || existing.status === "committed"
        ? { admitted: true as const, receipt }
        : {
            admitted: false as const,
            code: "admission_already_settled" as const,
            reason: `Admission ${request.requestId} is already ${existing.status}.`,
            receipt
          };
    }

    const read = readProductionPolicySafely(db);
    if (read.status !== "ok") {
      return {
        admitted: false as const,
        code: "policy_unavailable" as const,
        reason: `Production policy is unreadable, so no work may be admitted: ${read.reason}`,
        receipt: null
      };
    }

    const policy = read.policy;
    if (policy.desiredState !== "active" || !policy.scope) {
      return {
        admitted: false as const,
        code: "production_inactive" as const,
        reason: "Managed production is Inactive; no new work is admitted.",
        receipt: null
      };
    }

    if (request.expectedEpoch !== undefined && request.expectedEpoch !== policy.epoch) {
      return {
        admitted: false as const,
        code: "stale_epoch" as const,
        reason: `Admission carries production epoch ${request.expectedEpoch}; the current epoch is ${policy.epoch}.`,
        receipt: null
      };
    }

    const scope = policy.scope;
    const planKey = `${request.projectSlug}/${request.planSlug}`;
    const inScope =
      scope.projects.includes(request.projectSlug) &&
      scope.plans.includes(planKey) &&
      (scope.actions.length === 0 || scope.actions.includes(request.actionKey));
    if (!inScope) {
      return {
        admitted: false as const,
        code: "outside_scope" as const,
        reason: `${request.actionKey} is outside the authorized production scope.`,
        receipt: null
      };
    }

    if (!scope.providers.includes(request.provider)) {
      return {
        admitted: false as const,
        code: "provider_not_permitted" as const,
        reason: `Provider "${request.provider}" is not permitted by this authorization.`,
        receipt: null
      };
    }

    const live = countLiveAdmissions(db, policy.epoch, at);
    if (live >= scope.maxConcurrentSessions) {
      return {
        admitted: false as const,
        code: "concurrency_limit" as const,
        reason: `Authorized concurrency is ${scope.maxConcurrentSessions}; ${live} admissions are live.`,
        receipt: null
      };
    }

    const id = createId("productionAdmission");
    db.prepare(
      `INSERT INTO production_admissions
         (id, request_id, action_key, project_slug, plan_slug, provider, epoch, policy_revision,
          status, issued_at, expires_at, committed_at, released_at, fenced_at, fenced_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, NULL, NULL, NULL, NULL)`
    ).run(
      id, request.requestId, request.actionKey, request.projectSlug, request.planSlug,
      request.provider, policy.epoch, policy.revision, at, expiresAt
    );

    return { admitted: true as const, receipt: toReceipt(findAdmissionRow(db, request.requestId)!) };
  });
}

/**
 * The cutoff. Redeeming an admission re-reads the policy inside the same
 * transaction, so a launch either commits while Active or is fenced — there is
 * no window where both this and `deactivateProduction` believe they won.
 */
export function commitAdmission(
  db: Database.Database,
  requestId: string,
  now?: Date
): AdmissionOutcome {
  const at = (now ?? new Date()).toISOString();

  return writeTransaction(db, () => {
    const row = findAdmissionRow(db, requestId);
    if (!row) {
      return {
        admitted: false as const,
        code: "admission_already_settled" as const,
        reason: `No admission is recorded for ${requestId}.`,
        receipt: null
      };
    }
    if (row.status === "committed") {
      return { admitted: true as const, receipt: toReceipt(row) };
    }
    if (row.status !== "issued") {
      return {
        admitted: false as const,
        code: row.status === "fenced" ? ("production_inactive" as const) : ("admission_already_settled" as const),
        reason: `Admission ${requestId} is ${row.status}${row.fenced_reason ? ` (${row.fenced_reason})` : ""}.`,
        receipt: toReceipt(row)
      };
    }

    const read = readProductionPolicySafely(db);
    if (read.status !== "ok") {
      return {
        admitted: false as const,
        code: "policy_unavailable" as const,
        reason: `Production policy is unreadable, so this launch may not commit: ${read.reason}`,
        receipt: toReceipt(row)
      };
    }

    const policy = read.policy;
    if (policy.desiredState !== "active") {
      fence(db, requestId, "production_off", at);
      return {
        admitted: false as const,
        code: "production_inactive" as const,
        reason: "Managed production went Inactive before this launch was committed.",
        receipt: toReceipt(findAdmissionRow(db, requestId)!)
      };
    }
    if (policy.epoch !== row.epoch) {
      fence(db, requestId, "stale_epoch", at);
      return {
        admitted: false as const,
        code: "stale_epoch" as const,
        reason: `Admission was issued under production epoch ${row.epoch}; the current epoch is ${policy.epoch}.`,
        receipt: toReceipt(findAdmissionRow(db, requestId)!)
      };
    }
    if (Date.parse(at) > Date.parse(row.expires_at)) {
      fence(db, requestId, "admission_expired", at);
      return {
        admitted: false as const,
        code: "admission_expired" as const,
        reason: `Admission expired at ${row.expires_at}; request a fresh one.`,
        receipt: toReceipt(findAdmissionRow(db, requestId)!)
      };
    }

    db.prepare(
      `UPDATE production_admissions SET status = 'committed', committed_at = ? WHERE request_id = ?`
    ).run(at, requestId);
    return { admitted: true as const, receipt: toReceipt(findAdmissionRow(db, requestId)!) };
  });
}

/** Give a slot back when committed work reaches a terminal state, or a reservation is abandoned. */
export function releaseAdmission(
  db: Database.Database,
  requestId: string,
  now?: Date
): AdmissionReceipt | null {
  const at = (now ?? new Date()).toISOString();
  return writeTransaction(db, () => {
    const row = findAdmissionRow(db, requestId);
    if (!row || row.status === "released") {
      return row ? toReceipt(row) : null;
    }
    db.prepare(
      `UPDATE production_admissions SET status = 'released', released_at = ? WHERE request_id = ?`
    ).run(at, requestId);
    return toReceipt(findAdmissionRow(db, requestId)!);
  });
}

export function listAdmissions(
  db: Database.Database,
  status?: AdmissionReceipt["status"]
): AdmissionReceipt[] {
  return listAdmissionRows(db, status).map(toReceipt);
}

/**
 * A committed admission occupies a host slot until it is released, and an
 * Off/reactivate cycle does not end the work it was already running. So
 * committed work counts across every epoch; only unredeemed reservations are
 * scoped to the current one, because Off fences the rest.
 */
export function countLiveAdmissions(db: Database.Database, epoch: number, at: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS live FROM production_admissions
        WHERE status = 'committed'
           OR (status = 'issued' AND epoch = ? AND expires_at > ?)`
    )
    .get(epoch, at) as { live: number };
  return row.live;
}

function fence(db: Database.Database, requestId: string, reason: string, at: string): void {
  db.prepare(
    `UPDATE production_admissions SET status = 'fenced', fenced_at = ?, fenced_reason = ? WHERE request_id = ?`
  ).run(at, reason, requestId);
}

function findAdmissionRow(db: Database.Database, requestId: string): AdmissionRow | undefined {
  return db
    .prepare(`SELECT * FROM production_admissions WHERE request_id = ?`)
    .get(requestId) as AdmissionRow | undefined;
}

function listAdmissionRows(db: Database.Database, status?: string): AdmissionRow[] {
  const sql = status
    ? `SELECT * FROM production_admissions WHERE status = ? ORDER BY issued_at`
    : `SELECT * FROM production_admissions ORDER BY issued_at`;
  const statement = db.prepare(sql);
  return (status ? statement.all(status) : statement.all()) as AdmissionRow[];
}

function toReceipt(row: AdmissionRow): AdmissionReceipt {
  return {
    id: row.id,
    requestId: row.request_id,
    actionKey: row.action_key,
    projectSlug: row.project_slug,
    planSlug: row.plan_slug,
    provider: row.provider,
    epoch: row.epoch,
    policyRevision: row.policy_revision,
    status: row.status as AdmissionReceipt["status"],
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    committedAt: row.committed_at,
    releasedAt: row.released_at,
    fencedAt: row.fenced_at,
    fencedReason: row.fenced_reason
  };
}

function findTransitionReceipt(
  db: Database.Database,
  requestId: string
): { revision_before: number } | undefined {
  return db
    .prepare(`SELECT revision_before FROM production_policy_receipts WHERE request_id = ?`)
    .get(requestId) as { revision_before: number } | undefined;
}

function recordTransitionReceipt(
  db: Database.Database,
  input: {
    requestId: string;
    transition: "activate" | "deactivate";
    revisionBefore: number;
    revisionAfter: number;
    epochAfter: number;
    receipt: unknown;
    at: string;
  }
): void {
  db.prepare(
    `INSERT INTO production_policy_receipts
       (id, request_id, transition, revision_before, revision_after, epoch_after, receipt_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createId("productionPolicyReceipt"), input.requestId, input.transition, input.revisionBefore,
    input.revisionAfter, input.epochAfter, JSON.stringify(input.receipt), input.at
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
