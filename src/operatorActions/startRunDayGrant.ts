import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DAY_GRANT_DECISION, StartRunDelegationError } from "./startRunDelegation.js";

/**
 * Decision 0173 (option A), the START part: the operator's press of a day-grant card on /actions approves one day, exactly
 * 24 hours from that press, and Rowan may press START cards it prepared within that window. This module is the read-only
 * computation `arcadia start-run pins --day-grant-from` uses; scripts/start-run.sh (P0) verifies the same chain again from
 * the same files and the same evidence, and both refuse with the same code.
 *
 * What a machine can establish here, and what it cannot:
 *  - The press is the only approval. Decision 0173 also allows "the operator's own message in Rowan's chat", but nothing
 *    can verify a chat message and a record Rowan wrote about it would be self-attesting, so that route is not built.
 *  - "Operator press" means: through the /actions runner, without a delegated marker, from a browser at a non-loopback
 *    address. The dashboard has no identity layer (apps/dashboard/app/lib/originGuard.ts), so this is not proof of who
 *    pressed. It stops accidents, not an agent set on forging it: a process on this host could send those headers, drive a
 *    browser at the Tailnet name or rewrite these files, and no check here can detect that.
 *  - A cause is Rowan's judgement. The card must carry it and the evidence pointer; the checks here compare what was named
 *    (and, for refusals, the executor's own recorded reason). They cannot prove the cause is right or truly cleared.
 *
 * Everything the executor reads is a file on disk: the library (approval, presses, receipts) and, through the read-only
 * `arcadia start-run day-evidence`, the policy receipts and admissions in the workspace database, the only record of who
 * moved production and whether a Session was admitted.
 */
export { DAY_GRANT_DECISION };
export const DAY_GRANT_WINDOW_MS = 24 * 3_600_000;
/**
 * Decision 0181 (option A) re-decided Decision 0170's three-attempt limit: unattended batches run at concurrency one under the
 * day's approval, "and a batch that fails stops for the operator". So no count of attempts caps a day any more; instead one
 * failed batch under the current day's approval refuses every later delegated card, and the operator's next day-grant press
 * is their decision after that failure. See `isFailedBatch` for what failed means. Since Decision 0185 a failed batch is
 * this one stop unless a merged fix clears it (below): one uncleared failed batch refuses.
 */
export const DAY_GRANT_MAX_FAILED_BATCHES = 1;
/**
 * Decision 0185 (option A) re-decided that stop: after a failed delegated batch, Rowan may press the next card under the same
 * day's approval only when a fix for that batch's named cause merged to main after the failure. The card that follows the
 * failed press names it as a `failed-attempt` with a `merged-fix` clearance whose `cause` is the cause it names; the executor
 * then checks at the pin that the fix's commit is on the reviewed revision, is dated after the batch ended, and that Decision
 * 0185 is answered with option A there. So until that answer is on main, a failed batch still stops for the operator. The
 * fix's independent review and green checks are Rowan's recorded judgement, not machine-proved, like the cause itself.
 */
export const CONTINUE_DECISION = "0185";
export const CONTINUE_ANSWER = "A. Continue after a reviewed fix merges";
/** Decision 0173: refused re-presses per day, in total, however the card is re-prepared. */
export const DAY_GRANT_MAX_REPRESSES = 2;
/** Decision 0170 was answered on main at ffd23b342 (2026-11-03T19:26:51Z); presses and attempts are numbered from there. */
export const ATTEMPT_COUNT_EARLIEST = "2026-11-03T19:26:51Z";
/**
 * The request id that marks an Off as Rowan's own, which does not end the day. Fail-closed: any other Off ends it. This is
 * self-attested, but only Rowan's own Off can carry it: a STOP card's and the dashboard switch's ids are written by those
 * paths (`<card>-<run>`, `dashboard-toggle-*`) and a receipt's id never changes afterwards.
 */
export const ROWAN_OFF_REQUEST = /^rowan-off-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * The operator's STOP card: the card's pinned `offId`, and any card of this family whatever a card pins. A STOP pressed while
 * production is Off writes no policy receipt (it records `already_inactive`), so its press is the only record that it ended the day.
 */
export const STOP_CARD = /^restore-off-production(?:-|$)/;
export const DAY_GRANT_EXECUTOR_PATH = "scripts/day-grant.sh";

export interface DayGrantPins {
  schema: "arcadia-day-grant-v1";
  decision: typeof DAY_GRANT_DECISION;
  executorSha256: string;
  project: string;
  /** The active Plan the operator approves; a START card of any other Plan is refused for this day. */
  plan: string;
  provider: "claude-code-cli";
  concurrency: 1;
  spendDecision: string;
}
export const DAY_GRANT_KEYS = ["concurrency", "decision", "executorSha256", "plan", "project", "provider", "schema", "spendDecision"];

export type DayGrantClearance =
  /** `cause`: the cause the fix addresses. Required, and equal to the named cause, when it clears a failed batch (Decision 0185). */
  | { kind: "merged-fix"; pullRequest: string; commit: string; reproduction: string; cause?: string }
  | { kind: "observed-cleared"; observation: string };

/**
 * What production's record makes a START press: it admitted no Session (`no-session`), or it admitted one and its batch
 * either reached scope complete with no escalation (`clean-batch`) or did not (`failed-attempt`). Decision 0181.
 */
export type DayGrantPressKind = "failed-attempt" | "clean-batch" | "no-session";
export const DAY_GRANT_PRESS_KINDS: readonly DayGrantPressKind[] = ["failed-attempt", "clean-batch", "no-session"];

/** Rowan's recorded judgement of the latest press: named, with an evidence pointer; recorded, not machine-proved. */
export interface DayGrantPrevious {
  /** `<card>/<press run id>` of the latest START press. */
  press: string;
  kind: DayGrantPressKind;
  /** A stable slug: two presses with one cause must carry the same slug. */
  cause: string;
  evidence: string;
  clearance: DayGrantClearance;
}

/** startRun.delegation on a START card Rowan presses under Decision 0173. */
export interface DayGrantDelegation {
  decision: typeof DAY_GRANT_DECISION;
  approvalCard: string;
  approvalRun: string;
  /** sha256 of the approval's final receipt.json and of its press record run.json; a change to either refuses. */
  approvalReceiptSha256: string;
  approvalPressSha256: string;
  /** The attempt this press would be, numbered since Decision 0170, if it admits a Session. A number, never a cap (Decision 0181). */
  attempt: number;
  /** Null only when no START press has happened since Decision 0170. */
  previous: DayGrantPrevious | null;
}
export const DAY_GRANT_DELEGATION_KEYS = ["approvalCard", "approvalPressSha256", "approvalReceiptSha256", "approvalRun", "attempt", "decision", "previous"];

/** The read-only production record `arcadia start-run day-evidence` prints. */
export interface DayEvidence {
  transitions: Array<{ requestId: string; transition: "activate" | "deactivate"; revisionBefore: number; revisionAfter: number; at: string }>;
  /**
   * Each activation since Decision 0170, with how many Sessions it admitted (committed admissions), when production next went
   * Off (null while it has not), and the tick's `managed_production.scope_complete` record within that run (null when none).
   */
  activations: DayEvidenceActivation[];
}
export interface DayEvidenceActivation {
  requestId: string;
  revisionAfter: number;
  at: string;
  admitted: number;
  endedAt: string | null;
  scopeComplete: { merged: number; escalated: number } | null;
}

/**
 * Decision 0181: "a batch that fails stops for the operator". A batch is one activation that admitted at least one Session.
 * It is clean only when production's own record shows the tick announced scope complete inside that run (every in-scope
 * Action done: the event Decision 0171's Off at scope complete follows) with no in-scope Action escalated to the operator.
 * Anything else failed: an Off before scope complete (Rowan's, the executor's or the operator's), an escalation, a run still
 * open, or a record that does not say. An activation that admitted no Session is no batch. Fail closed: a missing or malformed
 * scope-complete record reads as failed, since a false failure stops for the operator and a false clean runs past the stop.
 */
export function isFailedBatch(activation: Pick<DayEvidenceActivation, "admitted" | "scopeComplete">): boolean {
  if (!(activation.admitted >= 1)) return false;
  const done = activation.scopeComplete;
  return !(done && Number.isInteger(done.merged) && done.merged >= 1 && done.escalated === 0);
}

/** The failed batches that count against a day: every one not over before the operator's press opened it. */
export function failedBatchesInWindow(evidence: DayEvidence, opensAtMs: number): DayEvidenceActivation[] {
  return evidence.activations.filter((a) => isFailedBatch(a) && !(typeof a.endedAt === "string" && Date.parse(a.endedAt) < opensAtMs));
}

const refuse = (code: string, message: string): never => { throw new StartRunDelegationError(code, message); };
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const runIdPattern = /^[0-9]{8}T[0-9]{6}Z-[0-9]+$/;
const sha256Hex = /^[0-9a-f]{64}$/;
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const readJson = <T>(file: string): T | null => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return null; } };
/** Only a directory that is not there is empty. Any other read error could hide an earlier press, so it refuses (fail closed). */
const listDirectory = (directory: string): string[] => {
  try { return readdirSync(directory); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    return refuse("PRESS_UNREADABLE", `${directory} cannot be listed (${String(code)}), so earlier presses cannot be counted or ruled out; preserve it and stop for the operator`);
  }
};
const notAWord = (value: string) => value === "undefined" || value === "null";
const pointer = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 500 && !value.includes("\n") && !notAWord(value)
  && (/^https:\/\/\S+$/.test(value) || (!path.isAbsolute(value) && !value.split("/").includes("..")));
const repoRelative = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 300 && !value.includes("\n") && !path.isAbsolute(value) && !value.split("/").some((part) => part === ".." || part === "." || part === "");
const exactKeys = (value: unknown, keys: string[]): boolean => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();

export function validateDayGrantPins(value: unknown): DayGrantPins {
  const p = value as DayGrantPins;
  if (!exactKeys(p, DAY_GRANT_KEYS)) refuse("INVALID_DAY_GRANT", `dayGrant needs exactly ${DAY_GRANT_KEYS.join(", ")}.`);
  if (p.schema !== "arcadia-day-grant-v1") refuse("INVALID_DAY_GRANT", "dayGrant.schema must be arcadia-day-grant-v1.");
  if (p.decision !== DAY_GRANT_DECISION) refuse("INVALID_DAY_GRANT", "dayGrant.decision must be 0173.");
  if (typeof p.executorSha256 !== "string" || !sha256Hex.test(p.executorSha256)) refuse("INVALID_DAY_GRANT", "dayGrant.executorSha256 must be 64 lowercase hex.");
  if (typeof p.project !== "string" || !slug.test(p.project) || typeof p.plan !== "string" || !slug.test(p.plan)) refuse("INVALID_DAY_GRANT", "dayGrant.project and plan must be slugs.");
  if (p.provider !== "claude-code-cli") refuse("INVALID_DAY_GRANT", "dayGrant.provider must be claude-code-cli.");
  if (p.concurrency !== 1) refuse("INVALID_DAY_GRANT", "dayGrant.concurrency must be 1.");
  if (typeof p.spendDecision !== "string" || !/^\d{4}$/.test(p.spendDecision)) refuse("INVALID_DAY_GRANT", "dayGrant.spendDecision must be a four-digit Decision id.");
  return p;
}

export function validateDayGrantDelegation(value: unknown): DayGrantDelegation {
  const d = value as DayGrantDelegation;
  if (!exactKeys(d, DAY_GRANT_DELEGATION_KEYS)) refuse("INVALID_DELEGATION", `startRun.delegation needs exactly ${DAY_GRANT_DELEGATION_KEYS.join(", ")}.`);
  if (d.decision !== DAY_GRANT_DECISION) refuse("INVALID_DELEGATION", "startRun.delegation.decision must be 0173.");
  if (typeof d.approvalCard !== "string" || !slug.test(d.approvalCard)) refuse("INVALID_DELEGATION", "startRun.delegation.approvalCard must be a card id.");
  if (typeof d.approvalRun !== "string" || !runIdPattern.test(d.approvalRun)) refuse("INVALID_DELEGATION", "startRun.delegation.approvalRun must be an executor run id.");
  for (const hash of [d.approvalReceiptSha256, d.approvalPressSha256]) if (typeof hash !== "string" || !sha256Hex.test(hash)) refuse("INVALID_DELEGATION", "startRun.delegation approval hashes must be 64 lowercase hex.");
  if (!Number.isInteger(d.attempt) || d.attempt < 1) refuse("INVALID_DELEGATION", "startRun.delegation.attempt must be a positive whole number.");
  if (d.previous !== null) validateDayGrantPrevious(d.previous);
  return d;
}

export function validateDayGrantPrevious(value: unknown): DayGrantPrevious {
  const p = value as DayGrantPrevious;
  if (!exactKeys(p, ["cause", "clearance", "evidence", "kind", "press"])) refuse("INVALID_DELEGATION", "startRun.delegation.previous needs exactly press, kind, cause, evidence, clearance.");
  if (typeof p.press !== "string" || !p.press.includes("/")) refuse("INVALID_DELEGATION", "previous.press must be <card>/<press run id>.");
  if (!DAY_GRANT_PRESS_KINDS.includes(p.kind)) refuse("INVALID_DELEGATION", "previous.kind must be failed-attempt, clean-batch or no-session.");
  if (typeof p.cause !== "string" || !slug.test(p.cause) || notAWord(p.cause)) refuse("INVALID_DELEGATION", "previous.cause must be a stable slug naming the cause.");
  if (!pointer(p.evidence)) refuse("INVALID_DELEGATION", "previous.evidence must be an https URL or a repository-relative path.");
  const c = p.clearance;
  if (c?.kind === "merged-fix") {
    if (!exactKeys(c, ["commit", "kind", "pullRequest", "reproduction"]) && !exactKeys(c, ["cause", "commit", "kind", "pullRequest", "reproduction"])) refuse("INVALID_DELEGATION", "A merged-fix clearance needs exactly pullRequest, commit and reproduction, and may name the cause it fixes.");
    if (c.cause !== undefined && (typeof c.cause !== "string" || !slug.test(c.cause) || notAWord(c.cause))) refuse("INVALID_DELEGATION", "clearance.cause must be the stable slug of the cause the fix addresses.");
    if (typeof c.pullRequest !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/.test(c.pullRequest)) refuse("INVALID_DELEGATION", "clearance.pullRequest must be a pull request URL.");
    if (typeof c.commit !== "string" || !/^[0-9a-f]{40}$/.test(c.commit)) refuse("INVALID_DELEGATION", "clearance.commit must be a full commit id.");
    if (!repoRelative(c.reproduction)) refuse("INVALID_DELEGATION", "clearance.reproduction must be the repository-relative fixture or replay that reproduces the cause.");
  } else if (c?.kind === "observed-cleared") {
    if (!exactKeys(c, ["kind", "observation"])) refuse("INVALID_DELEGATION", "An observed-cleared clearance needs exactly observation.");
    if (!pointer(c.observation)) refuse("INVALID_DELEGATION", "clearance.observation must be an https URL or a repository-relative path.");
  } else refuse("INVALID_DELEGATION", "previous.clearance.kind must be merged-fix or observed-cleared.");
  return p;
}

const isLoopback = (hostname: string): boolean => {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name === "::1" || name === "::" || name === "0.0.0.0" || /^127\.\d+\.\d+\.\d+$/.test(name) || /^::ffff:7f[0-9a-f]{2}:/.test(name);
};

/**
 * The /actions runner's gate for a day-grant card: a browser page on this dashboard, reached at a non-loopback address.
 * The operator is offsite and uses the Tailnet URL, which is plain HTTP, so browsers send no `Sec-Fetch-*` there; they do
 * send `Origin` on a same-origin POST (Chromium and WebKit observed against an echo server at the Tailnet name). A scripted
 * POST sends no `Origin`, and a browser on this host at 127.0.0.1 is refused as a loopback address. This stops accidents,
 * not an agent set on forging it: there is no identity layer, so it says how a press came, not who made it.
 */
export function isOperatorBrowserPress(headers: { origin: string | null; host: string | null }): boolean {
  if (!headers.origin || !headers.host) return false;
  try {
    const origin = new URL(headers.origin);
    if ((origin.protocol !== "http:" && origin.protocol !== "https:") || origin.origin !== headers.origin) return false;
    const host = new URL(`${origin.protocol}//${headers.host}`);
    return origin.host === host.host && !isLoopback(origin.hostname) && !isLoopback(host.hostname);
  } catch { return false; }
}

/** The exact launcher of a day-grant card; every pin lives in its descriptor. */
export function dayGrantLauncher(id: string): string {
  if (!slug.test(id)) refuse("INVALID_DAY_GRANT", "Operator action id must be a lowercase slug.");
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `exec "$(cd "$(dirname "\${BASH_SOURCE[0]}")/../../.." && pwd -P)/${DAY_GRANT_EXECUTOR_PATH}" "\${1:-run}" "$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd -P)/${id}.json"`,
    ""
  ].join("\n");
}

interface ApprovalReceipt { schema?: string; id?: string; runId?: string; mode?: string; outcome?: string; allowanceConsumed?: boolean; record?: { operatorRunId?: string; policyRevisionAtApproval?: unknown; pressStartedAt?: string; windowClosesAt?: string; project?: unknown; plan?: unknown; provider?: unknown; spendDecision?: unknown } }
interface PressRecord { schema?: string; scriptId?: string; runId?: string; status?: string; startedAt?: string; press?: unknown; browserPress?: unknown }
interface StartReceipt { id?: string; runId?: string; mode?: string; outcome?: string; reason?: string; phase?: string; allowanceConsumed?: boolean; offCleanup?: string; record?: { operatorRunId?: string } }

export interface DayGrantWindow { opensAt: string; closesAt: string; closesAtMs: number; opensAtMs: number; baselineRevision: number; pins: DayGrantPins; receiptSha256: string; pressSha256: string }

/**
 * The approval itself, from the library: its receipt and press record unchanged, a press through the runner by a browser
 * request with no delegated marker, consumed by this very run, with a window of exactly 24 hours from the press.
 */
export function inspectDayApproval(library: string, card: string, run: string, receiptSha: string | null, pressSha: string | null, now: Date, offId: string): DayGrantWindow {
  if (!slug.test(card) || !runIdPattern.test(run)) refuse("INVALID_DELEGATION", "the approval card or run id is malformed");
  const receiptPath = path.join(library, "runs", card, run, "receipt.json");
  if (!existsSync(receiptPath)) refuse("APPROVAL_MISSING", `the approval receipt ${receiptPath} does not exist`);
  const receiptBytes = readFileSync(receiptPath);
  const receiptSha256 = sha256(receiptBytes);
  if (receiptSha !== null && receiptSha256 !== receiptSha) refuse("APPROVAL_CHANGED", "the approval receipt changed since this card was pinned");
  let receipt: ApprovalReceipt;
  try { receipt = JSON.parse(receiptBytes.toString("utf8")) as ApprovalReceipt; } catch { return refuse("APPROVAL_NOT_PRESSED", "the approval receipt is unreadable"); }
  const pressId = receipt.record?.operatorRunId;
  if (receipt.schema !== "arcadia-day-grant-receipt-v1" || receipt.id !== card || receipt.runId !== run || receipt.mode !== "run" || receipt.outcome !== "approved" || receipt.allowanceConsumed !== true || typeof pressId !== "string") {
    refuse("APPROVAL_NOT_PRESSED", "the approval is not a consumed, approved /actions press of a day-grant card");
  }
  const consumed = readJson<{ state?: string; requestId?: string; runId?: string }>(path.join(library, `${card}.consumed.json`));
  if (consumed?.state !== "CONSUMED" || consumed.requestId !== card || consumed.runId !== run) refuse("APPROVAL_NOT_PRESSED", "the day-grant card's one-shot marker does not name this run");
  const pressDir = path.join(library, "runs", "operator", card, String(pressId));
  const pressPath = path.join(pressDir, "run.json");
  if (!existsSync(pressPath)) refuse("APPROVAL_NOT_OPERATOR", "the approval has no /actions press record");
  const pressBytes = readFileSync(pressPath);
  const pressSha256 = sha256(pressBytes);
  if (pressSha !== null && pressSha256 !== pressSha) refuse("APPROVAL_CHANGED", "the approval press record changed since this card was pinned");
  const press = readJson<PressRecord>(pressPath);
  if (press?.schema !== "arcadia-operator-script-run-v1" || press.scriptId !== card || press.runId !== pressId || press.status !== "succeeded") refuse("APPROVAL_NOT_OPERATOR", "the approval press record is not this card's finished /actions press");
  if (press!.press !== undefined) refuse("APPROVAL_NOT_OPERATOR", "a delegated press never counts as the operator's day approval");
  if (press!.browserPress !== true) refuse("APPROVAL_NOT_OPERATOR", "the approval was not pressed from the /actions page in a browser");
  let claimed = "";
  try { claimed = readFileSync(path.join(pressDir, "day-grant.claimed"), "utf8").trim(); } catch { /* checked below */ }
  if (claimed !== run) refuse("APPROVAL_NOT_OPERATOR", "the approval press record was not claimed by this run");
  const pins = readJson<{ dayGrant?: unknown }>(path.join(pressDir, "descriptor.json"))?.dayGrant;
  let validPins: DayGrantPins;
  try { validPins = validateDayGrantPins(pins); } catch { return refuse("APPROVAL_NOT_OPERATOR", "the approval press did not run a day-grant card"); }
  // The press snapshot is not hashed, the receipt is: what the operator approved is what the pinned receipt recorded.
  const recorded = receipt.record!;
  if (recorded.project !== validPins.project || recorded.plan !== validPins.plan || recorded.provider !== validPins.provider || recorded.spendDecision !== validPins.spendDecision) {
    refuse("APPROVAL_CHANGED", "the approval press's day-grant block is not the Project, Plan, provider and spend Decision its receipt recorded");
  }
  const opensAtMs = Date.parse(String(press!.startedAt));
  if (!Number.isFinite(opensAtMs)) refuse("APPROVAL_NOT_OPERATOR", "the approval press has no readable start time");
  const closesAtMs = opensAtMs + DAY_GRANT_WINDOW_MS;
  if (receipt.record!.pressStartedAt !== press!.startedAt || Date.parse(String(receipt.record!.windowClosesAt)) !== closesAtMs) refuse("APPROVAL_CHANGED", "the approval receipt's window is not exactly 24 hours from the press");
  if (now.getTime() >= closesAtMs) refuse("WINDOW_EXPIRED", `the day approved at ${press!.startedAt} ended at ${new Date(closesAtMs).toISOString()}; it never renews itself`);
  if (now.getTime() < opensAtMs) refuse("WINDOW_EXPIRED", "the approval press is in the future");
  const baselineRevision = receipt.record!.policyRevisionAtApproval;
  if (!Number.isInteger(baselineRevision)) refuse("APPROVAL_NOT_PRESSED", "the approval receipt records no policy revision");
  assertPressRecordsReadable(library);
  // Only the operator's latest approval opens the day: nothing later may supersede this one.
  for (const other of listDirectory(path.join(library, "runs", "operator"))) {
    for (const otherPress of listDirectory(path.join(library, "runs", "operator", other))) {
      const dir = path.join(library, "runs", "operator", other, otherPress);
      if (!readJson<{ dayGrant?: unknown }>(path.join(dir, "descriptor.json"))?.dayGrant) continue;
      const record = readJson<PressRecord>(path.join(dir, "run.json"));
      if (record?.status === "succeeded" && record.press === undefined && record.browserPress === true && existsSync(path.join(dir, "day-grant.claimed")) && Date.parse(String(record.startedAt)) > opensAtMs) {
        refuse("APPROVAL_SUPERSEDED", `the operator approved a later day with ${other}/${otherPress}; a card names the latest approval`);
      }
    }
  }
  // Any press of the STOP card since the approval ends the day; one before it does not, so a later approval opens a new day.
  for (const stopCard of listDirectory(path.join(library, "runs", "operator"))) {
    if (stopCard !== offId && !STOP_CARD.test(stopCard)) continue;
    for (const stopPress of listDirectory(path.join(library, "runs", "operator", stopCard))) {
      const dir = path.join(library, "runs", "operator", stopCard, stopPress);
      if (!statSync(dir).isDirectory()) continue;
      const time = pressIdTime(stopPress);
      if (time !== null && time < Date.parse(ATTEMPT_COUNT_EARLIEST)) continue;
      const startedAt = Date.parse(String(readJson<PressRecord>(path.join(dir, "run.json"))?.startedAt));
      if (!Number.isFinite(startedAt)) refuse("PRESS_UNREADABLE", `the press record ${stopCard}/${stopPress} cannot be read, so it cannot be counted or ruled out; preserve it and stop for the operator`);
      if (startedAt >= opensAtMs) refuse("DAY_ENDED_BY_OPERATOR", `the STOP card ${stopCard} was pressed at ${new Date(startedAt).toISOString()}: an operator STOP ends the day, even with production already Off`);
    }
  }
  return { opensAt: String(press!.startedAt), closesAt: new Date(closesAtMs).toISOString(), opensAtMs, closesAtMs, baselineRevision: baselineRevision as number, pins: validPins, receiptSha256, pressSha256 };
}

/** A press id's own timestamp (the runner names each press by it), or null for an id that carries none. */
function pressIdTime(id: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})-/.exec(id);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null;
}

/**
 * Fail closed: every press since Decision 0170 must be readable. A press that cannot be read could be a re-press this
 * chain must count or a later approval that supersedes this one, so it is never skipped. Older presses are out of scope.
 */
function assertPressRecordsReadable(library: string): void {
  const earliest = Date.parse(ATTEMPT_COUNT_EARLIEST);
  const operatorRuns = path.join(library, "runs", "operator");
  for (const card of listDirectory(operatorRuns)) {
    for (const pressId of listDirectory(path.join(operatorRuns, card))) {
      const dir = path.join(operatorRuns, card, pressId);
      try { if (!statSync(dir).isDirectory()) continue; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        refuse("PRESS_UNREADABLE", `the press record ${card}/${pressId} cannot be read, so it cannot be counted or ruled out; preserve it and stop for the operator`);
      }
      const time = pressIdTime(pressId);
      if (time !== null && time < earliest) continue;
      const run = readJson<PressRecord>(path.join(dir, "run.json"));
      if (time === null && run && Date.parse(String(run.startedAt)) < earliest) continue;
      if (!run || !readJson(path.join(dir, "descriptor.json")) || run.schema !== "arcadia-operator-script-run-v1" || run.scriptId !== card || run.runId !== pressId) {
        refuse("PRESS_UNREADABLE", `the press record ${card}/${pressId} cannot be read, so it cannot be counted or ruled out; preserve it and stop for the operator`);
      }
    }
  }
}

interface StartPress { card: string; pressId: string; key: string; startedAt: number; status: string; delegation: { decision?: string; previous?: { press?: string; cause?: string; kind?: unknown; clearance?: unknown } | null } | null; marker: { decision?: string } | null; receipt: StartReceipt | null; admitted: boolean; failed: boolean }

/**
 * Every /actions press of a START card since Decision 0170, oldest first, with whether that press admitted a Session. A card
 * is one-shot, so its activation belongs to the one press that consumed its allowance; a later refused press of the same
 * card admitted nothing. An admitted activation that no press of its card owns is refused rather than guessed at.
 */
function startPresses(library: string, evidence: DayEvidence, excludePress: string | null): StartPress[] {
  const earliest = Date.parse(ATTEMPT_COUNT_EARLIEST);
  const operatorRuns = path.join(library, "runs", "operator");
  const presses: StartPress[] = [];
  for (const card of listDirectory(operatorRuns)) {
    if (!slug.test(card)) continue;
    const receipts = listDirectory(path.join(library, "runs", card)).map((run) => readJson<StartReceipt>(path.join(library, "runs", card, run, "receipt.json")));
    const consumedPath = path.join(library, `${card}.consumed.json`);
    const consumedRun = readJson<{ runId?: string }>(consumedPath)?.runId;
    const activation = evidence.activations.some((a) => a.requestId === card && a.admitted >= 1);
    const batchFailed = evidence.activations.some((a) => a.requestId === card && isFailedBatch(a));
    const before = presses.length;
    for (const pressId of listDirectory(path.join(operatorRuns, card))) {
      if (pressId === excludePress) continue;
      const dir = path.join(operatorRuns, card, pressId);
      const run = readJson<PressRecord & { press?: { decision?: string } }>(path.join(dir, "run.json"));
      const startRun = readJson<{ startRun?: { delegation?: StartPress["delegation"] } }>(path.join(dir, "descriptor.json"))?.startRun;
      if (!run || !startRun || run.schema !== "arcadia-operator-script-run-v1" || run.scriptId !== card || run.runId !== pressId) continue;
      const startedAt = Date.parse(String(run.startedAt));
      if (!Number.isFinite(startedAt) || startedAt < earliest) continue;
      const receipt = receipts.find((r) => r?.mode === "run" && r.record?.operatorRunId === pressId) ?? null;
      const owner = receipt?.allowanceConsumed === true || (!!receipt && !!consumedRun && receipt.runId === consumedRun) || (!receipt && existsSync(path.join(dir, "start-run.claimed")) && existsSync(consumedPath));
      const admitted = owner && activation;
      if (receipt?.outcome === "succeeded" && !evidence.activations.some((a) => a.requestId === card)) refuse("EVIDENCE_MISMATCH", `${card} recorded a successful START but production has no activation under its request id`);
      presses.push({ card, pressId, key: `${card}/${pressId}`, startedAt, status: String(run.status), delegation: startRun.delegation ?? null, marker: run.press ?? null, receipt, admitted, failed: admitted && batchFailed });
    }
    if (activation && presses.length > before && !presses.slice(before).some((press) => press.admitted)) refuse("EVIDENCE_MISMATCH", `production records a Session admitted under ${card}, but no press of that card consumed its allowance`);
  }
  return presses.sort((a, b) => a.startedAt - b.startedAt);
}

/** A refusal's identity: its phase and reason with the run-specific numbers and ids taken out. */
export function refusalKey(receipt: Pick<StartReceipt, "phase" | "reason"> | null): string | null {
  if (!receipt || typeof receipt.reason !== "string" || !receipt.reason.trim()) return null;
  return `${String(receipt.phase)}|${receipt.reason.toLowerCase().replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}t[0-9:.]+z/g, "#").replace(/\b[0-9a-f]{7,64}\b/g, "#").replace(/[0-9]+/g, "#")}`;
}

/** The exact id an executor uses to return its own Grant to Off, with the receipt of that run saying it did. */
function isExecutorOff(requestId: string, cards: Iterable<string>, library: string): boolean {
  for (const card of cards) {
    if (!requestId.startsWith(`${card}-`) || !requestId.endsWith("-off")) continue;
    const run = requestId.slice(card.length + 1, -"-off".length);
    if (!runIdPattern.test(run)) continue;
    const receipt = readJson<StartReceipt>(path.join(library, "runs", card, run, "receipt.json"));
    if (receipt?.id === card && receipt.runId === run && receipt.offCleanup === "returned_off") return true;
  }
  return false;
}

/** Production's moves since the approval, each one this chain's or Rowan's own. Throws for anything else. */
function checkProductionChain(evidence: DayEvidence, window: DayGrantWindow, library: string, pinnedRevision: number | null): number {
  const pressedCards = new Set(listDirectory(path.join(library, "runs", "operator")).filter((card) => listDirectory(path.join(library, "runs", "operator", card)).some((press) => !!readJson<{ startRun?: unknown }>(path.join(library, "runs", "operator", card, press, "descriptor.json"))?.startRun)));
  let revision = window.baselineRevision;
  for (const t of [...evidence.transitions].filter((x) => x.revisionBefore >= window.baselineRevision).sort((a, b) => a.revisionBefore - b.revisionBefore)) {
    if (t.revisionBefore !== revision) refuse("PRODUCTION_CHANGED", `production policy moved from ${revision} with no receipt (next receipt is at ${t.revisionBefore}); no card may follow an unexplained move`);
    if (t.transition === "activate") {
      if (!pressedCards.has(t.requestId)) refuse("PRODUCTION_CHANGED", `production was activated by ${t.requestId}, which is no pressed START card`);
    } else if (!ROWAN_OFF_REQUEST.test(t.requestId) && !isExecutorOff(t.requestId, pressedCards, library)) {
      refuse("DAY_ENDED_BY_OPERATOR", `production was turned Off by ${t.requestId}, not by this chain or Rowan: an operator STOP or operator-issued Off ends the day`);
    }
    revision = t.revisionAfter;
  }
  if (pinnedRevision !== null && pinnedRevision !== revision) refuse("PRODUCTION_CHANGED", `this card pins policy revision ${pinnedRevision}, but the chain since the approval reaches ${revision}`);
  return revision;
}

export interface DayGrantChain {
  window: DayGrantWindow;
  /** Attempts so far, numbered since Decision 0170: activations since it that admitted a Session. A number, not a cap. */
  attemptsSoFar: number;
  /** Decision 0181: failed batches that count against this day. Each one the chain returns past is in `clearedFailures`. */
  failedBatchesToday: number;
  /**
   * Decision 0185: the failed batches this chain continues past, each with the merged fix the card after its press named. The
   * executor checks every commit at the pin (an ancestor of the reviewed revision, dated after the batch ended) and that
   * Decision 0185 is answered with option A there; `start-run pins` checks the same at origin main.
   */
  clearedFailures: DayGrantClearedFailure[];
  /** Rowan's refused re-presses inside this window. */
  rePressesToday: number;
  /** The latest START press, which a card must name; null when none happened since Decision 0170. */
  latest: { press: string; kind: DayGrantPressKind } | null;
  revision: number;
}

/** One failed batch a merged fix cleared (Decision 0185): the batch's request id, its press, when it ended, the fix and its cause. */
export interface DayGrantClearedFailure { batch: string; press: string; endedAt: string; commit: string; cause: string }

/**
 * Decision 0185: the merged fix that clears one failed batch, or null. `owner` is the press whose activation failed and
 * `named` the cause the next card recorded for it: that card must call it a failed attempt and name a merged fix whose
 * `cause` is the cause it names. A batch still running has no end, so nothing can have merged after it.
 */
function mergedFixFor(batch: DayEvidenceActivation, owner: StartPress, named: unknown): DayGrantClearedFailure | null {
  if (!named || typeof named !== "object") return null;
  const previous = named as { press?: unknown; kind?: unknown; cause?: unknown; clearance?: unknown };
  const clearance = (previous.clearance ?? {}) as { kind?: unknown; commit?: unknown; cause?: unknown };
  if (previous.press !== owner.key || previous.kind !== "failed-attempt" || typeof previous.cause !== "string" || !slug.test(previous.cause)) return null;
  if (clearance.kind !== "merged-fix" || clearance.cause !== previous.cause || typeof clearance.commit !== "string" || !/^[0-9a-f]{40}$/.test(clearance.commit)) return null;
  if (typeof batch.endedAt !== "string" || !Number.isFinite(Date.parse(batch.endedAt))) return null;
  return { batch: batch.requestId, press: owner.key, endedAt: batch.endedAt, commit: clearance.commit, cause: previous.cause };
}

export interface InspectDayGrantInput {
  library: string;
  approvalCard: string;
  approvalRun: string;
  approvalReceiptSha256: string | null;
  approvalPressSha256: string | null;
  now: Date;
  evidence: DayEvidence;
  /** The card's pinned policy revision; null while computing a card's pins before the revision is chosen. */
  policyRevision: number | null;
  /** The press running right now, not an earlier one. */
  excludePress: string | null;
  scope: { project: string; plan: string; provider: string; concurrency: number; spendDecision: string; offId: string };
  /** The card's named cause; undefined computes the chain before Rowan has named one. */
  previous?: DayGrantPrevious | null;
  attempt?: number;
}

/**
 * The whole Decision 0173 check of one START press, read-only, in the same order as scripts/start-run.sh. Throws
 * StartRunDelegationError. Decision 0181 stops at one failed batch within this day's window; refused re-presses count within it too.
 */
export function inspectDayGrantChain(input: InspectDayGrantInput): DayGrantChain {
  const window = inspectDayApproval(input.library, input.approvalCard, input.approvalRun, input.approvalReceiptSha256, input.approvalPressSha256, input.now, input.scope.offId);
  const { scope } = input;
  if (scope.project !== window.pins.project || scope.plan !== window.pins.plan || scope.provider !== window.pins.provider || scope.concurrency !== window.pins.concurrency || scope.spendDecision !== window.pins.spendDecision) {
    refuse("SCOPE_NOT_APPROVED", `this card's scope (${scope.project}/${scope.plan}, ${scope.provider}, concurrency ${scope.concurrency}, spend Decision ${scope.spendDecision}) is not the Plan, provider and spend Decision the operator approved`);
  }
  const revision = checkProductionChain(input.evidence, window, input.library, input.policyRevision);
  // Attempts are still numbered as Decision 0170 counted them: every activation that admitted a Session, a dashboard
  // reactivation included. Decision 0181 lifted the cap; the number only pins the card to the record it was prepared on.
  const earliest = Date.parse(ATTEMPT_COUNT_EARLIEST);
  const attemptsSoFar = input.evidence.activations.filter((a) => Date.parse(a.at) >= earliest && a.admitted >= 1).length;
  // Decision 0181: a batch that fails stops for the operator. Any failed batch not over before the day's press counts, whoever
  // started or stopped it.
  const failed = failedBatchesInWindow(input.evidence, window.opensAtMs);
  const presses = startPresses(input.library, input.evidence, input.excludePress);
  const latest = presses.at(-1) ?? null;
  // Decision 0185: the card after a failed press may go on when it names a fix merged for that batch's cause. For the latest
  // press that card is this one; for an earlier failure it is the press that followed it, whose card this chain re-reads, and
  // whose fix the executor checks again at this card's pin. Anything else (no owning press, a press by the operator, a
  // clearance by observation, another cause) stops for the operator, as Decision 0181 had it.
  const clearedFailures: DayGrantClearedFailure[] = [];
  for (const batch of failed) {
    const owner = presses.find((press) => press.card === batch.requestId && press.admitted);
    // Before Rowan has named a cause the latest press's failure cannot be judged yet; the named call checks it.
    if (owner && owner === latest && input.previous === undefined) continue;
    const next = owner ? presses[presses.indexOf(owner) + 1] : undefined;
    const named = !owner ? null : owner === latest ? input.previous : next?.delegation?.decision === DAY_GRANT_DECISION ? next.delegation.previous : null;
    const fix = owner ? mergedFixFor(batch, owner, named) : null;
    if (!fix) refuse("FAILED_BATCH", `the batch ${batch.requestId} (activated ${batch.at}) failed under the day approved at ${window.opensAt}: it admitted a Session and did not reach scope complete without an escalation; Decision 0181 stops for the operator unless the card after it names a merged fix for that cause (Decision 0185: previous.kind failed-attempt, a merged-fix clearance whose cause is the named cause, merged after the batch ended)`);
    clearedFailures.push(fix!);
  }
  if (latest && (latest.status === "running" || latest.receipt?.outcome === "in_progress")) refuse("PREVIOUS_UNSETTLED", `the latest START press ${latest.key} has not finished; read its receipt before any other press`);
  const noSession = (press: StartPress) => !press.admitted;
  let rePressesToday = 0;
  presses.forEach((press, index) => {
    if (press.startedAt >= window.opensAtMs && press.marker?.decision === DAY_GRANT_DECISION && index > 0 && noSession(presses[index - 1])) rePressesToday += 1;
  });
  const kindOf = (press: StartPress): DayGrantPressKind => !press.admitted ? "no-session" : press.failed ? "failed-attempt" : "clean-batch";
  const latestSummary = latest ? { press: latest.key, kind: kindOf(latest) } : null;
  if (latest && noSession(latest) && rePressesToday >= DAY_GRANT_MAX_REPRESSES) refuse("REPRESSES_EXHAUSTED", `${rePressesToday} re-presses after a refusal already ran in this day; Decision 0173 allows at most ${DAY_GRANT_MAX_REPRESSES}, however the card is re-prepared`);
  if (latest && noSession(latest) && latest.startedAt >= window.opensAtMs) {
    const key = refusalKey(latest.receipt);
    const repeat = key && presses.find((press) => press !== latest && noSession(press) && press.startedAt >= window.opensAtMs && refusalKey(press.receipt) === key);
    if (repeat) refuse("SAME_REFUSAL", `the latest press refused for the same recorded reason as ${repeat.key} in this day: ${String(latest.receipt?.reason).slice(0, 200)}; stop for the operator`);
  }

  if (input.previous !== undefined) {
    const previous = input.previous;
    if (!latest) { if (previous !== null) refuse("PREVIOUS_MISMATCH", `this card names ${previous.press}, but no START press has happened since Decision 0170`); }
    else {
      if (previous === null) refuse("PREVIOUS_CAUSE_REQUIRED", `the latest START press ${latest.key} needs its cause named on this card, with an evidence pointer and how it was cleared`);
      validateDayGrantPrevious(previous);
      if (previous!.press !== latest.key) refuse("PREVIOUS_MISMATCH", `this card names ${previous!.press}, but the latest START press is ${latest.key}`);
      if (previous!.kind !== latestSummary!.kind) refuse("PREVIOUS_MISMATCH", `this card calls ${latest.key} a ${previous!.kind}, but production's record makes it a ${latestSummary!.kind}`);
      // Each earlier card named the cause of the press before it: the record is on the cards, across days.
      const named = presses.filter((press) => press.delegation?.decision === DAY_GRANT_DECISION && press.delegation.previous?.press && press.delegation.previous.cause);
      const namedFor = (press: StartPress) => named.filter((card) => card.delegation!.previous!.press === press.key).map((card) => card.delegation!.previous!.cause!);
      // Decision 0173 stops "if two attempts fail on the same cause". A clean batch failed on nothing, so it never trips this.
      if (latest.failed && presses.some((press) => press !== latest && press.admitted && namedFor(press).includes(previous!.cause))) {
        refuse("SAME_CAUSE", `two attempts failed on the cause ${previous!.cause}; Decision 0173 stops here for the operator`);
      }
      if (!latest.admitted && presses.some((press) => press !== latest && !press.admitted && press.startedAt >= window.opensAtMs && namedFor(press).includes(previous!.cause))) {
        refuse("SAME_REFUSAL", `the refusal named ${previous!.cause} recurred in this day; Decision 0173 stops here for the operator`);
      }
    }
  }
  if (input.attempt !== undefined && input.attempt !== attemptsSoFar + 1) refuse("ATTEMPT_MISMATCH", `this card is pinned as attempt ${input.attempt}, but ${attemptsSoFar} attempts already admitted a Session`);
  return { window, attemptsSoFar, failedBatchesToday: failed.length, clearedFailures, rePressesToday, latest: latestSummary, revision };
}
