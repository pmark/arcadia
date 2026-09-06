import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodingAgentProfile } from "../intent/registries.js";
import { codingAgentLabel } from "./adapters.js";
import type {
  CodingAgentAvailability,
  CodingAgentAvailabilityRecord,
  CodingAgentAvailabilitySnapshot,
  CodingAgentBankedReset,
  CodingAgentCreditState
} from "./availability.js";
import { observeCodingAgentAvailability, refreshClaudeCodeUsageTelemetry } from "./availability.js";
import type {
  CodingAgentSelectionInput,
  SelectedCodingAgentConfiguration
} from "./providerAdapters.js";
import {
  ExecutionProfileUnsatisfiedError,
  selectCompliantCodingAgent
} from "./providerAdapters.js";

/**
 * Provider capacity as an admission input.
 *
 * `availability.ts` already reads what each configured provider will tell this
 * host. It answers "is it worth trying?" and deliberately treats `unknown` as
 * eligible, because a person is watching. Unattended admission cannot make that
 * assumption: contract 17 is explicit that unavailable, stale or unknown
 * capacity "cannot mean unlimited or free". This module is the other reading of
 * the same observations — it normalizes them into one provider-neutral receipt
 * and then refuses on anything it cannot actually prove.
 *
 * Three lines run through the whole file:
 *
 * - **Unknown is a refusal, not a maybe.** Every path that cannot name a real
 *   observed window, its age, and whether the usage was included or paid ends in
 *   a refusal carrying the reason a person would need to fix it.
 * - **An elapsed reset is not renewed allowance.** A reset time that has passed
 *   invalidates the observation that predicted it; the only thing that readmits
 *   work is a *fresh observation* taken after the reset.
 * - **Real and simulated never look alike.** Every receipt is stamped `real` or
 *   `simulated`, and an operator's manual attestation is admissible but is
 *   labeled as attended and expires, so it can never stand in as proof of
 *   indefinitely unattended operation.
 *
 * Nothing here invokes a model. Capacity is observed with deterministic reads of
 * host telemetry the provider already exposes, under a deadline and a bounded
 * backoff — polling a quota is never worth a token.
 */

export type CapacityUsagePolicy = "included" | "paid" | "unknown";

export type CapacitySource =
  /** Codex's local app server, `account/rateLimits/read`. */
  | "codex_app_server"
  /** Claude Code usage snapshot, refreshed from Claude's own usage service. */
  | "claude_usage_snapshot"
  /** A bounded, explicitly recorded operator attestation. */
  | "operator_receipt"
  /** Nothing on this host reported capacity for the provider. */
  | "none";

export type CapacityConfidence = "observed" | "attested" | "unknown";

export type CapacityFreshness = "fresh" | "stale" | "unknown";

/** Whether the receipt describes this host's real provider state or a stand-in. */
export type CapacityEvidenceMode = "real" | "simulated";

export type CapacityRefusalCode =
  | "capacity_unknown"
  | "capacity_stale"
  | "usage_policy_unknown"
  | "capacity_exhausted"
  | "capacity_reserve_margin"
  | "manual_receipt_expired";

/**
 * One window the provider actually supports. Labels are the provider's own —
 * contract 17 forbids inventing a comparable daily or weekly number so two
 * providers can be lined up in a table.
 */
export interface CapacityWindow {
  label: string;
  usedPercentage: number;
  remainingPercentage: number;
  resetsAt: string | null;
}

export interface ProviderCapacityReceipt {
  version: 1;
  providerId: string;
  providerLabel: string;
  profiles: string[];
  /** Which account this describes, without secrets or identity claims. */
  accountScope: string;
  source: CapacitySource;
  evidence: CapacityEvidenceMode;
  /** True only when no person had to act for this observation to exist. */
  unattended: boolean;
  observedAt: string | null;
  observedAgeMs: number | null;
  /** Bounded validity, for an operator attestation. Null for observations. */
  expiresAt: string | null;
  confidence: CapacityConfidence;
  freshness: CapacityFreshness;
  usagePolicy: CapacityUsagePolicy;
  usagePolicyReason: string;
  windows: CapacityWindow[];
  /** Earliest reset across the reported windows, when any is known. */
  nextResetAt: string | null;
  /** Purchased credits, reported independently of included allowance. */
  credits: CodingAgentCreditState | null;
  /** Banked resets the provider holds. Shown so a person can see one; never redeemed. */
  bankedResets: CodingAgentBankedReset[];
  /** The account plan or tier, when the provider names one. */
  planScope: string | null;
  /** Receipt fields this host cannot report, named rather than guessed. */
  unsupported: string[];
  availability: CodingAgentAvailability;
  telemetry: string;
}

export interface CapacityAdmissionDecision {
  providerId: string;
  admitted: boolean;
  code: CapacityRefusalCode | null;
  /** The reason a person reads when work does not start. Always populated. */
  reason: string;
  /**
   * True only when the admission rests on an automatic observation. An operator
   * attestation admits work but is never proof of unattended operation.
   */
  unattendedProof: boolean;
  /** When it is worth observing again: a known reset, or null for "on refresh". */
  retryAfter: string | null;
  /** A fresh observation is required before this provider can be reconsidered. */
  refreshRequired: boolean;
  receipt: ProviderCapacityReceipt;
}

export interface ProviderCapacityObservation {
  generatedAt: string;
  providers: CapacityAdmissionDecision[];
}

/**
 * Frozen alongside `PRODUCTION_CONTROL_DEADLINES` and for the same reason: the
 * acceptance evidence has to be able to name the numbers it was measured
 * against.
 */
export const CAPACITY_ADMISSION_LIMITS = {
  /** An observation older than this cannot admit unattended work. */
  observationFreshnessMs: 15 * 60_000,
  /** Stop admitting before the window is spent, so a Run has room to finish. */
  reserveMarginPercentage: 5,
  /** An operator attestation is bounded; it never becomes standing proof. */
  operatorReceiptMaxTtlMs: 4 * 60 * 60_000,
  /** Deadline for one capacity refresh pass across all providers. */
  refreshDeadlineMs: 15_000,
  /** Bounded backoff between refresh attempts. Its length is the attempt cap. */
  refreshBackoffMs: [1_000, 5_000, 20_000]
} as const;

export const CAPACITY_MAX_REFRESH_ATTEMPTS = CAPACITY_ADMISSION_LIMITS.refreshBackoffMs.length;

/**
 * Fields the receipt contract defines. Each one is reported as unsupported
 * unless this host actually produced it, so an absent number is always visible
 * as absent rather than quietly reading as zero.
 */
const CONTRACT_FIELDS = [
  "allowanceWindows",
  "remainingTokens",
  "creditBalance",
  "bankedResets",
  "planScope",
  "accountIdentity"
] as const;

export interface CapacityObservationOptions {
  now?: Date;
  /** Inject an availability snapshot instead of reading the host. */
  snapshot?: CodingAgentAvailabilitySnapshot;
  /** Inject operator attestations instead of reading the receipt store. */
  operatorReceipts?: OperatorCapacityReceiptStore;
  /** Force how receipts are stamped. Defaults to what this host can prove. */
  evidence?: CapacityEvidenceMode;
}

/**
 * Read every configured provider's capacity and decide, per provider, whether
 * unattended work may be admitted against it right now.
 */
export function observeProviderCapacity(
  profiles: CodingAgentProfile[],
  options: CapacityObservationOptions = {}
): ProviderCapacityObservation {
  const now = options.now ?? new Date();
  const snapshot = options.snapshot ?? observeCodingAgentAvailability(profiles, now);
  const attestations = options.operatorReceipts ?? readOperatorCapacityReceipts();
  const configured = configuredProviders(profiles);

  return {
    generatedAt: now.toISOString(),
    providers: configured.map((providerId) => {
      const record = snapshot.agents.find((agent) => agent.providerId === providerId) ?? null;
      const receipt = buildProviderCapacityReceipt({
        providerId,
        profiles,
        record,
        now,
        attestation: attestations.receipts[providerId] ?? null,
        evidence: options.evidence
      });
      return evaluateCapacityAdmission(receipt, now);
    })
  };
}

export interface BuildCapacityReceiptInput {
  providerId: string;
  profiles: CodingAgentProfile[];
  record: CodingAgentAvailabilityRecord | null;
  now: Date;
  attestation?: OperatorCapacityReceipt | null;
  evidence?: CapacityEvidenceMode;
}

/**
 * Normalize one provider's observed state into the receipt contract. An
 * automatic observation always wins; the operator attestation is consulted only
 * when the host reported no usable window, which is what makes it a fallback
 * rather than a way to talk over live telemetry.
 */
export function buildProviderCapacityReceipt(
  input: BuildCapacityReceiptInput
): ProviderCapacityReceipt {
  const providerProfiles = input.profiles.filter((profile) => profile.provider === input.providerId);
  const label = providerProfiles[0] ? codingAgentLabel(providerProfiles[0]) : input.providerId;
  const evidence = input.evidence ?? resolveEvidenceMode(input.providerId);
  const base = {
    version: 1 as const,
    providerId: input.providerId,
    providerLabel: label,
    profiles: providerProfiles.map((profile) => profile.name),
    accountScope: accountScope(input.providerId),
    evidence
  };

  const windows = (input.record?.rateLimits ?? []).map((limit) => ({
    label: limit.label,
    usedPercentage: limit.usedPercentage,
    remainingPercentage: roundPercentage(100 - limit.usedPercentage),
    resetsAt: limit.resetsAt
  }));

  if (windows.length > 0 && input.record) {
    const observedAt = input.record.capturedAt;
    const policy = resolveUsagePolicy(input.providerId, true, input.record.planScope);
    return {
      ...base,
      unsupported: unsupportedFields({
        windows,
        credits: input.record.credits,
        bankedResets: input.record.bankedResets,
        planScope: input.record.planScope
      }),
      credits: input.record.credits,
      bankedResets: input.record.bankedResets,
      planScope: input.record.planScope,
      source: observationSource(input.providerId),
      unattended: true,
      observedAt,
      observedAgeMs: ageMs(observedAt, input.now),
      expiresAt: null,
      confidence: observedAt ? "observed" : "unknown",
      freshness: freshnessOf(observedAt, windows, input.now),
      usagePolicy: policy.policy,
      usagePolicyReason: policy.reason,
      windows,
      nextResetAt: earliestReset(windows),
      availability: input.record.availability,
      telemetry: input.record.telemetry
    };
  }

  if (input.attestation) {
    const attested = input.attestation;
    return {
      ...base,
      unsupported: unsupportedFields({
        windows: attested.windows,
        credits: null,
        bankedResets: [],
        planScope: null
      }),
      credits: null,
      bankedResets: [],
      planScope: null,
      source: "operator_receipt",
      unattended: false,
      observedAt: attested.recordedAt,
      observedAgeMs: ageMs(attested.recordedAt, input.now),
      expiresAt: attested.expiresAt,
      confidence: "attested",
      freshness: Date.parse(attested.expiresAt) <= input.now.getTime() ? "stale" : "fresh",
      usagePolicy: attested.usagePolicy,
      usagePolicyReason:
        `${attested.grantedBy} attested ${attested.usagePolicy} usage at ${attested.recordedAt}.`,
      windows: attested.windows,
      nextResetAt: earliestReset(attested.windows),
      availability: input.record?.availability ?? "unknown",
      telemetry:
        `Operator attestation by ${attested.grantedBy}, valid until ${attested.expiresAt}. ` +
        `Attended evidence: it is not proof of unattended operation.` +
        (attested.note ? ` Note: ${attested.note}` : "")
    };
  }

  return {
    ...base,
    unsupported: unsupportedFields({ windows: [], credits: null, bankedResets: [], planScope: null }),
    credits: input.record?.credits ?? null,
    bankedResets: input.record?.bankedResets ?? [],
    planScope: input.record?.planScope ?? null,
    source: "none",
    unattended: true,
    observedAt: input.record?.capturedAt ?? null,
    observedAgeMs: ageMs(input.record?.capturedAt ?? null, input.now),
    expiresAt: null,
    confidence: "unknown",
    freshness: "unknown",
    usagePolicy: "unknown",
    usagePolicyReason:
      `No supported surface on this host reported whether ${label} usage is included or paid.`,
    windows: [],
    nextResetAt: null,
    availability: input.record?.availability ?? "unknown",
    telemetry: input.record?.telemetry ?? `No ${label} capacity telemetry is available on this host.`
  };
}

/**
 * Decide admission from one receipt. The order of the checks is the order a
 * person would want the reason in: can we see anything, is what we see current,
 * do we know what it costs, and is there room left.
 */
export function evaluateCapacityAdmission(
  receipt: ProviderCapacityReceipt,
  now = new Date()
): CapacityAdmissionDecision {
  const refuse = (
    code: CapacityRefusalCode,
    reason: string,
    extra: { retryAfter?: string | null; refreshRequired?: boolean } = {}
  ): CapacityAdmissionDecision => ({
    providerId: receipt.providerId,
    admitted: false,
    code,
    reason,
    unattendedProof: false,
    retryAfter: extra.retryAfter ?? null,
    refreshRequired: extra.refreshRequired ?? true,
    receipt
  });

  if (receipt.source === "operator_receipt" && receipt.expiresAt
    && Date.parse(receipt.expiresAt) <= now.getTime()) {
    return refuse(
      "manual_receipt_expired",
      `The operator capacity attestation for ${receipt.providerLabel} expired at ${receipt.expiresAt}. ` +
        `A bounded manual receipt is never standing proof; observe or re-attest capacity.`
    );
  }

  if (receipt.windows.length === 0 || receipt.confidence === "unknown" || !receipt.observedAt) {
    return refuse(
      "capacity_unknown",
      `${receipt.providerLabel} capacity is unknown on this host (${receipt.telemetry}). ` +
        `Unattended admission treats unknown capacity as inadmissible, never as unlimited or free.`
    );
  }

  const elapsedReset = receipt.windows.find((window) =>
    window.resetsAt
    && Date.parse(window.resetsAt) <= now.getTime()
    && Date.parse(window.resetsAt) > Date.parse(receipt.observedAt!));
  if (elapsedReset) {
    return refuse(
      "capacity_stale",
      `${receipt.providerLabel}'s ${elapsedReset.label} window reset at ${elapsedReset.resetsAt}, ` +
        `after this observation was taken at ${receipt.observedAt}. An elapsed reset is not proof of ` +
        `renewed allowance; a fresh observation is required before readmitting work. ${receipt.telemetry}`
    );
  }

  if (receipt.freshness !== "fresh"
    || (receipt.observedAgeMs ?? Number.POSITIVE_INFINITY) > CAPACITY_ADMISSION_LIMITS.observationFreshnessMs) {
    return refuse(
      "capacity_stale",
      `${receipt.providerLabel} capacity was last observed at ${receipt.observedAt} ` +
        `(${describeAge(receipt.observedAgeMs)}), past the ` +
        `${CAPACITY_ADMISSION_LIMITS.observationFreshnessMs / 60_000}-minute freshness limit for unattended admission. ` +
        `${receipt.telemetry}`
    );
  }

  if (receipt.usagePolicy === "unknown") {
    return refuse(
      "usage_policy_unknown",
      `Whether ${receipt.providerLabel} usage is included or paid could not be established ` +
        `(${receipt.usagePolicyReason}). Unattended admission will not promise zero spend it cannot prove.`
    );
  }

  const worst = receipt.windows.reduce((left, right) =>
    right.usedPercentage > left.usedPercentage ? right : left);
  if (worst.usedPercentage >= 100) {
    const banked = receipt.bankedResets.filter((reset) => reset.status === "available");
    return refuse(
      "capacity_exhausted",
      `${receipt.providerLabel}'s ${worst.label} window is spent (${formatPercentage(worst.usedPercentage)} used). ` +
        `Work waits for the observed reset; credits are never purchased and paid fallback is never enabled to keep busy.` +
        (banked.length > 0
          ? ` ${banked.length} banked reset(s) are available on this account and are deliberately not redeemed.`
          : ""),
      { retryAfter: worst.resetsAt }
    );
  }

  const ceiling = 100 - CAPACITY_ADMISSION_LIMITS.reserveMarginPercentage;
  if (worst.usedPercentage >= ceiling) {
    return refuse(
      "capacity_reserve_margin",
      `${receipt.providerLabel}'s ${worst.label} window is at ${formatPercentage(worst.usedPercentage)}, ` +
        `inside the ${CAPACITY_ADMISSION_LIMITS.reserveMarginPercentage}% reserve margin that keeps an ` +
        `admitted Run able to finish. New admission stops at the boundary.`,
      { retryAfter: worst.resetsAt }
    );
  }

  return {
    providerId: receipt.providerId,
    admitted: true,
    code: null,
    reason: receipt.unattended
      ? `${receipt.providerLabel} reported ${describeWindows(receipt.windows)} of ${receipt.usagePolicy} ` +
        `allowance, observed ${describeAge(receipt.observedAgeMs)} via ${receipt.source}.`
      : `${receipt.providerLabel} capacity rests on a bounded operator attestation valid until ` +
        `${receipt.expiresAt}. Work is admitted, but this is attended evidence and is not proof of ` +
        `unattended operation.`,
    unattendedProof: receipt.unattended,
    retryAfter: receipt.nextResetAt,
    refreshRequired: false,
    receipt
  };
}

/**
 * The earliest moment it is worth looking again. Callers waiting on capacity use
 * this instead of polling: a known reset is a real event, and everything else
 * waits for the next refresh pass.
 */
export function nextCapacityCheckAt(
  decisions: CapacityAdmissionDecision[],
  now = new Date()
): string | null {
  const candidates = decisions
    .filter((decision) => !decision.admitted && decision.retryAfter)
    .map((decision) => Date.parse(decision.retryAfter!))
    .filter((value) => Number.isFinite(value) && value > now.getTime());
  return candidates.length > 0 ? new Date(Math.min(...candidates)).toISOString() : null;
}

/** Bounded backoff for refresh attempt `attempt` (0-based). Null past the cap. */
export function capacityRefreshBackoffMs(attempt: number): number | null {
  return CAPACITY_ADMISSION_LIMITS.refreshBackoffMs[attempt] ?? null;
}

export interface CapacityRefreshResult {
  attempted: boolean;
  attempts: number;
  elapsedMs: number;
  withinDeadline: boolean;
  observation: ProviderCapacityObservation;
}

/**
 * Refresh observations through the paths `availability.ts` already owns, under
 * one deadline. Deliberately not a poll loop: it makes at most
 * `CAPACITY_MAX_REFRESH_ATTEMPTS` passes, sleeps the bounded backoff between
 * them, and gives up with an honest unknown rather than spending more.
 *
 * No model is invoked here, or anywhere this module reaches. Polling a quota is
 * a deterministic read; paying a frontier model to do it would be the exact
 * inversion of the economy rule.
 */
export async function refreshProviderCapacity(
  profiles: CodingAgentProfile[],
  options: CapacityObservationOptions & { deadlineMs?: number } = {}
): Promise<CapacityRefreshResult> {
  const deadlineMs = options.deadlineMs ?? CAPACITY_ADMISSION_LIMITS.refreshDeadlineMs;
  const startedAt = Date.now();
  let attempts = 0;
  let observation = observeProviderCapacity(profiles, options);

  while (
    attempts < CAPACITY_MAX_REFRESH_ATTEMPTS
    && observation.providers.some((decision) => decision.refreshRequired)
    && Date.now() - startedAt < deadlineMs
  ) {
    if (attempts > 0) {
      const backoff = capacityRefreshBackoffMs(attempts - 1) ?? 0;
      const remaining = deadlineMs - (Date.now() - startedAt);
      if (remaining <= 0) break;
      await delay(Math.min(backoff, remaining));
    }
    attempts += 1;
    const before = observationSignature(observation);
    await refreshClaudeCodeUsageTelemetry(options.now ?? new Date(), { force: attempts > 1 });
    observation = observeProviderCapacity(profiles, { ...options, snapshot: undefined });
    // A pass that moved nothing will not move anything on the next one either —
    // a missing credential does not appear because it was asked three times.
    if (observationSignature(observation) === before) break;
  }

  const elapsedMs = Date.now() - startedAt;
  return {
    attempted: attempts > 0,
    attempts,
    elapsedMs,
    withinDeadline: elapsedMs <= deadlineMs,
    observation
  };
}

// ---------------------------------------------------------------------------
// Operator attestation: an honest fallback, bounded on purpose
// ---------------------------------------------------------------------------

export interface OperatorCapacityReceipt {
  providerId: string;
  grantedBy: string;
  usagePolicy: Exclude<CapacityUsagePolicy, "unknown">;
  windows: CapacityWindow[];
  note: string | null;
  recordedAt: string;
  expiresAt: string;
}

export interface OperatorCapacityReceiptStore {
  version: 1;
  receipts: Record<string, OperatorCapacityReceipt>;
}

export interface RecordOperatorCapacityReceiptInput {
  providerId: string;
  grantedBy: string;
  usagePolicy: Exclude<CapacityUsagePolicy, "unknown">;
  windows: CapacityWindow[];
  ttlMs: number;
  note?: string | null;
  now?: Date;
}

/**
 * Record one bounded attestation. The TTL is capped rather than trusted: an
 * attestation that could be written with an unbounded lifetime would quietly
 * become the standing unattended proof this design refuses to allow.
 */
export function recordOperatorCapacityReceipt(
  input: RecordOperatorCapacityReceiptInput
): OperatorCapacityReceipt {
  const now = input.now ?? new Date();
  const ttlMs = Math.min(
    Math.max(input.ttlMs, 60_000),
    CAPACITY_ADMISSION_LIMITS.operatorReceiptMaxTtlMs
  );
  const receipt: OperatorCapacityReceipt = {
    providerId: input.providerId,
    grantedBy: input.grantedBy,
    usagePolicy: input.usagePolicy,
    windows: input.windows,
    note: input.note ?? null,
    recordedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString()
  };

  const store = readOperatorCapacityReceipts();
  store.receipts[input.providerId] = receipt;
  writeOperatorCapacityReceipts(store);
  return receipt;
}

export function readOperatorCapacityReceipts(): OperatorCapacityReceiptStore {
  const filePath = operatorReceiptPath();
  if (!existsSync(filePath)) return { version: 1, receipts: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<OperatorCapacityReceiptStore>;
    return parsed.version === 1 && parsed.receipts && typeof parsed.receipts === "object"
      ? { version: 1, receipts: parsed.receipts }
      : { version: 1, receipts: {} };
  } catch {
    return { version: 1, receipts: {} };
  }
}

function writeOperatorCapacityReceipts(store: OperatorCapacityReceiptStore): void {
  const filePath = operatorReceiptPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

function operatorReceiptPath(): string {
  return process.env.ARCADIA_CAPACITY_RECEIPTS_PATH
    ?? path.join(os.homedir(), ".arcadia", "telemetry", "capacity-receipts.json");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function configuredProviders(profiles: CodingAgentProfile[]): string[] {
  return [...new Set(profiles.map((profile) => profile.provider))].sort();
}

function observationSource(providerId: string): CapacitySource {
  if (providerId === "codex-cli") return "codex_app_server";
  if (providerId === "claude-code-cli") return "claude_usage_snapshot";
  return "none";
}

function accountScope(providerId: string): string {
  if (providerId === "codex-cli") return "Local Codex account signed in on this host";
  if (providerId === "claude-code-cli") return "Local Claude Code account signed in on this host";
  return `Local ${providerId} configuration on this host`;
}

/**
 * A receipt must never let a fixture pass for the real account. Simulated is the
 * conclusion whenever the observation came from a fixture or a test run.
 */
function resolveEvidenceMode(providerId: string): CapacityEvidenceMode {
  if (process.env.ARCADIA_CAPACITY_EVIDENCE_MODE === "simulated") return "simulated";
  if (providerId === "codex-cli" && process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE) return "simulated";
  if (process.env.VITEST) return "simulated";
  return "real";
}

/**
 * Included versus paid is decided only from signals this host actually exposes.
 * Both providers report plan allowance windows exclusively for included
 * subscription usage, so a reported window is real evidence of included mode;
 * an API key configured for the same provider is real evidence that usage may be
 * billed instead. Anything else stays unknown, which refuses rather than
 * promising zero spend.
 */
function unsupportedFields(observed: {
  windows: CapacityWindow[];
  credits: CodingAgentCreditState | null;
  bankedResets: CodingAgentBankedReset[];
  planScope: string | null;
}): string[] {
  const reported = new Set<string>();
  if (observed.windows.length > 0) reported.add("allowanceWindows");
  if (observed.credits) reported.add("creditBalance");
  if (observed.bankedResets.length > 0) reported.add("bankedResets");
  if (observed.planScope) reported.add("planScope");
  return CONTRACT_FIELDS.filter((field) => !reported.has(field));
}

function resolveUsagePolicy(
  providerId: string,
  hasWindows: boolean,
  planScope: string | null
): { policy: CapacityUsagePolicy; reason: string } {
  if (providerId === "claude-code-cli") {
    const billingKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
    if (billingKey) {
      return {
        policy: "paid",
        reason: "An Anthropic API credential is configured on this host, so Claude Code usage may be billed as API spend rather than drawn from subscription allowance."
      };
    }
    if (hasWindows) {
      return {
        policy: "included",
        reason: "Claude's usage service reported subscription allowance windows, which exist only for included plan usage."
      };
    }
  }

  if (providerId === "codex-cli") {
    if (hasWindows) {
      return {
        policy: "included",
        reason: planScope
          ? `The Codex app server reported plan rate-limit windows for the ${planScope} plan, which exist only for included usage.`
          : "The Codex app server reported plan rate-limit windows, which exist only for included ChatGPT plan usage."
      };
    }
    if (process.env.OPENAI_API_KEY) {
      return {
        policy: "paid",
        reason: "No plan allowance window was reported and an OpenAI API credential is configured, so Codex usage may be billed as API spend."
      };
    }
  }

  return {
    policy: "unknown",
    reason: `No supported surface established whether ${providerId} usage is included or paid.`
  };
}

function freshnessOf(
  observedAt: string | null,
  windows: CapacityWindow[],
  now: Date
): CapacityFreshness {
  if (!observedAt) return "unknown";
  const age = ageMs(observedAt, now);
  if (age === null) return "unknown";
  if (age > CAPACITY_ADMISSION_LIMITS.observationFreshnessMs) return "stale";
  const observedMs = Date.parse(observedAt);
  const rolled = windows.some((window) =>
    window.resetsAt
    && Date.parse(window.resetsAt) <= now.getTime()
    && Date.parse(window.resetsAt) > observedMs);
  return rolled ? "stale" : "fresh";
}

function ageMs(observedAt: string | null, now: Date): number | null {
  if (!observedAt) return null;
  const parsed = Date.parse(observedAt);
  return Number.isFinite(parsed) ? Math.max(0, now.getTime() - parsed) : null;
}

function earliestReset(windows: CapacityWindow[]): string | null {
  const resets = windows
    .map((window) => window.resetsAt)
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)))
    .sort();
  return resets[0] ?? null;
}

function roundPercentage(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatPercentage(value: number): string {
  return `${roundPercentage(value)}%`;
}

function describeAge(ageMsValue: number | null): string {
  if (ageMsValue === null) return "at an unknown time";
  if (ageMsValue < 60_000) return "less than a minute ago";
  const minutes = Math.floor(ageMsValue / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function describeWindows(windows: CapacityWindow[]): string {
  return windows
    .map((window) => `${formatPercentage(window.remainingPercentage)} remaining in its ${window.label} window`)
    .join(" and ");
}

function observationSignature(observation: ProviderCapacityObservation): string {
  return observation.providers
    .map((decision) => `${decision.providerId}@${decision.receipt.observedAt ?? "none"}`)
    .join("|");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Selection after admission
// ---------------------------------------------------------------------------

export interface CapacitySubstitution {
  /** The provider that would have run this work if capacity allowed. */
  preferredProvider: string;
  /** The visible capacity reason it did not. */
  reason: string;
  /**
   * Substitution changes who runs the work, never what was already applied.
   * Carried on the result so a caller cannot quietly restart a partial Run on
   * the substitute.
   */
  resumeGuidance: string;
}

export interface CapacityAdmittedSelection {
  configuration: SelectedCodingAgentConfiguration;
  /** The admitted capacity decision the selected provider is running on. */
  capacity: CapacityAdmissionDecision;
  substitution: CapacitySubstitution | null;
  /** Every provider capacity refused, with its reason, for the record. */
  refused: Record<string, string>;
}

/**
 * Compliant selection, filtered by admission first. The order matters: capacity
 * removes providers from the pool, and `selectCompliantCodingAgent` then applies
 * the same capability, tools, context, locality and sandbox floors it always
 * does to whatever is left. A limited provider therefore yields a *different
 * eligible configured provider* or nothing at all — never a weaker one.
 */
export function selectCapacityAdmittedCodingAgent(
  input: Omit<CodingAgentSelectionInput, "capacityRefusals"> & {
    capacity: CapacityAdmissionDecision[];
    /** The provider this work would otherwise have used, when one is known. */
    preferredProvider?: string;
  }
): CapacityAdmittedSelection {
  const refused: Record<string, string> = {};
  for (const decision of input.capacity) {
    if (!decision.admitted) refused[decision.providerId] = decision.reason;
  }

  const configuration = selectCompliantCodingAgent({ ...input, capacityRefusals: refused });
  const capacity = input.capacity.find((decision) => decision.providerId === configuration.provider);
  if (!capacity?.admitted) {
    throw new ExecutionProfileUnsatisfiedError(
      `Provider ${configuration.provider} was selected without an admitted capacity decision. ` +
        `Unattended admission requires proven capacity for the provider that will run the work.`,
      { provider: configuration.provider, refused }
    );
  }

  const substitutionReason = input.preferredProvider ? refused[input.preferredProvider] : undefined;
  return {
    configuration,
    capacity,
    refused,
    substitution: input.preferredProvider && input.preferredProvider !== configuration.provider && substitutionReason
      ? {
          preferredProvider: input.preferredProvider,
          reason: substitutionReason,
          resumeGuidance:
            `Resume this Action from its recorded checkpoint on ${configuration.provider}. ` +
            `Work already applied by ${input.preferredProvider} must not be replayed.`
        }
      : null
  };
}
