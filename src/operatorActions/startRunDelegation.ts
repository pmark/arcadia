import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Decision 0163 (option A): the operator's press of a per-run START card for the scope below delegates to Rowan, the
 * sole coordinator, the pressing of successor cards for the same scope, through the existing /actions runner, until the
 * goal, within these bounds:
 *
 *  - at most 5 START attempts in total, including the operator's own press, within 72 hours of that press;
 *  - a successor only when the latest attempt refused before START, or when production returned to Off before the goal
 *    by a cause other than an operator STOP card, a Decision or a stop-the-line. The only Off this system issues that is
 *    none of those is the executor's own return of its Grant to Off after a failed activation (`offCleanup:
 *    returned_off`); every other Off is a deliberate `production deactivate` and never triggers a successor;
 *  - the same Plan, Actions in order, provider, concurrency, spend Decision 0130 and transitions; only the reviewed
 *    revision, executor hash and live pins may change.
 *
 * The executor (scripts/start-run.sh, P0) verifies all of this again from the files on disk; this module is the
 * read-only computation `arcadia start-run pins --delegated-from` uses to emit the block.
 */
export const DELEGATION_DECISION = "0163";
export const DELEGATION_MAX_ATTEMPTS = 5;
export const DELEGATION_WINDOW_MS = 72 * 3_600_000;
export const DELEGATION_AGENT = "rowan";
/** Decision 0163 reached main at 29c8e37 (2026-11-01T04:35:38Z); only the operator's first in-scope press after it delegates. */
export const DELEGATION_EARLIEST_ORIGIN = "2026-11-01T04:35:38Z";
/** The exact scope Decision 0163 names. */
export const DELEGATION_SCOPE = {
  plan: "arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider",
  actions: ["bound-guidance-test-teardown-retries", "assert-tmux-temp-launcher-removed", "cover-retired-descriptor-byte-change"],
  provider: "claude-code-cli",
  concurrency: 1,
  spendDecision: "0130"
} as const;

export interface StartRunDelegation {
  decision: typeof DELEGATION_DECISION;
  /** The operator-pressed card and its executor run id. */
  originatingCard: string;
  originatingRun: string;
  /** sha256 of that run's final receipt.json. */
  originatingReceiptSha256: string;
  /** This card's attempt number: 2 to 5 (the operator's press is attempt 1). */
  attempt: number;
}
export const DELEGATION_KEYS = ["attempt", "decision", "originatingCard", "originatingReceiptSha256", "originatingRun"];

/** The press marker the /actions runner records for Rowan's delegated press (never an operator press). */
export interface DelegatedPress { kind: "delegated"; agent: typeof DELEGATION_AGENT; decision: typeof DELEGATION_DECISION; originatingRun: string }

export class StartRunDelegationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const refuse = (code: string, message: string): never => { throw new StartRunDelegationError(code, message); };
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const runIdPattern = /^[0-9]{8}T[0-9]{6}Z-[0-9]+$/;
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export function validateDelegationBlock(value: unknown): StartRunDelegation {
  const d = value as StartRunDelegation;
  if (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).sort().join() !== DELEGATION_KEYS.join()) refuse("INVALID_DELEGATION", `startRun.delegation needs exactly ${DELEGATION_KEYS.join(", ")}.`);
  if (d.decision !== DELEGATION_DECISION) refuse("INVALID_DELEGATION", "startRun.delegation.decision must be 0163.");
  if (typeof d.originatingCard !== "string" || !slug.test(d.originatingCard)) refuse("INVALID_DELEGATION", "startRun.delegation.originatingCard must be a card id.");
  if (typeof d.originatingRun !== "string" || !runIdPattern.test(d.originatingRun)) refuse("INVALID_DELEGATION", "startRun.delegation.originatingRun must be an executor run id.");
  if (typeof d.originatingReceiptSha256 !== "string" || !/^[0-9a-f]{64}$/.test(d.originatingReceiptSha256)) refuse("INVALID_DELEGATION", "startRun.delegation.originatingReceiptSha256 must be 64 lowercase hex.");
  if (!Number.isInteger(d.attempt) || d.attempt < 2 || d.attempt > DELEGATION_MAX_ATTEMPTS) refuse("INVALID_DELEGATION", `startRun.delegation.attempt must be 2 to ${DELEGATION_MAX_ATTEMPTS}.`);
  return d;
}

/**
 * The /actions runner's record of who pressed. An ordinary (operator) press of an ordinary card records nothing extra.
 * Rowan's press must ask for the delegated marker, and only a card carrying a delegation block accepts it; a delegated
 * card is never pressed as if by the operator.
 */
export function delegatedPressMarker(descriptor: { startRun?: { delegation?: StartRunDelegation } }, requested: unknown): DelegatedPress | null {
  const delegation = descriptor.startRun?.delegation;
  if (requested === undefined || requested === null) {
    if (delegation) refuse("DELEGATED_CARD", "This START card was minted for Rowan's delegated press under Decision 0163; it is pressed with the delegated marker, never as an operator press.");
    return null;
  }
  const r = requested as { decision?: unknown; agent?: unknown };
  if (typeof r !== "object" || Object.keys(r).sort().join() !== "agent,decision" || r.decision !== DELEGATION_DECISION || r.agent !== DELEGATION_AGENT) {
    refuse("INVALID_DELEGATED_PRESS", "A delegated press names exactly { decision: \"0163\", agent: \"rowan\" }.");
  }
  if (!delegation) refuse("NOT_DELEGATED_CARD", "Only a START card carrying a Decision 0163 delegation block can be pressed as delegated.");
  return { kind: "delegated", agent: DELEGATION_AGENT, decision: DELEGATION_DECISION, originatingRun: `${delegation!.originatingCard}/${delegation!.originatingRun}` };
}

interface Receipt { id?: string; runId?: string; mode?: string; startedAt?: string; outcome?: string; allowanceConsumed?: boolean; productionActivated?: unknown; offCleanup?: string; record?: { operatorRunId?: string } }
const readJson = <T>(file: string): T | null => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return null; } };
const listDirectory = (directory: string): string[] => { try { return readdirSync(directory); } catch { return []; } };

export interface DelegationChain {
  originatingStartedAt: string;
  attemptsSoFar: number;
  latest: { card: string; run: string; outcome: string; productionActivated: unknown; offCleanup: string };
  trigger: "refused-before-start" | "returned-off-after-failed-activation";
}

/** One /actions press of an in-scope START card, read from the runner's own press directory. */
interface Press { card: string; pressRunId: string; startedAt: number; startedAtText: string; delegated: boolean; attempt: boolean; receipt: Receipt | null; receiptRun: string | null }

const inDelegatedScope = (s: Record<string, unknown> | undefined): boolean => !!s && s.plan === DELEGATION_SCOPE.plan
  && JSON.stringify(s.actions) === JSON.stringify(DELEGATION_SCOPE.actions) && s.provider === DELEGATION_SCOPE.provider
  && s.concurrency === DELEGATION_SCOPE.concurrency && s.spendDecision === DELEGATION_SCOPE.spendDecision;

/**
 * Every /actions press of an in-scope START card, from `runs/operator/<card>/<press>/` (run.json and the descriptor the
 * runner snapshotted), with the executor receipt that names it. A press is an attempt once its press record was claimed
 * (P0 passed) or its receipt consumed the allowance; a missing or unreadable receipt never hides a claimed press.
 */
function inScopePresses(library: string, excludeCard: string | null): Press[] {
  const presses: Press[] = [];
  const operatorRuns = path.join(library, "runs", "operator");
  for (const card of listDirectory(operatorRuns)) {
    if (card === excludeCard || !slug.test(card)) continue;
    const receipts = listDirectory(path.join(library, "runs", card)).map((run) => ({ run, r: readJson<Receipt>(path.join(library, "runs", card, run, "receipt.json")) }));
    for (const pressRunId of listDirectory(path.join(operatorRuns, card))) {
      const dir = path.join(operatorRuns, card, pressRunId);
      const run = readJson<{ schema?: string; scriptId?: string; runId?: string; startedAt?: string; press?: unknown }>(path.join(dir, "run.json"));
      const startRun = readJson<{ startRun?: Record<string, unknown> }>(path.join(dir, "descriptor.json"))?.startRun;
      if (!run || run.schema !== "arcadia-operator-script-run-v1" || run.scriptId !== card || run.runId !== pressRunId || !inDelegatedScope(startRun)) continue;
      const startedAt = Date.parse(String(run.startedAt));
      if (!Number.isFinite(startedAt)) continue;
      const match = receipts.find(({ r }) => r?.mode === "run" && r.record?.operatorRunId === pressRunId) ?? null;
      const attempt = existsSync(path.join(dir, "start-run.claimed")) || match?.r?.allowanceConsumed === true;
      presses.push({ card, pressRunId, startedAt, startedAtText: String(run.startedAt), delegated: run.press !== undefined || startRun!.delegation !== undefined, attempt, receipt: match?.r ?? null, receiptRun: match?.run ?? null });
    }
  }
  return presses.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Read-only verification of the chain behind a delegation, from the library on disk. The originating press must be the
 * operator's own consumed /actions press of the delegated scope and the first such press after Decision 0163 reached
 * main; every in-scope press since it (any card, delegated or not) counts toward the 5-attempt bound, and the trigger is
 * judged on the latest of them. `excludeCard` is the card being checked (its own press is not an earlier attempt).
 * Throws StartRunDelegationError.
 */
export function inspectDelegationChain(library: string, originatingCard: string, originatingRun: string, receiptSha256: string | null, now: Date, excludeCard: string | null = null): DelegationChain & { receiptSha256: string } {
  if (!slug.test(originatingCard) || !runIdPattern.test(originatingRun)) refuse("INVALID_DELEGATION", "the originating card or run id is malformed");
  const receiptPath = path.join(library, "runs", originatingCard, originatingRun, "receipt.json");
  if (!existsSync(receiptPath)) refuse("ORIGIN_MISSING", `the originating run's receipt ${receiptPath} does not exist`);
  const bytes = readFileSync(receiptPath);
  const actualSha = sha256(bytes);
  if (receiptSha256 !== null && actualSha !== receiptSha256) refuse("ORIGIN_CHANGED", "the originating run's receipt changed since the delegation was pinned");
  const receipt = JSON.parse(bytes.toString("utf8")) as Receipt;
  if (receipt.id !== originatingCard || receipt.runId !== originatingRun || receipt.mode !== "run" || receipt.allowanceConsumed !== true || typeof receipt.record?.operatorRunId !== "string") {
    refuse("ORIGIN_NOT_PRESSED", "the originating run is not a consumed /actions press of that card");
  }
  const presses = inScopePresses(library, excludeCard);
  const origin = presses.find((p) => p.card === originatingCard && p.pressRunId === receipt.record!.operatorRunId);
  if (!origin) {
    const raw = readJson<{ startRun?: Record<string, unknown> }>(path.join(library, "runs", "operator", originatingCard, receipt.record!.operatorRunId!, "descriptor.json"));
    if (raw?.startRun && !inDelegatedScope(raw.startRun)) refuse("SCOPE_NOT_DELEGATED", "the originating card's scope is not the one Decision 0163 delegates");
    refuse("ORIGIN_NOT_OPERATOR", "the originating run has no /actions press record of the delegated scope");
  }
  if (origin!.delegated) refuse("ORIGIN_NOT_OPERATOR", "the originating run was not pressed by the operator through /actions (it is a delegated press or card)");
  if (now.getTime() - origin!.startedAt > DELEGATION_WINDOW_MS || now.getTime() < origin!.startedAt) refuse("WINDOW_EXPIRED", "more than 72 hours have passed since the operator's originating press");
  if (origin!.startedAt < Date.parse(DELEGATION_EARLIEST_ORIGIN)) refuse("ORIGIN_BEFORE_DECISION", `the originating press predates Decision 0163 on main (${DELEGATION_EARLIEST_ORIGIN}); only the operator's next press delegates`);
  const first = presses.find((p) => !p.delegated && p.attempt && p.startedAt >= Date.parse(DELEGATION_EARLIEST_ORIGIN));
  if (first !== origin) refuse("ORIGIN_NOT_FIRST", `the operator's first press after Decision 0163 is ${first!.card}/${first!.pressRunId}; only that press delegates`);

  const attempts = presses.filter((p) => p.attempt && p.startedAt >= origin!.startedAt);
  const attemptsSoFar = attempts.length;
  if (attemptsSoFar >= DELEGATION_MAX_ATTEMPTS) refuse("ATTEMPTS_EXHAUSTED", `${attemptsSoFar} START attempts already ran since the operator's originating press; Decision 0163 allows at most ${DELEGATION_MAX_ATTEMPTS}`);
  const latest = attempts.at(-1)!;
  if (!latest.receipt) refuse("NOT_A_TRIGGER", `the latest attempt ${latest.card}/${latest.pressRunId} has no readable executor receipt`);
  const trigger = delegationTrigger(latest.receipt!);
  return {
    receiptSha256: actualSha, originatingStartedAt: origin!.startedAtText, attemptsSoFar, trigger,
    latest: { card: latest.card, run: latest.receiptRun!, outcome: String(latest.receipt!.outcome), productionActivated: latest.receipt!.productionActivated ?? null, offCleanup: String(latest.receipt!.offCleanup) }
  };
}

/**
 * Decision 0163's trigger, explicit: a successor only after the latest attempt refused with no activation attempted
 * (`offCleanup: not_attempted`), or after it was activated and its own executor returned only its Grant to Off. A run
 * still in progress, a successful START, an activation found inactive or under another Grant (an operator STOP card, a
 * Decision or a stop-the-line may have turned it Off), or an unconfirmed Off is never a trigger.
 */
export function delegationTrigger(latest: Pick<Receipt, "outcome" | "productionActivated" | "offCleanup">): DelegationChain["trigger"] {
  if (latest.outcome !== "refused") refuse("NOT_A_TRIGGER", `the latest attempt's outcome is ${String(latest.outcome)}; only a refused attempt can be followed by a successor`);
  if (latest.productionActivated === false && latest.offCleanup === "not_attempted") return "refused-before-start";
  if (latest.productionActivated === true && latest.offCleanup === "returned_off") return "returned-off-after-failed-activation";
  return refuse("NOT_A_TRIGGER", `the latest attempt left production ${JSON.stringify(latest.productionActivated)} with Off cleanup ${String(latest.offCleanup)}; an Off this chain did not issue never triggers a successor`);
}
