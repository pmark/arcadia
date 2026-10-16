import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { evaluateCapacityAdmission, type ProviderCapacityReceipt } from "../codingAgents/capacity.js";
import { evaluateBoundedScoutIsolation } from "./isolationPreflight.js";
import { isInside } from "../workspace/experimentGuard.js";
import { loadUserConfig, userConfigPath } from "../workspace/config.js";

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
    || !Array.isArray(value.attempts) || value.attempts.length > 3 || value.repairs !== Math.max(0, value.attempts.length - 1)) return false;
  if (!value.attempts.length) return value.firstLaunch === null && value.sequence === 0;
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
function withHistory<T>(stores: AdmissionStores, fixtureRoot: string, action: (history: ScoutAdmissionHistory, witness: Witness) => T): T {
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
    return witnessDb.transaction(() => ledger.transaction(() => {
      const read = (db: Database.Database) => {
        const row = db.prepare("SELECT body FROM scout_admission WHERE goal = ?").get(SCOUT_GOAL) as { body: string } | undefined;
        if (!row) refuse("history or independent witness is missing; remaining allowance unknown");
        return JSON.parse(row.body) as unknown;
      };
      const history = read(ledger) as ScoutAdmissionHistory;
      const witness = read(witnessDb) as Witness;
      if (!historyValid(history) || !witness || witness.schema !== 1 || witness.lineage !== history.lineage
        || witness.sequence !== history.sequence || witness.digest !== admissionDigest(history)
        || !/^[a-f0-9]{64}$/.test(witness.evidenceSha256)) refuse("corrupt or restored history/witness");
      const result = action(history, witness);
      if (!historyValid(history)) refuse("invalid history transition");
      history.sequence += 1;
      ledger.prepare("UPDATE scout_admission SET body = ? WHERE goal = ?").run(JSON.stringify(history), SCOUT_GOAL);
      witness.sequence = history.sequence; witness.digest = admissionDigest(history);
      witnessDb.prepare("UPDATE scout_admission SET body = ? WHERE goal = ?").run(JSON.stringify(witness), SCOUT_GOAL);
      return result;
    }).immediate()).immediate();
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "unreadable history");
  } finally { ledgerDb?.close(); witnessDb.close(); }
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
  if (!capacity || capacity.providerId !== "codex-cli" || capacity.usagePolicy !== "included"
    || capacity.source === "operator_config" || capacity.evidence !== (mode === "live" ? "real" : "simulated")
    || capacity.credits?.hasCredits !== false || capacity.credits.unlimited !== false
    || !capacity.observedAt || !finite(Date.parse(capacity.observedAt)) || Date.parse(capacity.observedAt) > now
    || capacity.windows?.some((window) => !Number.isFinite(window.usedPercentage) || window.usedPercentage < 0 || window.usedPercentage > 100
      || window.remainingPercentage !== 100 - window.usedPercentage || !window.resetsAt || !Number.isFinite(Date.parse(window.resetsAt)))) refuse("subscription/capacity evidence is missing or invalid");
  const result = evaluateCapacityAdmission({ ...capacity, observedAgeMs: now - Date.parse(capacity.observedAt) }, new Date(now));
  if (!result.admitted || capacity.availability !== "available") refuse(result.reason);
}

/** Reserve durably before claim/invocation; interrupted reservations always count. */
export function reserveScoutAttempt(stores: AdmissionStores, evidence: ScoutAdmissionEvidence, scope: AdmissionScope,
  mode: ScoutAdmissionEvidence["mode"], now = Date.now()): ScoutReservation {
  if (!finite(now) || now >= EXPIRY) refuse("authority expired or clock invalid");
  validateEvidence(evidence, scope, now, mode);
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
  const reservation = withHistory(stores, evidence.isolation.pins.fixtureRoot, (history, witness) => {
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
    const attempt: Attempt = { id: randomUUID(), scope: { ...scope }, reservedAt: now,
      deadline: Math.min(now + 90_000, history.firstLaunch + LOOP_MS, EXPIRY), failure: null, retryable: false, outcome: "reserved" };
    history.attempts.push(attempt);
    return { id: attempt.id, attempt: history.attempts.length, repairs: history.repairs, firstLaunch: history.firstLaunch, deadline: attempt.deadline };
  });
  tokens.set(reservation, { scope: { ...scope }, mode, used: false, reservedAt: now, deadline: reservation.deadline,
    stores: { ...stores }, evidence: structuredClone(evidence), reservationId: reservation.id });
  return reservation;
}

/** One-use capability; returns its private absolute deadline after durable recheck. */
export function consumeScoutReservation(reservation: ScoutReservation | undefined, scope: AdmissionScope, mode: ScoutAdmissionEvidence["mode"], now = Date.now()): number {
  const token = reservation ? tokens.get(reservation) : undefined;
  if (!reservation || !token || token.used || token.mode !== mode || !sameScope(token.scope, scope)
    || now < token.reservedAt || now >= token.deadline || now >= EXPIRY) refuse("valid unused exact-scope reservation is required at invocation");
  validateEvidence(token.evidence, token.scope, now, mode);
  withHistory(token.stores, token.evidence.isolation.pins.fixtureRoot, (history, witness) => {
    const attempt = history.attempts.at(-1);
    if (now < history.lastClock || attempt?.id !== token.reservationId || attempt.outcome !== "reserved"
      || witness.evidenceSha256 !== admissionDigest(token.evidence)) refuse("reservation history, approval witness or clock changed before invocation");
    history.lastClock = now;
  });
  token.used = true;
  return token.deadline;
}

/** Failure attribution is retained; an ambiguous interruption stays reserved and cannot retry. */
export function finishScoutAttempt(stores: AdmissionStores, fixtureRoot: string, reservation: ScoutReservation, outcome: { failure: string; retryable?: boolean } | { completed: true }, now = Date.now()) {
  return withHistory(stores, fixtureRoot, (history) => {
    const attempt = history.attempts.at(-1);
    if (now < history.lastClock || !attempt || attempt.id !== reservation.id || attempt.outcome !== "reserved") refuse("outcome does not match an unresolved reservation or clock rolled back");
    if ("failure" in outcome && !outcome.failure.trim()) refuse("named failure is required");
    history.lastClock = now;
    attempt.outcome = "failure" in outcome ? "failed" : "completed";
    attempt.failure = "failure" in outcome ? outcome.failure : null;
    attempt.retryable = "failure" in outcome && outcome.retryable === true
      && !/login|log.?in|unauthori[sz]ed|authentica|quota|rate.?limit|isolation|protected.state|authority/i.test(outcome.failure);
  });
}
