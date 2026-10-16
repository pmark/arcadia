import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { CAPACITY_ADMISSION_LIMITS, evaluateCapacityAdmission, type ProviderCapacityReceipt } from "../codingAgents/capacity.js";
import { evaluateBoundedScoutIsolation } from "./isolationPreflight.js";
import { isInside } from "../workspace/experimentGuard.js";
import { loadUserConfig, userConfigPath } from "../workspace/config.js";
import { captureScoutClock, fixtureScoutClock, validScoutClock, type ScoutClockSample, type ScoutClockContinuity } from "./admissionClock.js";
import { classifyScoutFailure, type ScoutExecutionFailure } from "./executionFailure.js";

// This identity is independent of source revision, Run id and disposable fixture.
export const SCOUT_GOAL = "decision-0128:no-remote:HelloWorld.txt:48656c6c6f20576f726c64210a";
const EXPIRY = Date.parse("2026-10-18T00:00:00Z");
const LOOP_MS = 90 * 60_000;
export const ADMISSION_STORE_SCHEMA = "CREATE TABLE scout_admission (goal TEXT PRIMARY KEY, body TEXT NOT NULL)";

export interface AdmissionScope {
  runId: string;
  askId: string;
  workspace: string;
  repo: string;
  sourceHead: string;
}
interface Verification {
  session: string;
  sourceHead: string;
  verdict: "pass";
}
export interface ScoutAdmissionEvidence {
  schema: "arcadia-scout-admission-evidence-v1";
  mode: "live" | "scripted-fixture";
  scope: AdmissionScope;
  assignment: { decision: "0128"; approved: true; scope: AdmissionScope; implementer: string };
  codeReview: Verification;
  qa: Verification;
  isolation: Parameters<typeof evaluateBoundedScoutIsolation>[0];
  capacity: ProviderCapacityReceipt;
  billing: { subscriptionOnly: true; incrementalPaidCeiling: 0; apiBilling: false; credits: false; resetPurchase: false; fallback: false };
  retry: null | { failure: string; previousReservation: string; verifiedFix: string };
}
interface Attempt {
  id: string;
  scope: AdmissionScope;
  reservedAt: number;
  deadline: number;
  failure: string | null;
  failureDetail: ScoutExecutionFailure | null;
  retryable: boolean;
  outcome: "reserved" | "failed" | "completed";
}
export interface ScoutAdmissionHistory {
  schema: 1;
  goal: typeof SCOUT_GOAL;
  lineage: string;
  sequence: number;
  firstLaunch: number | null;
  lastClock: number;
  continuity: ScoutClockContinuity;
  stopped: string | null;
  repairs: number;
  attempts: Attempt[];
}
interface Witness {
  schema: 1;
  lineage: string;
  sequence: number;
  digest: string;
  // Provisioned by the approval custodian, outside the restorable ledger.
  evidenceSha256: string;
}
export interface AdmissionStores { ledger: string; witness: string }
/** Host trust anchor. Changing source, fixtures or CLI paths cannot select a new budget. */
export function liveScoutAdmissionStores(): AdmissionStores {
  const configRoot = path.dirname(userConfigPath());
  return { ledger: path.join(configRoot, "scout-admission", "decision-0128.sqlite"),
    witness: path.join(configRoot, "scout-admission-witness", "decision-0128.sqlite") };
}
export interface ScoutReservation { id: string; attempt: number; repairs: number; firstLaunch: number; deadline: number }
const tokens = new WeakMap<ScoutReservation, { scope: AdmissionScope; mode: ScoutAdmissionEvidence["mode"]; used: boolean; reservedAt: number; deadline: number;
  stores: AdmissionStores; evidence: ScoutAdmissionEvidence; reservationId: string }>();
export const admissionDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function refuse(reason: string): never { throw validationError(`Durable Scout admission refused: ${reason}`); }

export function assertScoutSource(sourceHead: string) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (head !== sourceHead || execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()
    || !process.version.startsWith("v22.")) refuse("clean immutable current source and Node 22 are required at invocation");
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function historyValid(value: ScoutAdmissionHistory): boolean {
  if (!value || value.schema !== 1 || value.goal !== SCOUT_GOAL || !value.lineage?.trim()
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !finite(value.lastClock)
    || !Number.isSafeInteger(value.repairs) || value.repairs < 0 || value.repairs > 2
    || !Array.isArray(value.attempts) || value.attempts.length > 3 || value.repairs !== Math.max(0, value.attempts.length - 1)
    || !(value.stopped === null || typeof value.stopped === "string") || !value.continuity?.bootId
    || ![value.continuity.lastMonoEndMs, value.continuity.lastUptimeMs, value.continuity.uncertaintyMs].every(finite)) return false;
  if (!value.attempts.length) return value.firstLaunch === null && value.continuity.firstMonoMs === null && value.continuity.firstUptimeMs === null;
  if (!finite(value.continuity.firstMonoMs) || !finite(value.continuity.firstUptimeMs)) return false;
  if (value.continuity.firstMonoMs > value.continuity.lastMonoEndMs || value.continuity.firstUptimeMs > value.continuity.lastUptimeMs
    || ![0, 1000].includes(value.continuity.uncertaintyMs)) return false;
  if (!finite(value.firstLaunch) || value.firstLaunch !== value.attempts[0].reservedAt || value.lastClock < value.firstLaunch) return false;
  const ids = new Set<string>();
  return value.attempts.every((attempt, index) => {
    if (!attempt || typeof attempt.id !== "string" || !attempt.id || ids.has(attempt.id)
      || !finite(attempt.reservedAt) || attempt.reservedAt < value.firstLaunch! || attempt.reservedAt > value.lastClock
      || (index > 0 && attempt.reservedAt < value.attempts[index - 1].deadline)
      || !finite(attempt.deadline) || attempt.deadline <= attempt.reservedAt
      || attempt.deadline > attempt.reservedAt + 90_000 || attempt.deadline > value.firstLaunch! + LOOP_MS || attempt.deadline > EXPIRY
      || !["reserved", "failed", "completed"].includes(attempt.outcome)
      || typeof attempt.retryable !== "boolean" || (attempt.outcome !== "failed" && attempt.retryable)
      || (attempt.outcome === "failed" ? !attempt.failureDetail || !["auth_failure", "provider_limit", "isolation", "authority", "runtime", "product", "unknown"].includes(attempt.failureDetail.kind)
        : attempt.failureDetail !== null)
      || (attempt.failureDetail && (typeof attempt.failureDetail.diagnostic !== "string" || !attempt.failureDetail.diagnostic.trim()
        || !Array.isArray(attempt.failureDetail.matched) || attempt.failureDetail.matched.some((item) => typeof item !== "string")
        || attempt.failureDetail.retryable !== ["runtime", "product"].includes(attempt.failureDetail.kind) || attempt.retryable !== attempt.failureDetail.retryable))
      || (attempt.outcome === "failed" ? !attempt.failure?.trim() : attempt.failure !== null)
      || !validScope(attempt.scope)) return false;
    ids.add(attempt.id); return true;
  });
}
function validScope(scope: AdmissionScope): boolean {
  return !!scope && [scope.runId, scope.askId].every((value) => typeof value === "string" && value.trim() === value && value.length > 0)
    && /^[a-f0-9]{40}$/.test(scope.sourceHead) && [scope.workspace, scope.repo].every((value) => typeof value === "string" && path.isAbsolute(value));
}
function sameScope(left: AdmissionScope, right: AdmissionScope): boolean {
  return validScope(left) && validScope(right) && (Object.keys(left) as (keyof AdmissionScope)[]).every((key) => left[key] === right[key])
    && Object.keys(left).length === Object.keys(right).length;
}

/** Existing stores only. There is deliberately no live initialization/reset path. */
function withHistory<T>(stores: AdmissionStores, fixtureRoot: string, sample: ScoutClockSample, action: (history: ScoutAdmissionHistory, witness: Witness) => T,
  custody?: (witness: Witness) => void): T {
  const ledgerPath = realpathSync(stores.ledger);
  const witnessPath = realpathSync(stores.witness);
  const root = realpathSync(fixtureRoot);
  if ([stores.ledger, stores.witness].some((file) => lstatSync(file).isSymbolicLink())
    || isInside(root, ledgerPath) || isInside(root, witnessPath)
    || isInside(path.dirname(ledgerPath), witnessPath) || isInside(path.dirname(witnessPath), ledgerPath)
    || lstatSync(ledgerPath).ino === lstatSync(witnessPath).ino) refuse("independent stores must be outside the fixture and each other's restore directories");
  const witnessDb = new Database(witnessPath, { fileMustExist: true, timeout: 5000 });
  let ledgerDb: Database.Database | undefined;
  try {
    ledgerDb = new Database(ledgerPath, { fileMustExist: true, timeout: 5000 });
    // Separate full-sync stores. A crash between commits leaves a mismatch,
    // which refuses all later admission; it never restores allowance.
    witnessDb.pragma("synchronous = FULL"); ledgerDb.pragma("synchronous = FULL");
    const ledger = ledgerDb;
    const result = witnessDb.transaction(() => ledger.transaction(() => {
      const read = (db: Database.Database) => {
        const row = db.prepare("SELECT body FROM scout_admission WHERE goal = ?").get(SCOUT_GOAL) as { body: string } | undefined;
        if (!row) refuse("history or independent witness is missing; remaining allowance unknown");
        return JSON.parse(row.body) as unknown;
      };
      let history = read(ledger) as ScoutAdmissionHistory;
      const witness = read(witnessDb) as Witness;
      if (!historyValid(history) || !witness || witness.schema !== 1 || witness.lineage !== history.lineage
        || witness.sequence !== history.sequence || witness.digest !== admissionDigest(history)
        || !/^[a-f0-9]{64}$/.test(witness.evidenceSha256)) refuse("corrupt or restored history/witness");
      custody?.(witness);
      const clockFailure = advanceClock(history, sample);
      const clockOnly = structuredClone(history);
      let outcome: { ok: true; value: T } | { ok: false; error: unknown };
      try {
        if (clockFailure) refuse(clockFailure);
        const value = action(history, witness);
        if (!historyValid(history)) refuse("invalid history transition");
        outcome = { ok: true, value };
      } catch (error) {
        // Commit the observation/refusal but none of the attempted budget
        // transition. A later wall rollback cannot undo an exhausted bound.
        history = clockOnly; outcome = { ok: false, error };
      }
      history.sequence += 1;
      ledger.prepare("UPDATE scout_admission SET body = ? WHERE goal = ?").run(JSON.stringify(history), SCOUT_GOAL);
      witness.sequence = history.sequence; witness.digest = admissionDigest(history);
      witnessDb.prepare("UPDATE scout_admission SET body = ? WHERE goal = ?").run(JSON.stringify(witness), SCOUT_GOAL);
      return outcome;
    }).immediate()).immediate();
    if (!result.ok) throw result.error;
    return result.value;
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "unreadable history");
  } finally { ledgerDb?.close(); witnessDb.close(); }
}

function elapsed(history: ScoutAdmissionHistory, sample: ScoutClockSample): number {
  if (history.firstLaunch === null || history.continuity.firstMonoMs === null || history.continuity.firstUptimeMs === null) return 0;
  return Math.max(sample.wallMs - history.firstLaunch, sample.monoEndMs - history.continuity.firstMonoMs,
    sample.uptimeMs - history.continuity.firstUptimeMs + sample.uncertaintyMs);
}

function advanceClock(history: ScoutAdmissionHistory, sample: ScoutClockSample): string | null {
  if (!validScoutClock(sample)) { history.stopped = "clock continuity is unknown"; return history.stopped; }
  const prior = history.continuity;
  if (prior.bootId !== sample.bootId || prior.uncertaintyMs !== sample.uncertaintyMs) history.stopped ??= "boot/clock continuity is unknown";
  // The two monotonic sample endpoints bound Date.now's millisecond reading.
  // Uptime additionally counts suspension; its one-second precision is charged
  // conservatively against the elapsed allowance rather than granting time.
  if (sample.wallMs < history.lastClock || sample.monoStartMs < prior.lastMonoEndMs || sample.uptimeMs < prior.lastUptimeMs
    || sample.wallMs - history.lastClock + Math.min(2, sample.uncertaintyMs) < sample.monoStartMs - prior.lastMonoEndMs) history.stopped ??= "clock rollback or lost continuity";
  if (elapsed(history, sample) >= LOOP_MS) history.stopped ??= "elapsed allowance exhausted";
  history.lastClock = Math.max(history.lastClock, sample.wallMs);
  prior.lastMonoEndMs = Math.max(prior.lastMonoEndMs, sample.monoEndMs);
  prior.lastUptimeMs = Math.max(prior.lastUptimeMs, sample.uptimeMs);
  return history.stopped;
}

function clockFor(mode: ScoutAdmissionEvidence["mode"], now?: number, override?: ScoutClockSample): ScoutClockSample {
  if (mode === "live" && (now !== undefined || override)) refuse("live clock overrides are forbidden");
  const sample = override ?? (now === undefined ? captureScoutClock() : fixtureScoutClock(now));
  if (!validScoutClock(sample) || (now !== undefined && sample.wallMs !== now)) refuse("clock continuity is missing or invalid");
  return sample;
}

function capacityShape(value: unknown): value is ProviderCapacityReceipt {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown) => typeof v === "string";
  const nullableText = (v: unknown) => v === null || text(v);
  const date = (v: unknown) => v === null || (text(v) && Number.isFinite(Date.parse(v)));
  const texts = (v: unknown) => Array.isArray(v) && v.every(text);
  if (!record(value) || value.version !== 1 || !["providerId", "providerLabel", "accountScope", "usagePolicyReason", "telemetry"].every((key) => text(value[key]))
    || !texts(value.profiles) || !texts(value.unsupported) || typeof value.unattended !== "boolean"
    || !date(value.observedAt) || !date(value.expiresAt) || !date(value.nextResetAt)
    || !(value.observedAgeMs === null || finite(value.observedAgeMs))
    || !["codex_app_server", "claude_usage_snapshot", "operator_receipt", "operator_config", "none"].includes(String(value.source))
    || !["real", "simulated"].includes(String(value.evidence)) || !["observed", "attested", "unknown"].includes(String(value.confidence))
    || !["fresh", "stale", "unknown"].includes(String(value.freshness)) || !["included", "paid", "unknown"].includes(String(value.usagePolicy))
    || !["available", "unknown", "usage_limited", "budget_limited"].includes(String(value.availability)) || !nullableText(value.planScope)
    || !Array.isArray(value.windows) || !value.windows.every((window) => record(window) && text(window.label)
      && finite(window.usedPercentage) && window.usedPercentage <= 100 && finite(window.remainingPercentage) && window.remainingPercentage <= 100 && date(window.resetsAt))
    || !Array.isArray(value.bankedResets) || !value.bankedResets.every((reset) => record(reset) && text(reset.id) && text(reset.status) && nullableText(reset.title) && date(reset.expiresAt))) return false;
  return value.credits === null || (record(value.credits) && typeof value.credits.hasCredits === "boolean"
    && typeof value.credits.unlimited === "boolean" && nullableText(value.credits.balance));
}

function validateEvidence(evidence: ScoutAdmissionEvidence, scope: AdmissionScope, now: number, mode: ScoutAdmissionEvidence["mode"]) {
  if (!evidence || evidence.schema !== "arcadia-scout-admission-evidence-v1" || evidence.mode !== mode || !sameScope(evidence.scope, scope)
    || evidence.assignment?.decision !== "0128" || evidence.assignment.approved !== true || !sameScope(evidence.assignment.scope, scope)
    || !evidence.assignment.implementer?.trim()) refuse("exact-scope authority is missing");
  const reviews = [evidence.codeReview, evidence.qa];
  if (reviews.some((review) => !review || review.verdict !== "pass" || review.sourceHead !== scope.sourceHead || !review.session?.trim())
    || new Set([evidence.assignment.implementer, ...reviews.map((review) => review.session)]).size !== 3) refuse("separate current-source code-review and QA evidence is required");
  const billing = evidence.billing;
  if (!billing || billing.subscriptionOnly !== true || billing.incrementalPaidCeiling !== 0 || billing.apiBilling !== false
    || billing.credits !== false || billing.resetPurchase !== false || billing.fallback !== false) refuse("included subscription only, zero paid spend and no fallback are required");
  const isolation = evaluateBoundedScoutIsolation({ ...evidence.isolation, now: new Date(now).toISOString() });
  if (isolation.verdict !== "isolated" || isolation.pins?.sourceRevision !== scope.sourceHead
    || isolation.pins.workspace !== scope.workspace || isolation.pins.fixtureRepo !== scope.repo
    || isolation.pins.nodeVersion !== process.version || !process.version.startsWith("v22.")) refuse(`missing isolation or immutable Node 22 source evidence: ${isolation.reasons.join("; ")}`);
  const capacity = evidence.capacity;
  if (!capacityShape(capacity)) refuse("subscription/capacity evidence JSON is incomplete or malformed");
  const observed = capacity?.source === "codex_app_server" && capacity.confidence === "observed" && capacity.expiresAt === null;
  const attested = capacity?.source === "operator_receipt" && capacity.confidence === "attested" && capacity.unattended === false
    && !!capacity.expiresAt && Number.isFinite(Date.parse(capacity.expiresAt)) && Date.parse(capacity.expiresAt) > now
    && !!capacity.observedAt && Date.parse(capacity.expiresAt) - Date.parse(capacity.observedAt) <= CAPACITY_ADMISSION_LIMITS.operatorReceiptMaxTtlMs;
  if (!capacity || capacity.version !== 1 || capacity.providerId !== "codex-cli" || capacity.usagePolicy !== "included"
    || (!observed && !attested) || typeof capacity.unattended !== "boolean" || typeof capacity.accountScope !== "string" || !capacity.accountScope.trim()
    || capacity.evidence !== (mode === "live" ? "real" : "simulated")
    || capacity.credits?.hasCredits !== false || capacity.credits.unlimited !== false
    || !capacity.observedAt || !finite(Date.parse(capacity.observedAt)) || Date.parse(capacity.observedAt) > now
    || !Array.isArray(capacity.windows) || capacity.windows.length === 0
    || capacity.windows.some((window) => !Number.isFinite(window.usedPercentage) || window.usedPercentage < 0 || window.usedPercentage > 100
      || window.remainingPercentage !== 100 - window.usedPercentage || !window.resetsAt || !Number.isFinite(Date.parse(window.resetsAt)))) refuse("subscription/capacity evidence is missing or invalid");
  const result = evaluateCapacityAdmission({ ...capacity, observedAgeMs: now - Date.parse(capacity.observedAt) }, new Date(now));
  if (!result.admitted || capacity.availability !== "available") refuse(result.reason);
}

/** Reserve durably before claim/invocation; interrupted reservations always count. */
export function reserveScoutAttempt(stores: AdmissionStores, evidence: ScoutAdmissionEvidence, scope: AdmissionScope,
  mode: ScoutAdmissionEvidence["mode"], at?: number, override?: ScoutClockSample): ScoutReservation {
  const sample = clockFor(mode, at, override); const now = sample.wallMs;
  if (!evidence || evidence.schema !== "arcadia-scout-admission-evidence-v1" || evidence.mode !== mode || !sameScope(evidence.scope, scope)
    || typeof evidence.isolation?.pins?.fixtureRoot !== "string") refuse("exact-scope authority/isolation evidence is missing");
  if (mode === "live") {
    // Simulation may redirect HOME/config. A live goal cannot acquire a new
    // allowance merely by choosing a different environment/config root.
    if (os.homedir() !== os.userInfo().homedir || process.env.ARCADIA_CONFIG_PATH || process.env.XDG_CONFIG_HOME
      || process.env.ARCADIA_CAPACITY_EVIDENCE_MODE || process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE) refuse("live admission cannot redirect the trusted host configuration or capacity root");
    const trusted = liveScoutAdmissionStores();
    const liveWorkspace = loadUserConfig().defaultWorkspace;
    if (path.resolve(stores.ledger) !== trusted.ledger || path.resolve(stores.witness) !== trusted.witness
      || !liveWorkspace || realpathSync(liveWorkspace) !== realpathSync(evidence.isolation.pins.liveWorkspacePath)) {
      refuse("live admission must use the fixed host stores and configured protected workspace");
    }
  }
  const reservation = withHistory(stores, evidence.isolation.pins.fixtureRoot, sample, (history, witness) => {
    if (now >= EXPIRY) refuse("authority expired");
    validateEvidence(evidence, scope, now, mode);
    if (witness.evidenceSha256 !== admissionDigest(evidence)) refuse("evidence is not pinned by the independent approval witness");
    if (now < history.lastClock) refuse("clock rollback");
    if (history.attempts.length >= 3 || history.repairs >= 2 || (history.firstLaunch !== null && now >= history.firstLaunch + LOOP_MS)) refuse("attempt, repair or elapsed allowance exhausted");
    const previous = history.attempts.at(-1);
    if (previous) {
      // Waiting the entire reservation also fences an orphaned process after
      // parent interruption, without introducing recovery or a second runner.
      if (now < previous.deadline) refuse("previous reservation is still active");
      const retry = evidence.retry;
      if (!retry?.failure?.trim() || retry.previousReservation !== previous.id || !retry.verifiedFix?.trim()
        || previous.scope.sourceHead === scope.sourceHead || previous.outcome !== "failed" || !previous.retryable || previous.failure !== retry.failure
        || history.attempts.some((attempt) => attempt !== previous && attempt.failure === retry.failure)) refuse("retry requires a named new failure, changed verified fix, separate review and QA");
      history.repairs += 1;
    } else if (evidence.retry !== null) refuse("retry has no retained failed attempt");
    history.firstLaunch ??= now; history.lastClock = now;
    history.continuity.firstMonoMs ??= sample.monoStartMs;
    history.continuity.firstUptimeMs ??= sample.uptimeMs;
    const attempt: Attempt = { id: randomUUID(), scope: { ...scope }, reservedAt: now,
      deadline: Math.min(now + 90_000, now + LOOP_MS - elapsed(history, sample), history.firstLaunch + LOOP_MS, EXPIRY), failure: null, failureDetail: null, retryable: false, outcome: "reserved" };
    history.attempts.push(attempt);
    return { id: attempt.id, attempt: history.attempts.length, repairs: history.repairs, firstLaunch: history.firstLaunch, deadline: attempt.deadline };
  }, (witness) => { if (witness.evidenceSha256 !== admissionDigest(evidence)) refuse("evidence is not pinned by the independent approval witness"); });
  tokens.set(reservation, { scope: { ...scope }, mode, used: false, reservedAt: now, deadline: reservation.deadline,
    stores: { ...stores }, evidence: structuredClone(evidence), reservationId: reservation.id });
  return reservation;
}

/** One-use capability; returns its private absolute deadline after durable recheck. */
export function consumeScoutReservation(reservation: ScoutReservation | undefined, scope: AdmissionScope, mode: ScoutAdmissionEvidence["mode"], at?: number, override?: ScoutClockSample): number {
  const sample = clockFor(mode, at, override); const now = sample.wallMs;
  const token = reservation ? tokens.get(reservation) : undefined;
  if (!reservation || !token || token.used || token.mode !== mode || !sameScope(token.scope, scope)) refuse("valid unused exact-scope reservation is required at invocation");
  withHistory(token.stores, token.evidence.isolation.pins.fixtureRoot, sample, (history, witness) => {
    if (now < token.reservedAt || now >= token.deadline || now >= EXPIRY) refuse("valid unused exact-scope reservation is required at invocation");
    validateEvidence(token.evidence, token.scope, now, mode);
    const attempt = history.attempts.at(-1);
    if (now < history.lastClock || attempt?.id !== token.reservationId || attempt.outcome !== "reserved"
      || witness.evidenceSha256 !== admissionDigest(token.evidence)) refuse("reservation history, approval witness or clock changed before invocation");
    history.lastClock = now;
  });
  token.used = true;
  return token.deadline;
}

/** Failure attribution is retained; an ambiguous interruption stays reserved and cannot retry. */
export function finishScoutAttempt(stores: AdmissionStores, fixtureRoot: string, reservation: ScoutReservation, outcome: { failure: string; retryable?: boolean; classification?: ScoutExecutionFailure } | { completed: true }, at?: number, override?: ScoutClockSample) {
  const token = tokens.get(reservation);
  if (!token) refuse("outcome requires its issued reservation capability");
  const sample = clockFor(token.mode, at, override); const now = sample.wallMs;
  return withHistory(stores, fixtureRoot, sample, (history) => {
    const attempt = history.attempts.at(-1);
    if (now < history.lastClock || !attempt || attempt.id !== reservation.id || attempt.outcome !== "reserved") refuse("outcome does not match an unresolved reservation or clock rolled back");
    if ("failure" in outcome && !outcome.failure.trim()) refuse("named failure is required");
    history.lastClock = now;
    attempt.outcome = "failure" in outcome ? "failed" : "completed";
    attempt.failure = "failure" in outcome ? outcome.failure : null;
    attempt.failureDetail = "failure" in outcome ? classifyScoutFailure({ diagnostic: `${outcome.failure}\n${outcome.classification?.diagnostic ?? ""}`,
      runtime: outcome.classification?.kind === "runtime", product: outcome.classification?.kind === "product" }) : null;
    attempt.retryable = attempt.failureDetail?.retryable ?? false;
  });
}
