import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { writeTransaction } from "../db/connection.js";
import { validationError } from "../cli/errors.js";
import type { CapacityAdmissionDecision } from "../codingAgents/capacity.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { getProjectContext, getWorkItemByDocRef, listWorkItemDependencies } from "../db/repositories.js";
import { actionDocRef, parseActionDocRef } from "../docs/types.js";
import type { WorkItem } from "../domain/types.js";
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
export type MechanicalTransition = "validation" | "acceptance" | "pointer" | "packet_approval";

/**
 * The default delegation when a grant names no transitions. `packet_approval`
 * is deliberately absent: approving what a Session will execute is only ever
 * delegated when the operator names it (Decision 0072), never implied.
 */
export const MECHANICAL_TRANSITIONS: readonly MechanicalTransition[] = [
  "validation",
  "acceptance",
  "pointer"
];

/** Every transition a grant may name explicitly. */
export const DELEGABLE_TRANSITIONS: readonly MechanicalTransition[] = [...MECHANICAL_TRANSITIONS, "packet_approval"];

/**
 * The two live-concurrency proofs from
 * docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md (finding
 * F5). `resolveConcurrencyGate` reads these two fixed Plan-qualified refs
 * directly on every admission -- never via `active_plan`/`current_action`,
 * so a later change of active Plan can neither lift nor lock the gate, and
 * reopening either Action restores the cap without deactivating the policy.
 */
export const TWO_ACTION_UNATTENDED_PRODUCTION_PROOF_REF = actionDocRef(
  "bootstrap-managed-production-to-build-flight-deck",
  "prove-two-action-unattended-production"
);
export const CONCURRENT_READY_SET_ADMISSION_PROOF_REF = actionDocRef(
  "bootstrap-managed-production-to-build-flight-deck",
  "prove-concurrent-ready-set-admission"
);
const CONCURRENCY_GATE_PROOF_REFS: readonly string[] = [
  TWO_ACTION_UNATTENDED_PRODUCTION_PROOF_REF,
  CONCURRENT_READY_SET_ADMISSION_PROOF_REF
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
  providerCallDeadlineMs: 120_000,
  /**
   * How long a live tmux Session may show no new pane output and no new
   * Run/receipt activity before it is flagged stalled. Set well above
   * `providerCallDeadlineMs` so one slow provider call or a long build/test
   * step -- real, if quiet, progress -- never trips it; a Session that is
   * flagged still holds its repository lease, so this bounds only how long
   * an operator waits to be told something looks wedged, not any budget.
   */
  stalledSessionDeadlineMs: 20 * 60 * 1000,
  /**
   * The worker tick's unattended review of a preserved candidate PR: GitHub is
   * read at most once per poll interval per candidate, required checks get
   * this long after the PR is first seen ready before the wait escalates, and
   * this many failed review steps (GitHub CLI, push, reviewer capacity or
   * sandbox) on one exact head exhaust its budget until an operator resets it.
   */
  reviewPollIntervalMs: 60_000,
  requiredChecksDeadlineMs: 60 * 60 * 1000,
  maxReviewStepFailures: 3,
  /**
   * The tick-driven reviewer process bound: well under the worker's 30-minute
   * tick ceiling (`MAX_TICK_DURATION_MS`), which the tick re-stamps right
   * before the reviewer starts, so the overlong-tick recovery cannot kill a
   * worker mid-review. A timeout is a reviewer-unavailable failure.
   */
  tickReviewerTimeoutMs: 15 * 60 * 1000,
  /** How long the tick stops reading a PR after GitHub reports a rate limit (no budget spent). */
  reviewRateLimitBackoffMs: 15 * 60 * 1000,
  /** Continuous GitHub rate limiting this long escalates (still without spending the review budget). */
  reviewRateLimitEscalateAfterMs: 6 * 60 * 60 * 1000
} as const;

/**
 * The separately explicit authority a finished, validated Session candidate
 * needs before the host may integrate its agent-owned branch into the governed
 * base branch (Decision 0058). It is deliberately not a `MechanicalTransition`:
 * the policy's validation/acceptance/pointer delegation never implies it, and a
 * grant is revoked by deactivating production because it lives in the active
 * scope. It names the Decision that authorized it and an expiry; the Project,
 * Plan, Action and agent-owned branch are satisfied by the scope plus the
 * Session lease at integration time.
 */
export interface ProductionIntegrationGrant {
  /** The Decision whose answer authorizes bounded candidate integration. */
  decisionRef: string;
  /** ISO instant after which the grant no longer authorizes anything. */
  expiresAt: string;
  /**
   * Ordered `<project-slug>/<action-id>` keys this grant covers. Empty means it
   * covers exactly the scope's own `actions`.
   */
  actions: string[];
}

/**
 * The only way to exceed the concurrency gate's 1-Session cap before both
 * concurrency proofs are `done` (see `resolveConcurrencyGate`). It is not a
 * blanket override: it must explicitly name the one proof it exists to run,
 * and it lapses at its own expiry or -- for free, since deactivation wipes
 * `scope` entirely -- whenever production goes Off.
 */
export interface ProductionRehearsalException {
  /** Must equal `CONCURRENT_READY_SET_ADMISSION_PROOF_REF`; never a blanket override. */
  actionRef: string;
  /** ISO instant after which this exception no longer raises the cap. */
  expiresAt: string;
}

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
  /**
   * Whether this standing authorization includes pushing preserved candidates
   * and opening their draft pull requests. Absent/false keeps preservation
   * local-only; merge, deployment, and publication remain separate gates
   * regardless. See `preserveCandidate`.
   */
  remotePreservation?: boolean;
  /**
   * The optional bounded candidate-integration grant (Decision 0058). Absent
   * means preservation still happens on terminal exit but stops before any
   * merge, reporting the exact operator merge command instead.
   */
  integrationGrant?: ProductionIntegrationGrant;
  /**
   * The optional expiring rehearsal exception that raises the concurrency gate's
   * 1-Session cap for `prove-concurrent-ready-set-admission` specifically. Absent
   * means the gate's ordinary cap applies. See `resolveConcurrencyGate`.
   */
  rehearsalException?: ProductionRehearsalException;
  /**
   * When the `packet_approval` delegation (Decision 0072) lapses. Required
   * whenever `mechanicalTransitions` names `packet_approval` and refused
   * otherwise: the Decision bounds delegated packet approval to an unexpired
   * grant, so it must never outlive its own expiry. Off revokes it sooner.
   */
  packetApprovalExpiresAt?: string;
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
  | "admission_already_settled"
  | "capacity_unproven"
  | "capacity_refused";

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
  /**
   * Proven capacity for `provider`, from `observeProviderCapacity`. Required:
   * unattended admission without a capacity decision is unknown capacity, and
   * unknown capacity is inadmissible. This is the field that makes admission
   * refuse work it used to accept.
   */
  capacity: CapacityAdmissionDecision;
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

/**
 * Scope fields Off retains. This is an allowlist on purpose: any field not named
 * here, including a future authority-bearing one, is dropped across Off and
 * needs a fresh grant (Decision 0072) rather than being carried by default.
 */
const REVIEWED_SCOPE_FIELDS = [
  "intent",
  "projects",
  "plans",
  "actions",
  "providers",
  "maxConcurrentSessions",
  "mechanicalTransitions",
  // Granted only by `production activate --remote-preservation` and bound into
  // the fingerprint, so a reactivation replays exactly what was reviewed; it is
  // never added by Off, reactivation or the dashboard toggle.
  "remotePreservation"
] as const satisfies ReadonlyArray<keyof ProductionScope>;

/** The names of scope fields an Off dropped (grants, exceptions, delegation expiry). */
export type InactiveConfigurationNotCarried = string;

/**
 * The reviewed scope Off retained, kept apart from `production_policy.scope_json`
 * so it can never be mistaken for active authority: every admission gate reads
 * the policy row and requires `desiredState === "active"`. It records what was
 * reviewed (Project, Plan, exact Action allowlist, providers, concurrency,
 * mechanical transitions, and remote preservation when it was granted), never a
 * time-bound grant.
 */
export interface ProductionInactiveConfiguration {
  /** Increments each time an Off from an Active policy saves a configuration. */
  configurationRevision: number;
  /** `fingerprintProductionScope(scope)` of the retained scope. */
  fingerprint: string;
  /** The policy revision the saving Off produced. */
  savedAtPolicyRevision: number;
  /** The epoch whose authorization this configuration was reviewed under. */
  sourceEpoch: number;
  sourceAuthorityRequestId: string | null;
  scope: ProductionScope;
  /** The scope fields present on the active scope that Off deliberately dropped. */
  notCarried: InactiveConfigurationNotCarried[];
  savedAt: string;
}

interface InactiveConfigurationRow {
  configuration_revision: number;
  fingerprint: string;
  saved_at_policy_revision: number;
  source_epoch: number;
  source_authority_request_id: string | null;
  scope_json: string;
  not_carried_json: string;
  saved_at: string;
}

/** Reads the retained configuration; `null` when no Off has saved one. */
export function readInactiveConfiguration(db: Database.Database): ProductionInactiveConfiguration | null {
  const row = db
    .prepare(
      `SELECT configuration_revision, fingerprint, saved_at_policy_revision, source_epoch,
              source_authority_request_id, scope_json, not_carried_json, saved_at
         FROM production_inactive_configuration WHERE id = 'workspace'`
    )
    .get() as InactiveConfigurationRow | undefined;
  if (!row) return null;
  return {
    configurationRevision: row.configuration_revision,
    fingerprint: row.fingerprint,
    savedAtPolicyRevision: row.saved_at_policy_revision,
    sourceEpoch: row.source_epoch,
    sourceAuthorityRequestId: row.source_authority_request_id,
    scope: JSON.parse(row.scope_json) as ProductionScope,
    notCarried: JSON.parse(row.not_carried_json) as InactiveConfigurationNotCarried[],
    savedAt: row.saved_at
  };
}

/** The reviewed bounds of `scope`, with everything else reported as not carried. */
export function reviewedConfigurationOf(scope: ProductionScope): {
  scope: ProductionScope;
  notCarried: InactiveConfigurationNotCarried[];
} {
  const reviewed = {} as Record<string, unknown>;
  for (const field of REVIEWED_SCOPE_FIELDS) {
    if (scope[field] !== undefined) reviewed[field] = scope[field];
  }
  const notCarried = Object.entries(scope)
    .filter(([field, value]) => !(REVIEWED_SCOPE_FIELDS as readonly string[]).includes(field) && value !== undefined && value !== false)
    .map(([field]) => field)
    .sort();
  return { scope: reviewed as unknown as ProductionScope, notCarried };
}

/**
 * Called only inside the Off transaction, and only when an Active scope is
 * about to be cleared: a second Off (or an Off of a never-activated policy)
 * has nothing to retain and must not overwrite what the first one saved.
 */
function saveInactiveConfiguration(
  db: Database.Database,
  before: ProductionPolicyRecord,
  savedAtPolicyRevision: number,
  at: string
): void {
  if (before.desiredState !== "active" || !before.scope) return;
  const { scope, notCarried } = reviewedConfigurationOf(before.scope);
  const previous = db
    .prepare(`SELECT configuration_revision FROM production_inactive_configuration WHERE id = 'workspace'`)
    .get() as { configuration_revision: number } | undefined;
  db.prepare(
    `INSERT INTO production_inactive_configuration
       (id, configuration_revision, fingerprint, saved_at_policy_revision, source_epoch,
        source_authority_request_id, scope_json, not_carried_json, saved_at)
     VALUES ('workspace', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       configuration_revision = excluded.configuration_revision,
       fingerprint = excluded.fingerprint,
       saved_at_policy_revision = excluded.saved_at_policy_revision,
       source_epoch = excluded.source_epoch,
       source_authority_request_id = excluded.source_authority_request_id,
       scope_json = excluded.scope_json,
       not_carried_json = excluded.not_carried_json,
       saved_at = excluded.saved_at`
  ).run(
    (previous?.configuration_revision ?? 0) + 1,
    fingerprintProductionScope(scope),
    savedAtPolicyRevision,
    before.epoch,
    before.authority?.requestId ?? null,
    JSON.stringify(scope),
    JSON.stringify(notCarried),
    at
  );
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
    CREATE TABLE IF NOT EXISTS production_inactive_configuration (
      id TEXT PRIMARY KEY CHECK (id = 'workspace'),
      configuration_revision INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      saved_at_policy_revision INTEGER NOT NULL,
      source_epoch INTEGER NOT NULL,
      source_authority_request_id TEXT,
      scope_json TEXT NOT NULL,
      not_carried_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);
  ensureProductionPolicyReceiptScopeFingerprintColumn(db);
}

/**
 * Rows written before this column existed have no fingerprint on record, so a
 * replay against them stays idempotent rather than refusing on `NULL`
 * mismatched with everything (#704's fix distinguishes "no fingerprint on
 * record" from "a different fingerprint on record").
 */
function ensureProductionPolicyReceiptScopeFingerprintColumn(db: Database.Database): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(production_policy_receipts)").all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
  if (!columns.has("scope_fingerprint")) {
    db.prepare("ALTER TABLE production_policy_receipts ADD COLUMN scope_fingerprint TEXT").run();
  }
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
    if (!DELEGABLE_TRANSITIONS.includes(transition)) {
      throw validationError(`Unknown mechanical transition "${transition}".`, {
        field: "mechanicalTransitions",
        permitted: [...DELEGABLE_TRANSITIONS]
      });
    }
  }

  const normalized: ProductionScope = { intent, projects, plans, actions, providers, maxConcurrentSessions, mechanicalTransitions };
  if (input.remotePreservation === true) normalized.remotePreservation = true;
  if (input.integrationGrant !== undefined) normalized.integrationGrant = normalizeIntegrationGrant(input.integrationGrant);
  if (input.rehearsalException !== undefined) normalized.rehearsalException = normalizeRehearsalException(input.rehearsalException);
  const packetApprovalExpiresAt = normalizePacketApprovalExpiry(mechanicalTransitions, input.packetApprovalExpiresAt);
  if (packetApprovalExpiresAt) normalized.packetApprovalExpiresAt = packetApprovalExpiresAt;
  return normalized;
}

/** A grant with no Decision, no expiry, or a malformed expiry is refused rather than silently absent. */
export function normalizeIntegrationGrant(input: Partial<ProductionIntegrationGrant>): ProductionIntegrationGrant {
  const decisionRef = (input.decisionRef ?? "").trim();
  if (!decisionRef) {
    throw validationError("A candidate-integration grant needs the Decision that authorizes it.", {
      field: "integrationGrant.decisionRef"
    });
  }
  const expiresAt = (input.expiresAt ?? "").trim();
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) {
    throw validationError("A candidate-integration grant needs a valid ISO expiry.", {
      field: "integrationGrant.expiresAt",
      value: input.expiresAt
    });
  }
  return { decisionRef, expiresAt, actions: dedupePreservingOrder(input.actions ?? []) };
}

/**
 * A rehearsal exception with no named Action, no expiry, or a malformed expiry
 * is refused rather than silently absent. Naming anything other than the
 * concurrent-admission proof is refused too: this is an explicit, single-purpose
 * exception, never a blanket concurrency override.
 */
export function normalizeRehearsalException(
  input: Partial<ProductionRehearsalException>
): ProductionRehearsalException {
  const actionRef = (input.actionRef ?? "").trim();
  if (!actionRef) {
    throw validationError("A rehearsal exception needs the Action it exists to prove.", {
      field: "rehearsalException.actionRef"
    });
  }
  if (actionRef !== CONCURRENT_READY_SET_ADMISSION_PROOF_REF) {
    throw validationError(
      `A rehearsal exception may only name ${CONCURRENT_READY_SET_ADMISSION_PROOF_REF}; it is not a blanket concurrency override.`,
      { field: "rehearsalException.actionRef", value: actionRef }
    );
  }
  const expiresAt = parseStrictIsoInstant((input.expiresAt ?? "").trim());
  if (!expiresAt) {
    throw validationError(
      "A rehearsal exception needs a strict RFC 3339 UTC instant, e.g. 2026-09-05T12:00:00.000Z.",
      { field: "rehearsalException.expiresAt", value: input.expiresAt }
    );
  }
  return { actionRef, expiresAt };
}

/**
 * Delegated packet approval without an expiry, or an expiry without the
 * delegation it bounds, is refused rather than silently absent (Decision 0072).
 */
function normalizePacketApprovalExpiry(
  mechanicalTransitions: MechanicalTransition[],
  raw: string | undefined
): string | null {
  const delegated = mechanicalTransitions.includes("packet_approval");
  const trimmed = (raw ?? "").trim();
  if (!delegated) {
    if (trimmed) {
      throw validationError("A packet-approval expiry needs the packet_approval transition it bounds.", {
        field: "packetApprovalExpiresAt",
        value: raw
      });
    }
    return null;
  }
  const expiresAt = parseStrictIsoInstant(trimmed);
  if (!expiresAt) {
    throw validationError(
      "Delegating packet_approval needs a strict RFC 3339 UTC expiry, e.g. 2026-09-05T12:00:00.000Z.",
      { field: "packetApprovalExpiresAt", value: raw }
    );
  }
  return expiresAt;
}

/**
 * A strict RFC 3339 UTC instant: requires an explicit `Z` offset and rejects
 * any date/time that round-trips to a different UTC instant than its literal
 * calendar fields imply -- `Date.parse`/`Date.UTC` both silently normalize an
 * impossible date like "2026-02-30" instead of rejecting it, which would let
 * a mistyped expiry quietly extend the one exception that lifts the
 * concurrency cap. Returns the canonical `toISOString()` spelling so the
 * fingerprint and every display use one spelling; `null` when invalid.
 */
function parseStrictIsoInstant(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction] = match;
  const milliseconds = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  const instant = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), milliseconds
  );
  const date = new Date(instant);
  const roundTrips =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second);
  return roundTrips ? date.toISOString() : null;
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
    mechanicalTransitions: scope.mechanicalTransitions,
    // Omitted from the canonical form unless enabled, so scopes that predate
    // remote preservation keep their exact fingerprint.
    ...(scope.remotePreservation ? { remotePreservation: true } : {}),
    // Same rule for the integration grant: an absent grant must not change a
    // pre-existing scope's fingerprint.
    ...(scope.integrationGrant
      ? { integrationGrant: { decisionRef: scope.integrationGrant.decisionRef, expiresAt: scope.integrationGrant.expiresAt, actions: scope.integrationGrant.actions } }
      : {}),
    // Same rule again for the rehearsal exception.
    ...(scope.rehearsalException
      ? { rehearsalException: { actionRef: scope.rehearsalException.actionRef, expiresAt: scope.rehearsalException.expiresAt } }
      : {}),
    // And for the packet-approval expiry.
    ...(scope.packetApprovalExpiresAt ? { packetApprovalExpiresAt: scope.packetApprovalExpiresAt } : {})
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * The one gate both preservation paths (the worker's terminal handoff and
 * `arcadia preserve`) read before pushing a candidate and opening its draft pull
 * request. Only an Active policy whose scope was granted with
 * `--remote-preservation`, and only for an Action that scope names, qualifies;
 * there is no environment or dashboard override. It never authorizes marking a
 * pull request ready or merging it.
 */
export function policyAuthorizesRemotePreservation(
  policy: Pick<ProductionPolicyRecord, "desiredState" | "scope">,
  actionKey: string
): boolean {
  return (
    policy.desiredState === "active" &&
    policy.scope?.remotePreservation === true &&
    policy.scope.actions.includes(actionKey)
  );
}

/**
 * The one gate the worker tick reads before it pushes a later settled head to a
 * host-preserved draft pull request, marks it ready, waits on its checks and
 * runs the independent code-review and QA reviewers for it. Readiness is not
 * part of `--remote-preservation` (push and draft PR at preservation only); it
 * is treated as a step of landing that exact candidate, so it needs both: the
 * remote-preservation authority under which the host created the PR, and a
 * current Decision 0058 candidate-integration grant naming the Action. Whether
 * Decision 0058 should be read to cover this push, readiness and reviewer
 * spend is an operator question this gate does not settle. Merge on GitHub
 * and pushing the base branch stay outside every grant.
 */
export function policyAuthorizesPullRequestReadiness(
  policy: Pick<ProductionPolicyRecord, "desiredState" | "scope">,
  actionKey: string,
  now: Date
): { authorized: true } | { authorized: false; reason: string } {
  if (policy.desiredState !== "active" || !policy.scope) return { authorized: false, reason: "Managed production is Off." };
  const scope = policy.scope;
  if (!scope.actions.includes(actionKey)) return { authorized: false, reason: `${actionKey} is outside the active production scope.` };
  if (!policyAuthorizesRemotePreservation(policy, actionKey)) {
    return { authorized: false, reason: "The active grant does not include `--remote-preservation`, so the host created no pull request it may ready." };
  }
  const grant = scope.integrationGrant;
  if (!grant) return { authorized: false, reason: "The active grant records no candidate-integration grant (Decision 0058)." };
  if (!(grant.actions.length > 0 ? grant.actions : scope.actions).includes(actionKey)) {
    return { authorized: false, reason: `The candidate-integration grant does not name ${actionKey}.` };
  }
  if (Number.isNaN(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now.getTime()) {
    return { authorized: false, reason: `The candidate-integration grant expired at ${grant.expiresAt}.` };
  }
  return { authorized: true };
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

/** The Project/Plan/Action a caller wants checked against an active policy's scope. */
export interface PolicyScopeIdentity {
  projectSlug: string;
  /** `<project-slug>/<plan-slug>` */
  planKey: string;
  /** `<project-slug>/<action-id>`, when this preparation is for one known Action. */
  actionKey?: string | null;
}

/**
 * `identity`'s own project/plan/action against `scope`, mirroring
 * `buildLaunchPreview`'s in-scope test (launchPreview.ts) so a policy grant
 * for one Project/Plan never reaches into unrelated work: an empty
 * `scope.actions` permits every Action in the selected Project and Plan.
 */
function isWithinPolicyScope(scope: ProductionScope, identity: PolicyScopeIdentity): boolean {
  return (
    scope.projects.includes(identity.projectSlug) &&
    scope.plans.includes(identity.planKey) &&
    (scope.actions.length === 0 || (identity.actionKey != null && scope.actions.includes(identity.actionKey)))
  );
}

/**
 * The Project/Plan/Action identity of a work item with a managed `plan/<slug>#<id>`
 * document reference, for `selectPolicyPermittedProfileName`'s scope check. Returns
 * null when the work item has no resolvable managed document reference or Project --
 * an ad hoc or cross-repository work item a standing policy was never written about.
 */
export function resolveWorkItemPolicyIdentity(db: Database.Database, workItem: WorkItem): PolicyScopeIdentity | null {
  if (!workItem.doc_ref || !workItem.project_id) {
    return null;
  }
  const parsedRef = parseActionDocRef(workItem.doc_ref);
  if (!parsedRef) {
    return null;
  }
  const projectSlug = getProjectContext(db, workItem.project_id)?.project.slug;
  if (!projectSlug) {
    return null;
  }
  return {
    projectSlug,
    planKey: `${projectSlug}/${parsedRef.planSlug}`,
    actionKey: `${projectSlug}/${parsedRef.actionId}`
  };
}

/**
 * The build/planning profile a fresh packet should bind to, so packet
 * preparation never hands a deterministic registry default to an immutable
 * packet the standing policy's own scope will then refuse forever
 * (CodeRabbit, PR #586): once bound, a packet's provider cannot be changed
 * except by preparing a new one, so getting this right happens before
 * preparation, not after. Returns null -- meaning "use the default" -- when
 * no policy is Active, the Active policy has no provider scope, `identity` is
 * absent, `identity` falls outside the active policy's own Project/Plan/Action
 * scope (CodeRabbit, PR #646: a policy grant for one Project must never steer
 * an unrelated Project's preparation), or no available profile of this
 * purpose satisfies the permitted providers; a caller preparing a packet
 * still throws its own clear error in that last case, or (see
 * `buildLaunchPreview`) a mismatch is reported as a named launch prerequisite
 * once the packet exists, rather than silently binding an unpermitted
 * provider. Shared by every build-packet preparation path -- `work plan`,
 * `ask`, and planning promotion -- so each prefers a policy-permitted
 * provider whenever the caller did not request one explicitly and can name
 * the identity being prepared for.
 */
export function selectPolicyPermittedProfileName(
  db: Database.Database,
  profiles: CodingAgentProfile[],
  purpose: "build" | "planning",
  identity?: PolicyScopeIdentity | null
): string | null {
  return selectPolicyPermittedProfileNames(db, profiles, purpose, identity)[0] ?? null;
}

/**
 * Every profile name `selectPolicyPermittedProfileName` would consider, in
 * `profiles` order, instead of only the first: the first policy-permitted
 * profile is not guaranteed to satisfy a specific work item's execution
 * requirement (capability, tools, context scope, locality, effort, sandbox),
 * and `selectAgentProfileForWorkItem`'s `requestedName` is a strict filter
 * with no fallback -- passing an incompliant single name throws
 * `ExecutionProfileUnsatisfiedError` instead of trying the next permitted
 * provider (CodeRabbit, PR #646, fix round 2). Callers that can check
 * compliance (`selectCompliantPolicyPermittedProfileName` in
 * `src/codex/packets.ts`) should try these in order; callers that cannot
 * (`production/tick.ts`'s automatic planning resolution, already guarded by
 * its own catch) may keep using the singular form above.
 */
export function selectPolicyPermittedProfileNames(
  db: Database.Database,
  profiles: CodingAgentProfile[],
  purpose: "build" | "planning",
  identity?: PolicyScopeIdentity | null
): string[] {
  if (!identity) {
    return [];
  }
  const policyRead = readProductionPolicySafely(db);
  if (policyRead.status !== "ok" || policyRead.policy.desiredState !== "active" || !policyRead.policy.scope) {
    return [];
  }
  const scope = policyRead.policy.scope;
  if (!isWithinPolicyScope(scope, identity)) {
    return [];
  }
  return profiles.filter((profile) => profile.purpose === purpose && scope.providers.includes(profile.provider)).map((profile) => profile.name);
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

  const result = writeTransaction(db, () => applyProductionActivation(db, input, at));

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

/**
 * The activation write itself. The caller owns the surrounding `writeTransaction`
 * and has already checked that `input.scopeFingerprint` matches `input.scope`;
 * `reactivateProduction` runs its own drift checks inside the same transaction,
 * so nothing can move between the check and this write.
 */
export function applyProductionActivation(
  db: Database.Database,
  input: ActivateProductionInput,
  at: string,
  receiptExtra: Record<string, unknown> = {}
): { replayed: boolean; revisionBefore: number } {
  const replay = findTransitionReceipt(db, input.requestId);
  if (replay) {
    assertReceiptTransition(replay, input.requestId, "activate");
    if (replay.scope_fingerprint !== null && replay.scope_fingerprint !== input.scopeFingerprint) {
      throw validationError(
        "This request id already activated a different scope; replaying it now would silently keep that scope instead of granting the one just requested. Use a new request id.",
        {
          requestId: input.requestId,
          previousRevision: replay.revision_before,
          previousScopeFingerprint: replay.scope_fingerprint,
          requestedScopeFingerprint: input.scopeFingerprint
        }
      );
    }
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
    receipt: { authority, scope: input.scope, ...receiptExtra },
    at,
    scopeFingerprint: input.scopeFingerprint
  });
  return { replayed: false, revisionBefore: before.revision };
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
      assertReceiptTransition(replay, input.requestId, "deactivate");
      return { replayed: true, revisionBefore: replay.revision_before, fenced: [] as AdmissionReceipt[] };
    }

    const before = readProductionPolicy(db);
    const pending = listAdmissionRows(db, "issued");

    // Saved in the same transaction that clears the scope, so no restart can
    // observe "scope gone, nothing retained".
    saveInactiveConfiguration(db, before, before.revision + 1, at);

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

export interface ConcurrencyGateStatus {
  /** Whether the gate is currently restricting concurrency below the scope's own configured maximum. */
  closed: boolean;
  /** The concurrency `issueAdmission` actually enforces right now. */
  effectiveMaxConcurrentSessions: number;
  /** The proof Actions not yet `done`; empty once the gate is open. */
  blockingActionRefs: string[];
  /** Whether an unexpired rehearsal exception is currently raising the cap. */
  exceptionActive: boolean;
  /** Explanation of why the effective cap differs from the scope's own; `null` when it does not. */
  reason: string | null;
}

/**
 * Whether `actionRef` -- every remainder Action named in its own
 * `split_into` (recursively, in case a remainder was itself later split),
 * AND every Action its own `depends_on` names (recursively) -- is also
 * `done`.
 *
 * A split narrows a proof Action to its finished slice and marks it `done`,
 * but that leaves the rest of its declared scope in one or more remainder
 * Actions. A status check alone would read the narrowed Action as satisfied
 * and open the gate early; `split_into` is what `docs sync` mirrors from the
 * Plan onto the work item specifically so a DB-only reader like this one can
 * still see the open remainder.
 *
 * That is a distinct failure mode from an ordinary reopened prerequisite: a
 * proof Action can be `done` with no `split_into` at all, yet still have a
 * `depends_on` prerequisite that was reopened after the proof itself was
 * marked done. `split_into` is deliberately never folded into `depends_on`
 * (folding it in risks closing a dependency cycle -- see `src/ask/settlement.ts`),
 * so both checks must run, not one instead of the other.
 *
 * `seen` guards a cycle in either edge set. A `split_into` cycle should never
 * exist -- settlement only ever writes it once, onto a freshly narrowed
 * Action, never onto a remainder -- and a `depends_on` cycle is refused at
 * parse time, but this walk must not assume either invariant holds.
 */
function isActionRefDone(db: Database.Database, actionRef: string, seen: Set<string> = new Set()): boolean {
  if (seen.has(actionRef)) return true;
  seen.add(actionRef);
  const item = getWorkItemByDocRef(db, actionRef);
  if (!item || item.status !== "done") return false;
  if (item.split_into_json) {
    const remainderRefs = JSON.parse(item.split_into_json) as string[];
    const remaindersDone = remainderRefs.every((remainderId) => {
      const parsed = parseActionDocRef(actionRef);
      const remainderRef = parsed ? actionDocRef(parsed.planSlug, remainderId) : remainderId;
      return isActionRefDone(db, remainderRef, seen);
    });
    if (!remaindersDone) return false;
  }
  return listWorkItemDependencies(db, item.id).every((dependency) =>
    dependency.docRef
      ? isActionRefDone(db, dependency.docRef, seen)
      : isWorkItemChainDone(db, dependency.workItemId, dependency.status, seen)
  );
}

/**
 * Whether `workItemId` (already known to have `status`) and every Action its
 * own `depends_on` names, recursively, is `done`. The `depends_on` half of
 * `isActionRefDone`'s two checks, walking `work_item_dependencies` by id
 * rather than by doc ref since that is what `listWorkItemDependencies` keys
 * on.
 *
 * A dependency row this walk reaches may itself be a split, done proof with
 * an open remainder -- `docs sync` mirrors `split_into` onto the work item by
 * doc ref, not by internal id, so a dependency that carries a `docRef` is
 * routed back through `isActionRefDone` (which checks `split_into` too)
 * rather than trusted on status alone; only a dependency with no `docRef` at
 * all (recorded outside ingestion) falls back to this depends_on-only walk.
 */
function isWorkItemChainDone(db: Database.Database, workItemId: string, status: string, seen: Set<string>): boolean {
  if (status !== "done") return false;
  if (seen.has(workItemId)) return true;
  seen.add(workItemId);
  return listWorkItemDependencies(db, workItemId).every((dependency) =>
    dependency.docRef
      ? isActionRefDone(db, dependency.docRef, seen)
      : isWorkItemChainDone(db, dependency.workItemId, dependency.status, seen)
  );
}

function isConcurrencyProofDone(db: Database.Database, actionRef: string): boolean {
  return isActionRefDone(db, actionRef);
}

/**
 * Whether managed production may run above one Session at a time, re-evaluated
 * fresh on every call rather than cached at activation (CodeRabbit finding F5,
 * docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md): a proof
 * Action that gets reopened after this returned "open" must restore the cap on
 * the very next admission, with no separate deactivate/reactivate step, and a
 * later change of `active_plan` must not move this check at all -- it reads
 * `CONCURRENCY_GATE_PROOF_REFS` directly, never the active-plan pointer.
 */
export function resolveConcurrencyGate(
  db: Database.Database,
  scope: ProductionScope,
  at: string
): ConcurrencyGateStatus {
  const blockingActionRefs = CONCURRENCY_GATE_PROOF_REFS.filter(
    (ref) => !isConcurrencyProofDone(db, ref)
  );
  if (blockingActionRefs.length === 0) {
    return {
      closed: false,
      effectiveMaxConcurrentSessions: scope.maxConcurrentSessions,
      blockingActionRefs: [],
      exceptionActive: false,
      reason: null
    };
  }

  const exception = scope.rehearsalException;
  const exceptionActive = Boolean(
    exception &&
      exception.actionRef === CONCURRENT_READY_SET_ADMISSION_PROOF_REF &&
      Date.parse(at) < Date.parse(exception.expiresAt)
  );

  if (exceptionActive) {
    return {
      closed: true,
      effectiveMaxConcurrentSessions: scope.maxConcurrentSessions,
      blockingActionRefs,
      exceptionActive: true,
      reason:
        `The concurrency cap is raised to ${scope.maxConcurrentSessions} by the rehearsal exception for ` +
        `${CONCURRENT_READY_SET_ADMISSION_PROOF_REF}, expiring ${exception!.expiresAt}. The general gate stays ` +
        `closed until ${CONCURRENCY_GATE_PROOF_REFS.join(" and ")} are done.`
    };
  }

  return {
    closed: true,
    effectiveMaxConcurrentSessions: 1,
    blockingActionRefs,
    exceptionActive: false,
    reason:
      `Concurrency is capped at 1 (not the configured ${scope.maxConcurrentSessions}) until ` +
      `${CONCURRENCY_GATE_PROOF_REFS.join(" and ")} are done.`
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

    const capacityRefusal = refuseOnCapacity(request);
    if (capacityRefusal) return capacityRefusal;

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
    const gate = resolveConcurrencyGate(db, scope, at);
    if (live >= gate.effectiveMaxConcurrentSessions) {
      return {
        admitted: false as const,
        code: "concurrency_limit" as const,
        reason: gate.reason
          ? `${gate.reason} ${live} admission(s) are live.`
          : `Authorized concurrency is ${gate.effectiveMaxConcurrentSessions}; ${live} admissions are live.`,
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
 * Capacity is checked before the policy is even read, because an unprovable
 * provider is a refusal regardless of what the operator authorized. Both
 * refusals carry the visible reason from the capacity receipt itself rather than
 * a generic message, so the person reading the queue learns what to fix.
 */
function refuseOnCapacity(
  request: AdmissionRequest
): { admitted: false; code: AdmissionRefusalCode; reason: string; receipt: null } | null {
  const capacity = request.capacity;
  if (!capacity) {
    return {
      admitted: false,
      code: "capacity_unproven",
      reason:
        `No provider capacity decision accompanied this admission, so ${request.provider} capacity is ` +
        `unknown. Unattended admission treats unknown capacity as inadmissible.`,
      receipt: null
    };
  }
  if (capacity.providerId !== request.provider) {
    return {
      admitted: false,
      code: "capacity_unproven",
      reason:
        `The capacity decision describes ${capacity.providerId} but this admission would run on ` +
        `${request.provider}. Capacity proven for one provider never admits another.`,
      receipt: null
    };
  }
  if (!capacity.admitted) {
    return {
      admitted: false,
      code: "capacity_refused",
      reason: capacity.reason,
      receipt: null
    };
  }
  return null;
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
 *
 * A "committed" admission whose Session has already reached a terminal
 * outcome is a vacated slot regardless of whether `releaseAdmission` actually
 * ran (`reconcileSessionExit` is the normal writer, but a crash or an older
 * database can leave the row stuck at `committed` — see Issue #610). Two
 * checks exclude it, from most to least precise:
 *
 *  - exact: `agent_sessions.admission_request_id` names this Session's own
 *    committed admission, and that Session is terminal.
 *  - legacy: the admission predates that column (still NULL on every Session
 *    sharing its `action_key`), so fall back to the action itself -- but only
 *    when *no* Session for that exact action_key is currently prepared or
 *    running. That guard is load-bearing: it is what stops this fallback from
 *    ever mistaking a live concurrent Session's own admission for a vacated
 *    one merely because an older, unrelated attempt at the same Action once
 *    finished.
 */
export function countLiveAdmissions(db: Database.Database, epoch: number, at: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS live FROM production_admissions pa
        WHERE (
          pa.status = 'committed'
          AND NOT EXISTS (
            SELECT 1 FROM agent_sessions s
             WHERE s.admission_request_id = pa.request_id
               AND s.status IN ('completed', 'failed', 'needs_input')
          )
          AND NOT (
            NOT EXISTS (
              SELECT 1 FROM agent_sessions s2
               WHERE (s2.project_slug || '/' || s2.action_id) = pa.action_key
                 AND s2.status IN ('prepared', 'running')
            )
            AND EXISTS (
              SELECT 1 FROM agent_sessions s3
               WHERE (s3.project_slug || '/' || s3.action_id) = pa.action_key
                 AND s3.status IN ('completed', 'failed', 'needs_input')
            )
          )
        )
        OR (pa.status = 'issued' AND pa.epoch = ? AND pa.expires_at > ?)`
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

/**
 * The already-recorded transition for this request id, if any. Exported because
 * a caller that validates the *current* queue before activating has to ask this
 * first: idempotency outranks validation, or a retry after the queue moved — or
 * after a named Project was paused — becomes a refusal instead of the receipt it
 * should replay.
 */
export function findTransitionReceipt(
  db: Database.Database,
  requestId: string
): { transition: "activate" | "deactivate"; revision_before: number; scope_fingerprint: string | null } | undefined {
  return db
    .prepare(`SELECT transition, revision_before, scope_fingerprint FROM production_policy_receipts WHERE request_id = ?`)
    .get(requestId) as
    | { transition: "activate" | "deactivate"; revision_before: number; scope_fingerprint: string | null }
    | undefined;
}

/**
 * `request_id` is unique across both transitions, so a reused id may belong to
 * the other kind. Replaying it would report a transition that never happened.
 */
export function assertReceiptTransition(
  receipt: { transition: "activate" | "deactivate" },
  requestId: string,
  expected: "activate" | "deactivate"
): void {
  if (receipt.transition === expected) return;
  throw validationError(
    `This request id already recorded ${receipt.transition === "activate" ? "an activation" : "a deactivation"}, not ${expected === "activate" ? "an activation" : "a deactivation"}; replaying it would report a transition that did not happen. Use a new request id.`,
    { conflict: true, requestId, recorded: receipt.transition, requested: expected }
  );
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
    scopeFingerprint?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO production_policy_receipts
       (id, request_id, transition, revision_before, revision_after, epoch_after, receipt_json, created_at, scope_fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createId("productionPolicyReceipt"), input.requestId, input.transition, input.revisionBefore,
    input.revisionAfter, input.epochAfter, JSON.stringify(input.receipt), input.at,
    input.scopeFingerprint ?? null
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
