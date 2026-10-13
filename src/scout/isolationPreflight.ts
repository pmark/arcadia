import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, openSync, closeSync, writeSync, fsyncSync, renameSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { compareLeakSnapshots, parseLeakSnapshot, unverifiableReason, type LeakSnapshot } from "../workspace/leakCheck.js";

const SHA = /^[a-f0-9]{64}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REQUIRED_HASHES = ["userConfig", "codexConfig", "claudeSettings", "claudeTrust", "capacityReceipts"] as const;
const CONSUMED_FILES = [
  "report.json", "arcadia-luna-scout-before.json", "arcadia-luna-scout-leak-after.json",
  "arcadia-luna-scout-trust-attribution.json", "evidence/retry-01-ask.json",
  "evidence/operator-approval.json", "evidence/worker-result.json", "evidence/04-todo-final.json",
  "builder/metadata.json", "builder/prompt.md"
];

export interface ScoutPins {
  sourceRevision: string;
  nodeVersion: string;
  model: string;
  effort: string;
  fixtureRoot: string;
  workspace: string;
  fixtureRepo: string;
  liveWorkspacePath: string;
  fixtureTrustPath: string;
}

interface ScoutInput {
  pins: ScoutPins;
  before: LeakSnapshot | null;
  after: LeakSnapshot | null;
  codexConfigDiff?: { before: string; after: string };
  priorHold: { status: "unresolved" };
}

interface SnapshotSummary {
  takenAt: string;
  liveWorkspace: {
    path: string;
    projectCount: number;
    queueRevision: number;
    productionPolicy: { desiredState: string; revision: number; epoch: number };
    productionPolicyReceipts: number;
    productionAdmissions: number;
    observed: true;
  };
  hashes: LeakSnapshot["hashes"];
  goBroker: { entries: number; sha256: string };
  launchAgents: { entries: number; sha256: string };
}

export interface ScoutPreflightReceipt {
  schema: "arcadia-scout-isolation-preflight-v1";
  scope: "held-scout-observation-only" | "bounded-decision-0128-isolation-only";
  verdict: "blocked" | "isolated";
  resolutionImplemented: boolean;
  pins: ScoutPins | null;
  before: SnapshotSummary | null;
  after: SnapshotSummary | null;
  config: { beforeSha256: string; afterSha256: string; exactFixtureTrustChange: boolean } | null;
  priorHold: { status: "unresolved" };
  reasons: string[];
}

const BOUNDED_DECISION_ID = "0128";
const BOUNDED_DECISION_ANSWER = "Authorize the bounded Luna Hello World loop with three attempts and two repair cycles";
const BOUNDED_DECISION_EXPIRY = "2026-10-18T00:00:00.000Z";
const BOUNDED_GOAL = "bounded-luna-hello-world-0128";
const BOUNDED_DECISION_SCOPE_SHA256 = "1cc165eed764c3f1736763bec8fe1e7cf0b161cf022aece4484d93961bcdb2bd";
const BOUNDED_DECISION_FILE_SHA256 = "f4072b04d9500f2c2711aaa84b68db2a92449e1dd528dd9c4097c338e654a9ce";

export interface ScoutBudgetLedger {
  schema: "arcadia-scout-budget-v1";
  decisionId: "0128";
  goal: typeof BOUNDED_GOAL;
  startedAt: string;
  deadline: string;
  lastObservedAt: string;
  attempts: Array<{ number: number; sourceRevision: string; fixtureRoot: string; reservedAt: string }>;
  repairs: Array<{ cycle: number; sourceRevision: string; reservedAt: string }>;
}

export interface ScoutReservation {
  ok: boolean;
  reason: string | null;
  ledger: ScoutBudgetLedger | null;
  attemptNumber: number | null;
  repairCycle: number | null;
}

function decisionFrontmatter(text: string): Record<string, unknown> | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  try {
    const parsed: unknown = parseYaml(match[1]);
    return isRecord(parsed) ? parsed : null;
  } catch { return null; }
}

export function validateBoundedScoutDecision(input: { text: string; canonicalPath: string; now?: string }) {
  const parsed = decisionFrontmatter(input.text);
  const now = input.now ?? new Date().toISOString();
  const expectedPath = "docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md";
  if (!parsed || input.canonicalPath !== expectedPath || sha256(input.text) !== BOUNDED_DECISION_FILE_SHA256 || parsed.id !== BOUNDED_DECISION_ID
    || parsed.status !== "approved" || parsed.answer !== BOUNDED_DECISION_ANSWER
    || parsed.decided !== "2026-10-13" || !Array.isArray(parsed.options)) {
    return { approved: false, decisionSha256: sha256(input.text), reason: "canonical approved Decision 0128 and its exact answer are required" };
  }
  const option = parsed.options.find((entry) => isRecord(entry) && entry.label === BOUNDED_DECISION_ANSWER);
  const consequence = isRecord(option) && typeof option.consequence === "string" ? option.consequence : "";
  const required = ["at most3 total live builder attempts", "at most2 Supervisor-led repair cycles", "at most90seconds", "incremental paid spend ceiling$0", "2026-10-18T00:00:00Z"];
  if (sha256(consequence) !== BOUNDED_DECISION_SCOPE_SHA256 || !required.every((part) => consequence.includes(part))) {
    return { approved: false, decisionSha256: sha256(input.text), reason: "Decision 0128 bounded policy text does not match the required limits" };
  }
  const expiry = Date.parse(BOUNDED_DECISION_EXPIRY);
  if (!Number.isFinite(Date.parse(now)) || Date.parse(now) >= expiry) {
    return { approved: false, decisionSha256: sha256(input.text), reason: "Decision 0128 has expired" };
  }
  return { approved: true, decisionSha256: sha256(input.text), reason: null };
}

function validBudgetLedger(value: unknown): value is ScoutBudgetLedger {
  if (!hasExactKeys(value, ["schema", "decisionId", "goal", "startedAt", "deadline", "lastObservedAt", "attempts", "repairs"])
    || value.schema !== "arcadia-scout-budget-v1" || value.decisionId !== BOUNDED_DECISION_ID || value.goal !== BOUNDED_GOAL
    || typeof value.startedAt !== "string" || typeof value.deadline !== "string" || typeof value.lastObservedAt !== "string"
    || !Array.isArray(value.attempts) || !Array.isArray(value.repairs) || value.repairs.length > 2) return false;
  const started = Date.parse(value.startedAt);
  const deadline = Date.parse(value.deadline);
  const observed = Date.parse(value.lastObservedAt);
  const expectedDeadline = Math.min(started + 90 * 60_000, Date.parse(BOUNDED_DECISION_EXPIRY));
  return value.attempts.length <= 3 && deadline === expectedDeadline && observed >= started
    && value.repairs.every((repair, index) => hasExactKeys(repair, ["cycle", "sourceRevision", "reservedAt"])
      && repair.cycle === index + 1 && typeof repair.sourceRevision === "string" && REVISION.test(repair.sourceRevision)
      && typeof repair.reservedAt === "string" && Number.isFinite(Date.parse(repair.reservedAt))
      && Date.parse(repair.reservedAt) >= started && Date.parse(repair.reservedAt) <= observed && Date.parse(repair.reservedAt) < deadline)
    && value.attempts.every((attempt, index) => hasExactKeys(attempt, ["number", "sourceRevision", "fixtureRoot", "reservedAt"])
    && attempt.number === index + 1 && typeof attempt.sourceRevision === "string" && REVISION.test(attempt.sourceRevision)
    && typeof attempt.fixtureRoot === "string" && path.isAbsolute(attempt.fixtureRoot)
    && typeof attempt.reservedAt === "string" && Number.isFinite(Date.parse(attempt.reservedAt))
    && Date.parse(attempt.reservedAt) >= started && Date.parse(attempt.reservedAt) <= observed && Date.parse(attempt.reservedAt) < deadline)
    && Number.isFinite(Date.parse(value.startedAt)) && Number.isFinite(Date.parse(value.deadline))
    && Number.isFinite(Date.parse(value.lastObservedAt)) && Date.parse(value.deadline) <= Date.parse(BOUNDED_DECISION_EXPIRY);
}

/** Atomically reserves an attempt before launch. Source SHA is evidence per attempt, never the ledger key. */
function reserveBoundedScoutBudget(input: { kind: "attempt" | "repair"; ledgerPath: string; trustedLedgerPath: string; sourceRevision: string; fixtureRoot: string; initialize?: boolean; now?: string }): ScoutReservation {
  const blocked = (reason: string): ScoutReservation => ({ ok: false, reason, ledger: null, attemptNumber: null, repairCycle: null });
  if (!REVISION.test(input.sourceRevision) || !path.isAbsolute(input.fixtureRoot) || !path.isAbsolute(input.ledgerPath)
    || !path.isAbsolute(input.trustedLedgerPath) || path.resolve(input.ledgerPath) !== path.resolve(input.trustedLedgerPath)) {
    return blocked("immutable source SHA, explicit fixture root, and exact trusted ledger assignment pin are required");
  }
  let parent: string;
  try { parent = realpathSync(path.dirname(input.ledgerPath)); } catch { return blocked("budget ledger parent is unavailable"); }
  const ledgerPath = path.join(parent, path.basename(input.ledgerPath));
  if (existsSync(ledgerPath) && (lstatSync(ledgerPath).isSymbolicLink() || !lstatSync(ledgerPath).isFile())) return blocked("budget ledger is not a regular file");
  const lockPath = `${ledgerPath}.lock`;
  let lockFd: number;
  try { lockFd = openSync(lockPath, "wx", 0o600); }
  catch { return blocked("budget ledger is locked or lock state is unavailable; fail closed"); }
  try {
    const now = input.now ?? new Date().toISOString();
    const current = Date.parse(now);
    if (!Number.isFinite(current) || current >= Date.parse(BOUNDED_DECISION_EXPIRY)) return blocked("bounded authorization is expired or the clock is invalid");
    let ledger: ScoutBudgetLedger;
    if (existsSync(ledgerPath)) {
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(ledgerPath, "utf8")); } catch { return blocked("budget ledger is corrupt"); }
      if (!validBudgetLedger(parsed)) return blocked("budget ledger is malformed or outside approved bounds");
      if (current < Date.parse(parsed.lastObservedAt)) return blocked("clock moved backwards since the previous budget receipt");
      if (current >= Date.parse(parsed.deadline)) return blocked("90-minute loop wall limit is exhausted");
      ledger = parsed;
    } else {
      if (input.initialize !== true) return blocked("trusted Supervisor initialization is required before this goal ledger can be used");
      ledger = { schema: "arcadia-scout-budget-v1", decisionId: BOUNDED_DECISION_ID, goal: BOUNDED_GOAL,
        startedAt: now, deadline: new Date(Math.min(current + 90 * 60_000, Date.parse(BOUNDED_DECISION_EXPIRY))).toISOString(),
        lastObservedAt: now, attempts: [], repairs: [] };
    }
    const attemptNumber = input.kind === "attempt" ? ledger.attempts.length + 1 : null;
    const repairCycle = input.kind === "repair" ? ledger.repairs.length + 1 : null;
    if (attemptNumber !== null && attemptNumber > 3) return blocked("three-attempt budget is exhausted");
    if (repairCycle !== null && repairCycle > 2) return blocked("two-repair-cycle budget is exhausted");
    ledger = {
      ...ledger,
      lastObservedAt: now,
      attempts: attemptNumber === null ? ledger.attempts : [...ledger.attempts, {
        number: attemptNumber, sourceRevision: input.sourceRevision, fixtureRoot: path.resolve(input.fixtureRoot), reservedAt: now
      }],
      repairs: repairCycle === null ? ledger.repairs : [...ledger.repairs, { cycle: repairCycle, sourceRevision: input.sourceRevision, reservedAt: now }]
    };
    const temporary = `${ledgerPath}.${process.pid}.${current}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeSync(fd, `${JSON.stringify(ledger, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, ledgerPath);
    const directoryFd = openSync(parent, "r");
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    return { ok: true, reason: null, ledger, attemptNumber, repairCycle };
  } catch {
    return blocked("budget reservation failed closed");
  } finally {
    closeSync(lockFd);
    unlinkSync(lockPath);
  }
}

/** Reserves one Supervisor-led repair cycle in the same Decision and goal ledger. */
export function reserveBoundedScoutRepair(input: { ledgerPath: string; trustedLedgerPath: string; sourceRevision: string; fixtureRoot: string; now?: string }): ScoutReservation {
  return reserveBoundedScoutBudget({ ...input, kind: "repair" });
}

/** Reserves an attempt before launch; source SHA is evidence per attempt, never the ledger key. */
export function reserveBoundedScoutAttempt(input: { ledgerPath: string; trustedLedgerPath: string; sourceRevision: string; fixtureRoot: string; initialize?: boolean; now?: string }): ScoutReservation {
  return reserveBoundedScoutBudget({ ...input, kind: "attempt" });
}

/** Current-attempt gate. Historical replay continues to use the held-only evaluator above. */
export function evaluateBoundedScoutIsolation(input: {
  pins: ScoutPins; before: LeakSnapshot | null; after: LeakSnapshot | null;
  codexConfigDiff?: { before: string; after: string };
  decision: { text: string; canonicalPath: string };
  now?: string;
}): ScoutPreflightReceipt & { decision: { id: string; sha256: string }; attemptLimitSeconds: 90; executionAuthorized: false } {
  const decision = validateBoundedScoutDecision({ ...input.decision, now: input.now });
  const base = evaluateScoutPreflight({ pins: input.pins, before: input.before, after: input.after,
    ...(input.codexConfigDiff ? { codexConfigDiff: input.codexConfigDiff } : {}), priorHold: { status: "unresolved" } });
  const reasons = base.reasons.filter((reason) => reason !== "historical isolation hold unresolved; this observation-only slice has no hold-resolution implementation");
  if (!decision.approved && decision.reason) reasons.push(decision.reason);
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  if (input.before && input.after) {
    const beforeMs = Date.parse(input.before.takenAt);
    const afterMs = Date.parse(input.after.takenAt);
    if (!Number.isFinite(beforeMs) || !Number.isFinite(afterMs) || beforeMs > afterMs || afterMs > nowMs || nowMs - beforeMs > 5 * 60_000) {
      reasons.push("protected-state witnesses must be ordered, current, and no more than five minutes old");
    }
  }
  try {
    const livePath = realpathSync(input.pins.liveWorkspacePath);
    const fixtureRootPath = realpathSync(input.pins.fixtureRoot);
    if (livePath === fixtureRootPath || livePath.startsWith(`${fixtureRootPath}${path.sep}`)
      || fixtureRootPath.startsWith(`${livePath}${path.sep}`)) reasons.push("fixture scope overlaps the protected live workspace");
  } catch { reasons.push("protected live workspace or fixture root is missing or cannot be verified"); }
  // Existing-path pins must name real directories directly; a symlink cannot disguise a live path.
  try {
    const realRoot = realpathSync(input.pins.fixtureRoot);
    const realWorkspace = realpathSync(input.pins.workspace);
    const realRepo = realpathSync(input.pins.fixtureRepo);
    const realTrust = realpathSync(input.pins.fixtureTrustPath);
    const paths = [input.pins.fixtureRoot, input.pins.workspace, input.pins.fixtureRepo, input.pins.fixtureTrustPath];
    if (paths.some((raw) => lstatSync(raw).isSymbolicLink())) reasons.push("fixture scope contains a symlink at a pinned path");
    if (realWorkspace === realRoot || !realWorkspace.startsWith(`${realRoot}${path.sep}`)
      || (realRepo !== realWorkspace && !realRepo.startsWith(`${realWorkspace}${path.sep}`))
      || (realTrust !== realRepo && !realTrust.startsWith(`${realRepo}${path.sep}`))) {
      reasons.push("fixture scope real paths escape their pinned parent");
    }
  } catch { reasons.push("fixture scope path is missing or cannot be verified"); }
  const uniqueReasons = [...new Set(reasons)];
  return {
    ...base,
    scope: "bounded-decision-0128-isolation-only",
    verdict: uniqueReasons.length === 0 ? "isolated" : "blocked",
    resolutionImplemented: true,
    priorHold: { status: "unresolved" },
    reasons: uniqueReasons,
    decision: { id: BOUNDED_DECISION_ID, sha256: decision.decisionSha256 },
    attemptLimitSeconds: 90,
    executionAuthorized: false
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function blockedReceipt(reason: string): ScoutPreflightReceipt {
  return {
    schema: "arcadia-scout-isolation-preflight-v1", scope: "held-scout-observation-only",
    verdict: "blocked", resolutionImplemented: false, pins: null, before: null, after: null,
    config: null, priorHold: { status: "unresolved" }, reasons: [reason]
  };
}

function summarizeSnapshot(snapshot: LeakSnapshot): SnapshotSummary {
  return {
    takenAt: snapshot.takenAt,
    liveWorkspace: {
      path: snapshot.liveWorkspace.path!, projectCount: snapshot.liveWorkspace.projectCount!,
      queueRevision: snapshot.liveWorkspace.queueRevision!, productionPolicy: snapshot.liveWorkspace.productionPolicy!,
      productionPolicyReceipts: snapshot.liveWorkspace.productionPolicyReceipts!,
      productionAdmissions: snapshot.liveWorkspace.productionAdmissions!, observed: true
    },
    hashes: { ...snapshot.hashes },
    goBroker: { entries: Object.keys(snapshot.goBroker).length, sha256: sha256(JSON.stringify(Object.entries(snapshot.goBroker).sort(([a], [b]) => a.localeCompare(b)))) },
    launchAgents: { entries: Object.keys(snapshot.launchAgents).length, sha256: sha256(JSON.stringify(Object.entries(snapshot.launchAgents).sort(([a], [b]) => a.localeCompare(b)))) }
  };
}

function exactTrustEntryDiff(beforeText: string, afterText: string, fixtureTrustPath: string): boolean {
  if (/[\n\r\\"]/.test(fixtureTrustPath) || beforeText.includes("\\")) return false;
  const section = `[projects."${fixtureTrustPath}"]\ntrust_level = "trusted"\n`;
  if (!afterText.endsWith(section)) return false;
  // Attribute only when every pre-existing project table uses this simple header form;
  // unsupported TOML variants and backslash escapes stop the trust-only claim instead of being normalized.
  for (const sourceLine of beforeText.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line.startsWith("[")) continue;
    const candidate = line.split("#", 1)[0].trim();
    if (!candidate.includes("projects")) continue;
    const projectHeader = candidate.match(/^\[\s*projects\s*\.\s*"([^"]+)"\s*\]$/);
    if (!projectHeader || projectHeader[1] === fixtureTrustPath) return false;
  }
  return afterText.slice(0, -section.length) === beforeText
    && !beforeText.includes(fixtureTrustPath);
}

function snapshotObserved(value: unknown): value is LeakSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "takenAt", "liveWorkspace", "hashes", "goBroker", "launchAgents"], ["liveActivity", "liveRefs"])) return false;
  if (value.schema !== "arcadia-leak-check-v1" || typeof value.takenAt !== "string" || Number.isNaN(Date.parse(value.takenAt))) return false;
  if (!hasExactKeys(value.liveWorkspace, ["path", "projectCount", "queueRevision", "productionPolicy", "productionPolicyReceipts", "productionAdmissions", "error"])) return false;
  const live = value.liveWorkspace;
  if (live.error !== null || typeof live.path !== "string" || !path.isAbsolute(live.path)
    || !Number.isSafeInteger(live.projectCount) || (live.projectCount as number) < 0
    || !Number.isSafeInteger(live.queueRevision) || (live.queueRevision as number) < 0
    || !hasExactKeys(live.productionPolicy, ["desiredState", "revision", "epoch"])
    || live.productionPolicy.desiredState !== "inactive"
    || !Number.isSafeInteger(live.productionPolicy.revision) || (live.productionPolicy.revision as number) < 0
    || !Number.isSafeInteger(live.productionPolicy.epoch) || (live.productionPolicy.epoch as number) < 0
    || !Number.isSafeInteger(live.productionPolicyReceipts) || (live.productionPolicyReceipts as number) < 0
    || !Number.isSafeInteger(live.productionAdmissions) || (live.productionAdmissions as number) < 0) return false;
  if (!hasExactKeys(value.hashes, REQUIRED_HASHES) || REQUIRED_HASHES.some((key) => {
    const hash = (value.hashes as Record<string, unknown>)[key];
    return hash !== null && (typeof hash !== "string" || !SHA.test(hash));
  })) return false;
  if (!isRecord(value.goBroker) || !isRecord(value.launchAgents)) return false;
  return Object.values(value.goBroker).every((entry) => typeof entry === "string" && entry.length > 0)
    && Object.values(value.launchAgents).every((hash) => typeof hash === "string" && SHA.test(hash));
}

function validatePins(value: unknown): value is ScoutPins {
  if (!hasExactKeys(value, ["sourceRevision", "nodeVersion", "model", "effort", "fixtureRoot", "workspace", "fixtureRepo", "liveWorkspacePath", "fixtureTrustPath"])) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

export function evaluateScoutPreflight(value: unknown): ScoutPreflightReceipt {
  if (!hasExactKeys(value, ["pins", "before", "after", "priorHold"], ["codexConfigDiff"])) return blockedReceipt("preflight input shape is missing required fields or contains unknown fields");
  if (!validatePins(value.pins)) return blockedReceipt("preflight pins are missing, malformed, or contain unknown fields");
  const pins = value.pins;
  if (value.before !== null && !snapshotObserved(value.before)) return blockedReceipt("before snapshot is malformed, unobserved, or contains unknown fields");
  if (value.after !== null && !snapshotObserved(value.after)) return blockedReceipt("after snapshot is malformed, unobserved, or contains unknown fields");
  if (!hasExactKeys(value.priorHold, ["status"]) || value.priorHold.status !== "unresolved") return blockedReceipt("prior isolation hold is missing or invalid");
  let diff: ScoutInput["codexConfigDiff"];
  if (value.codexConfigDiff !== undefined) {
    if (!hasExactKeys(value.codexConfigDiff, ["before", "after"])
      || typeof value.codexConfigDiff.before !== "string" || typeof value.codexConfigDiff.after !== "string"
      || value.codexConfigDiff.before.length > 4_000_000 || value.codexConfigDiff.after.length > 4_000_000) {
      return blockedReceipt("config diff is malformed");
    }
    diff = { before: value.codexConfigDiff.before, after: value.codexConfigDiff.after };
  }
  const safePins: ScoutPins = { ...pins };
  const reasons: string[] = [];
  if (!REVISION.test(pins.sourceRevision)) reasons.push("source revision must be an immutable SHA");
  if (!/^v22\./.test(pins.nodeVersion)) reasons.push("runtime must be Node 22");
  if (pins.model !== "gpt-6-luna" || pins.effort !== "low") reasons.push("requested model and effort must be gpt-6-luna/low");

  // All input strings and object shapes are validated before path normalization.
  const fixtureRoot = path.resolve(pins.fixtureRoot);
  const workspace = path.resolve(pins.workspace);
  const fixtureRepo = path.resolve(pins.fixtureRepo);
  const trustPath = path.resolve(pins.fixtureTrustPath);
  const liveWorkspacePath = path.resolve(pins.liveWorkspacePath);
  if (![pins.fixtureRoot, pins.workspace, pins.fixtureRepo, pins.fixtureTrustPath, pins.liveWorkspacePath].every((item) => path.isAbsolute(item))) {
    reasons.push("all scope paths must be absolute");
  }
  if (workspace === fixtureRoot || !workspace.startsWith(`${fixtureRoot}${path.sep}`)) reasons.push("fixture workspace must be inside the explicit fixture root");
  if (fixtureRepo !== workspace && !fixtureRepo.startsWith(`${workspace}${path.sep}`)) reasons.push("fixture repository must be inside the disposable workspace");
  if (trustPath !== fixtureRepo && !trustPath.startsWith(`${fixtureRepo}${path.sep}`)
    || pins.fixtureTrustPath.includes("\\") || pins.fixtureTrustPath.includes('"')) reasons.push("fixture trust path must equal or be inside the pinned repository");
  if (!path.isAbsolute(pins.liveWorkspacePath) || liveWorkspacePath === workspace || liveWorkspacePath.startsWith(`${workspace}${path.sep}`)) reasons.push("live protected workspace must be distinct from the fixture workspace");
  const before = value.before;
  const after = value.after;
  if (!before || !after) reasons.push("protected before/after observations are incomplete");
  if (before && before.liveWorkspace.path !== liveWorkspacePath) reasons.push("before snapshot differs from the explicit live workspace pin");
  if (after && after.liveWorkspace.path !== liveWorkspacePath) reasons.push("after snapshot differs from the explicit live workspace pin");
  if (before && unverifiableReason(before)) reasons.push("before live-workspace observation is unverified");
  if (after && unverifiableReason(after)) reasons.push("after live-workspace observation is unverified");

  let config: ScoutPreflightReceipt["config"] = null;
  if (before && after) {
    const changes = compareLeakSnapshots(before, after);
    const configChanges = changes.filter((change) => change.field === "hashes.codexConfig");
    if (changes.some((change) => change.field !== "hashes.codexConfig")) reasons.push("protected state changed outside the permitted Codex fixture trust entry");
    if (configChanges.length) {
      const exact = !!diff && typeof before.hashes.codexConfig === "string" && typeof after.hashes.codexConfig === "string"
        && sha256(diff.before) === before.hashes.codexConfig && sha256(diff.after) === after.hashes.codexConfig
        && exactTrustEntryDiff(diff.before, diff.after, pins.fixtureTrustPath);
      config = {
        beforeSha256: before.hashes.codexConfig ?? "", afterSha256: after.hashes.codexConfig ?? "", exactFixtureTrustChange: exact
      };
      if (!exact) reasons.push("Codex config change is unattributed; exact fixture trust content proof is required");
    }
  }
  reasons.push("historical isolation hold unresolved; this observation-only slice has no hold-resolution implementation");
  return {
    schema: "arcadia-scout-isolation-preflight-v1", scope: "held-scout-observation-only",
    verdict: "blocked", resolutionImplemented: false, pins: safePins,
    before: before ? summarizeSnapshot(before) : null, after: after ? summarizeSnapshot(after) : null,
    config, priorHold: { status: "unresolved" }, reasons
  };
}

function safeManifestPath(relative: string): boolean {
  return relative.length > 0 && !relative.includes("\\") && !path.posix.isAbsolute(relative)
    && !/^[a-zA-Z]:/.test(relative) && relative.split("/").every((part) => part !== "" && part !== "." && part !== "..")
    && path.posix.normalize(relative) === relative;
}

function readContained(root: string, relative: string): Buffer {
  if (!safeManifestPath(relative)) throw new Error("unsafe evidence path");
  const target = path.resolve(root, ...relative.split("/"));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("evidence path escapes fixture root");
  const info = lstatSync(target);
  const real = realpathSync(target);
  if (info.isSymbolicLink() || !info.isFile() || !real.startsWith(`${root}${path.sep}`)) throw new Error("evidence entry is not a contained regular file");
  return readFileSync(real);
}

interface VerifiedManifest { checked: number; mismatches: string[]; manifestSha256: string; files: Map<string, Buffer> }

function loadVerifiedManifest(fixtureRootInput: string, expectedManifestSha256: string): VerifiedManifest {
  if (!SHA.test(expectedManifestSha256)) return { checked: 0, mismatches: ["expected manifest SHA is invalid"], manifestSha256: "", files: new Map() };
  let root: string;
  let manifestBytes: Buffer;
  try {
    root = realpathSync(fixtureRootInput);
    manifestBytes = readContained(root, "sha256-manifest.json");
  } catch {
    return { checked: 0, mismatches: ["manifest is unavailable or unsafe"], manifestSha256: "", files: new Map() };
  }
  const manifestSha256 = sha256(manifestBytes);
  if (manifestSha256 !== expectedManifestSha256) return { checked: 0, mismatches: ["manifest SHA does not match custody pin"], manifestSha256, files: new Map() };
  let manifest: unknown;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")) as unknown; }
  catch { return { checked: 0, mismatches: ["manifest JSON is malformed"], manifestSha256, files: new Map() }; }
  if (!isRecord(manifest) || Object.keys(manifest).length === 0
    || Object.entries(manifest).some(([file, hash]) => !safeManifestPath(file) || typeof hash !== "string" || !SHA.test(hash))) {
    return { checked: 0, mismatches: ["manifest schema, paths, or hashes are invalid"], manifestSha256, files: new Map() };
  }
  const missing = CONSUMED_FILES.filter((file) => !Object.hasOwn(manifest, file));
  if (missing.length) return { checked: 0, mismatches: ["manifest omits consumed evidence"], manifestSha256, files: new Map() };
  const files = new Map<string, Buffer>();
  const mismatches: string[] = [];
  for (const [relative, expected] of Object.entries(manifest)) {
    try {
      const bytes = readContained(root, relative);
      if (sha256(bytes) !== expected) mismatches.push(relative);
      else files.set(relative, bytes);
    } catch {
      mismatches.push(relative);
    }
  }
  return { checked: Object.keys(manifest).length, mismatches, manifestSha256, files };
}

export function verifyEvidenceManifest(fixtureRootInput: string, expectedManifestSha256: string) {
  const { checked, mismatches, manifestSha256 } = loadVerifiedManifest(fixtureRootInput, expectedManifestSha256);
  return { checked, mismatches, manifestSha256 };
}

function blockedReplay(pins: ScoutPins, integrity: Omit<VerifiedManifest, "files">, sourceReason: string) {
  const evaluation = evaluateScoutPreflight({ pins, before: null, after: null, priorHold: { status: "unresolved" } });
  return {
    schema: "arcadia-scout-offline-replay-v1", evidenceIntegrity: integrity, replayAvailable: false,
    productOutcome: null, verified: [], hypotheses: [], observations: null, historicalBeforeState: null,
    historicalSourcePin: { setupRevision: null, finishRevision: null, status: "unverified" },
    preflight: evaluation, modelCallsMadeByReplay: 0,
    blockers: [sourceReason, ...evaluation.reasons]
  };
}

export function deriveHistoricalSourcePin(setup: unknown, finish: unknown) {
  const setupRevision = typeof setup === "string" && REVISION.test(setup) ? setup : null;
  const finishRevision = typeof finish === "string" && REVISION.test(finish) ? finish : null;
  return {
    setupRevision, finishRevision,
    status: setupRevision && finishRevision && setupRevision !== finishRevision ? "changed-between-captured-heads" : "unverified"
  };
}

export function replayRetainedScout(fixtureRootInput: string, expectedManifestSha256: string, executionPins: ScoutPins) {
  let root: string;
  try { root = realpathSync(fixtureRootInput); }
  catch {
    const integrity = { checked: 0, mismatches: ["fixture root is unavailable or unsafe"], manifestSha256: "" };
    return blockedReplay(executionPins, integrity, "retained evidence root was unavailable");
  }
  const loaded = loadVerifiedManifest(root, expectedManifestSha256);
  const integrity = { checked: loaded.checked, mismatches: loaded.mismatches, manifestSha256: loaded.manifestSha256 };
  if (loaded.mismatches.length) return blockedReplay(executionPins, integrity, "retained evidence failed custody-pinned manifest verification");
  const file = (name: string) => loaded.files.get(name)!;
  const json = <T>(name: string) => JSON.parse(file(name).toString("utf8")) as T;
  let report: Record<string, any>;
  let before: LeakSnapshot;
  let leakAfter: Record<string, any>;
  let attribution: Record<string, any>;
  let retryAsk: Record<string, any>;
  let approval: Record<string, any>;
  let worker: Record<string, any>;
  let builder: Record<string, any>;
  let missingTodo: Record<string, any>;
  let builderPrompt: string;
  try {
    report = json("report.json");
    before = parseLeakSnapshot(file("arcadia-luna-scout-before.json").toString("utf8"), "retained before snapshot");
    leakAfter = json("arcadia-luna-scout-leak-after.json");
    attribution = json("arcadia-luna-scout-trust-attribution.json");
    retryAsk = json("evidence/retry-01-ask.json"); approval = json("evidence/operator-approval.json");
    worker = json("evidence/worker-result.json"); builder = json("builder/metadata.json");
    missingTodo = json("evidence/04-todo-final.json"); builderPrompt = file("builder/prompt.md").toString("utf8");
  } catch {
    return blockedReplay(executionPins, integrity, "a custody-pinned consumed evidence file is malformed");
  }
  const observedLivePath = snapshotObserved(before) && typeof before.liveWorkspace.path === "string"
    ? before.liveWorkspace.path : executionPins.liveWorkspacePath;
  const pins = { ...executionPins, liveWorkspacePath: observedLivePath };
  const preflight = evaluateScoutPreflight({ pins, before, after: null, priorHold: { status: "unresolved" } });
  let observations;
  try {
    observations = deriveRetainedScoutObservations({ report, retryAsk, approval, worker, builder, builderPrompt, missingTodo });
  } catch {
    return blockedReplay(pins, integrity, "retained replay fields are missing or malformed");
  }
  const historicalSourcePin = deriveHistoricalSourcePin(report.setupSourceHead, report.finishSourceHead);
  const verified = [
    ...(report.outcome === "no" && report.fileProduced === false && report.exactBytes === false ? ["The retained trial produced no exact HelloWorld.txt artifact."] : []),
    ...(observations.originalScopeOneFile ? ["The retained retry Ask records the original one-file HelloWorld.txt scope before the generated artifact adds tests."] : []),
    ...(observations.runStatus === "requires_review" && observations.actionNone ? ["The Run remained requires_review with no Action/work-item id."] : []),
    ...(observations.validationMissingFile ? ["The saved builder validation failed because HelloWorld.txt was missing."] : []),
    ...(historicalSourcePin.status === "changed-between-captured-heads" ? ["Saved setup and finish source SHAs differ."] : [])
  ];
  const hypotheses = [
    "The approval response, null Action/work-item identifiers, and pending-approval packet may jointly explain the builder refusal; the sole root cause is not isolated.",
    "The Codex config delta may be the fixture trust entry; current evidence does not prove that attribution."
  ];
  return {
    schema: "arcadia-scout-offline-replay-v1", evidenceIntegrity: integrity, replayAvailable: true,
    productOutcome: report.outcome, verified, hypotheses, observations,
    historicalBeforeState: {
      observed: before.liveWorkspace.error === null, projectCount: before.liveWorkspace.projectCount,
      queueRevision: before.liveWorkspace.queueRevision,
      productionDesiredState: before.liveWorkspace.productionPolicy?.desiredState ?? null,
      protectedContent: { ...before.hashes }
    },
    historicalSourcePin, modelCallsMadeByReplay: 0, preflight,
    blockers: [...preflight.reasons, ...(attribution.baselineHashReconstructed === false ? ["Historical Codex config content attribution remains unresolved"] : [])],
    historicalLeakCheckRejected: leakAfter.ok === false,
    trustAttribution: attribution.fixtureTrustSectionFound === true && attribution.baselineHashReconstructed === false ? "unresolved" : "not-proven"
  };
}

export function deriveRetainedScoutObservations(input: {
  report: Record<string, any>; retryAsk: Record<string, any>; approval: Record<string, any>;
  worker: Record<string, any>; builder: Record<string, any>; builderPrompt: string; missingTodo: Record<string, any>;
}) {
  const requestedAction = input.retryAsk?.data?.intake?.extractedFields?.requestedAction;
  const generatedArtifact = input.retryAsk?.data?.resolvedIntent?.expectedArtifact;
  if (input.report.outcome !== "no" || input.report.fileProduced !== false || input.report.exactBytes !== false
    || input.report.run?.status !== "requires_review" || !Array.isArray(input.builder.changedFiles)
    || !Array.isArray(input.report.builder?.validation) || typeof generatedArtifact !== "string"
    || typeof requestedAction !== "string" || typeof input.approval?.data?.result?.summary !== "string"
    || typeof input.worker.work_item_id === "undefined") throw new Error("required replay evidence is missing or malformed");
  return {
    requestedFile: "HelloWorld.txt", expectedUtf8Hex: "48656c6c6f20576f726c64210a", expectedByteLength: 13,
    originalScopeOneFile: requestedAction === "implement HelloWorld.txt" && /original constraints/i.test(String(input.report.scout?.scopeStop ?? "")),
    generatedScopeAppendedTests: /tests/i.test(generatedArtifact), generatedExpectedArtifactLength: generatedArtifact.length,
    askRequiresReview: input.retryAsk?.data?.intake?.reviewRequired === true,
    promptApprovedHeading: /approved/i.test(input.builderPrompt), promptReviewMarker: /review/i.test(input.builderPrompt),
    promptDecisionMarker: /decision/i.test(input.builderPrompt), promptActionMarker: /action/i.test(input.builderPrompt),
    promptNoneMarker: /none/i.test(input.builderPrompt), runAbsentFromAsk: input.retryAsk?.data?.run === null,
    runAbsentFromApproval: input.approval?.data?.run === null,
    approvalClaimsResumeWithoutRun: input.approval?.data?.run == null && /resuming execution/i.test(input.approval.data.result.summary),
    runStatus: input.report.run?.status ?? null,
    actionNone: input.report.run?.work_item_id == null && input.worker.work_item_id == null,
    changedFiles: input.builder.changedFiles.length,
    validationMissingFile: input.report.builder.validation.some((item: any) => {
      const output = typeof item?.output === "string" ? item.output : "";
      return output.includes("ENOENT") && /(?:open\s+['"]HelloWorld\.txt['"]|ENOENT:\s*['"]?HelloWorld\.txt['"]?(?=$|[\s,;:]))/i.test(output);
    }),
    todoSourceAvailable: !(typeof input.missingTodo?.data?.askUnavailable === "string"
      || (Array.isArray(input.missingTodo?.data?.unavailable) && input.missingTodo.data.unavailable.length > 0))
  };
}
