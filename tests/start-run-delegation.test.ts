import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  delegatedPressMarker, delegationTrigger, DELEGATION_SCOPE, inspectDelegationChain, StartRunDelegationError, validateDelegationBlock
} from "../src/operatorActions/startRunDelegation.js";
import { validateStartRunPins, type StartRunPins } from "../src/operatorActions/startRunPins.js";

/**
 * Decision 0163: the read-only chain computation `start-run pins --delegated-from` uses, the /actions runner's delegated
 * press marker, and the explicit trigger. The executor's own P0 checks are covered in tests/start-run-executor.test.ts.
 */
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ORIGIN = "start-run-origin-20261101";
const RUN = "20261101T010000Z-111";
const NOW = new Date("2026-11-01T12:00:00Z");
const block = (overrides: Record<string, unknown> = {}) => ({ decision: "0163", originatingCard: ORIGIN, originatingRun: RUN, originatingReceiptSha256: "a".repeat(64), attempt: 2, ...overrides });

interface PressSpec { card: string; at: string; delegated?: boolean; claimed?: boolean; receipt?: Record<string, unknown> | null; scope?: Record<string, unknown> }
/** One /actions press as the runner and the executor leave it: runs/operator/<card>/<press>/ plus runs/<card>/<run>/receipt.json. */
function writePress(root: string, spec: PressSpec, n: number) {
  const pressId = `press-${n}`;
  const dir = path.join(root, "runs", "operator", spec.card, pressId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "run.json"), JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: pressId, scriptId: spec.card, startedAt: spec.at, ...(spec.delegated ? { press: { kind: "delegated" } } : {}) }));
  writeFileSync(path.join(dir, "descriptor.json"), JSON.stringify({ startRun: { ...DELEGATION_SCOPE, actions: [...DELEGATION_SCOPE.actions], production: { revision: 83, epoch: 46 }, ...(spec.delegated ? { delegation: block({ attempt: n }) } : {}), ...spec.scope } }));
  if (spec.claimed !== false) writeFileSync(path.join(dir, "start-run.claimed"), "x\n");
  if (spec.receipt?.allowanceConsumed !== false) writeFileSync(path.join(root, `${spec.card}.consumed.json`), "{}");
  if (spec.receipt === null) return;
  const run = `20261101T1${n}0000Z-${n}`;
  mkdirSync(path.join(root, "runs", spec.card, run), { recursive: true });
  writeFileSync(path.join(root, "runs", spec.card, run, "receipt.json"), JSON.stringify({ id: spec.card, runId: run, mode: "run", startedAt: spec.at, outcome: "refused", allowanceConsumed: true, productionActivated: false, offCleanup: "not_attempted", record: { operatorRunId: pressId }, ...spec.receipt }));
}

function library(options: { press?: Record<string, unknown>; receipt?: Record<string, unknown>; scope?: Record<string, unknown>; successors?: number; pressedAt?: string; others?: PressSpec[] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-delegation-"));
  directories.push(root);
  const receipt = JSON.stringify({ id: ORIGIN, runId: RUN, mode: "run", startedAt: "2026-11-01T10:00:00Z", outcome: "refused", allowanceConsumed: true, productionActivated: false, offCleanup: "not_attempted", record: { operatorRunId: "press-1" }, ...options.receipt });
  mkdirSync(path.join(root, "runs", ORIGIN, RUN), { recursive: true });
  writeFileSync(path.join(root, "runs", ORIGIN, RUN, "receipt.json"), receipt);
  const pressDir = path.join(root, "runs", "operator", ORIGIN, "press-1");
  mkdirSync(pressDir, { recursive: true });
  writeFileSync(path.join(pressDir, "run.json"), JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: "press-1", scriptId: ORIGIN, startedAt: options.pressedAt ?? "2026-11-01T10:00:00Z", ...options.press }));
  writeFileSync(path.join(pressDir, "descriptor.json"), JSON.stringify({ startRun: { ...DELEGATION_SCOPE, actions: [...DELEGATION_SCOPE.actions], production: { revision: 83, epoch: 46 }, ...options.scope } }));
  writeFileSync(path.join(pressDir, "start-run.claimed"), "x\n");
  for (let n = 1; n <= (options.successors ?? 0); n += 1) writePress(root, { card: `successor-${n}`, at: `2026-11-01T10:${10 + n}:00Z`, delegated: true }, n + 1);
  (options.others ?? []).forEach((spec, index) => writePress(root, spec, 10 + index));
  return { root, receiptSha: sha(receipt) };
}
const code = (run: () => unknown) => { try { run(); } catch (error) { return error instanceof StartRunDelegationError ? error.code : String(error); } return "none"; };

describe("Decision 0163 delegation chain", () => {
  it("computes the next attempt, the trigger and the originating receipt hash from an operator press", () => {
    const l = library({ successors: 1 });
    const chain = inspectDelegationChain(l.root, ORIGIN, RUN, l.receiptSha, NOW);
    expect(chain).toMatchObject({ receiptSha256: l.receiptSha, attemptsSoFar: 2, trigger: "refused-before-start", latest: { card: "successor-1" } });
  });
  it.each<[string, Parameters<typeof library>[0], string | null, string]>([
    ["a changed receipt", {}, "b".repeat(64), "ORIGIN_CHANGED"],
    ["an origin pressed as delegated", { press: { press: { kind: "delegated" } } }, null, "ORIGIN_NOT_OPERATOR"],
    ["an origin never consumed", { receipt: { allowanceConsumed: false } }, null, "ORIGIN_NOT_PRESSED"],
    ["another scope", { scope: { provider: "codex-cli" } }, null, "SCOPE_NOT_DELEGATED"],
    ["an expired window", { pressedAt: "2026-10-29T11:00:00Z" }, null, "WINDOW_EXPIRED"],
    ["exhausted attempts", { successors: 4 }, null, "ATTEMPTS_EXHAUSTED"],
    ["a successful START as the latest attempt", { receipt: { outcome: "succeeded", productionActivated: true } }, null, "NOT_A_TRIGGER"],
    ["an activation found Off by another cause (STOP, Decision, stop-the-line)", { receipt: { productionActivated: false, offCleanup: "not_active" } }, null, "NOT_A_TRIGGER"],
    ["an origin pressed before Decision 0163 reached main", { pressedAt: "2026-11-01T04:00:00Z" }, null, "ORIGIN_BEFORE_DECISION"],
    ["an origin that is not the operator's first press after Decision 0163", { others: [{ card: "earlier-operator-card", at: "2026-11-01T05:00:00Z" }] }, null, "ORIGIN_NOT_FIRST"],
    ["a newer operator press that STARTed, outside the chain", { others: [{ card: "later-operator-card", at: "2026-11-01T11:00:00Z", receipt: { outcome: "succeeded", productionActivated: true, offCleanup: "not_attempted" } }] }, null, "NOT_A_TRIGGER"],
    ["five attempts counted across cards, one with no receipt", { successors: 2, others: [{ card: "later-operator-card", at: "2026-11-01T11:00:00Z" }, { card: "lost-receipt-card", at: "2026-11-01T11:30:00Z", receipt: null }] }, null, "ATTEMPTS_EXHAUSTED"],
    ["a press refused before P3 (consumed nothing) is no attempt and never the first press", { successors: 3, others: [{ card: "unconsumed-card", at: "2026-11-01T05:00:00Z", receipt: { allowanceConsumed: false } }] }, null, "none"],
    ["a claimed latest press whose receipt is missing", { others: [{ card: "lost-receipt-card", at: "2026-11-01T11:30:00Z", receipt: null }] }, null, "NOT_A_TRIGGER"]
  ])("refuses %s", (_label, options, receiptSha, expected) => {
    const l = library(options);
    expect(code(() => inspectDelegationChain(l.root, ORIGIN, RUN, receiptSha, NOW))).toBe(expected);
  });
});

describe("Decision 0163 production policy revision", () => {
  it("requires the successor's live revision to follow the latest attempt with nothing in between", () => {
    const refused = library();
    expect(inspectDelegationChain(refused.root, ORIGIN, RUN, null, NOW, null, 83).trigger).toBe("refused-before-start");
    expect(code(() => inspectDelegationChain(refused.root, ORIGIN, RUN, null, NOW, null, 84))).toBe("PRODUCTION_CHANGED");
    const returned = library({ receipt: { productionActivated: true, offCleanup: "returned_off" } });
    expect(inspectDelegationChain(returned.root, ORIGIN, RUN, null, NOW, null, 85).trigger).toBe("returned-off-after-failed-activation");
    expect(code(() => inspectDelegationChain(returned.root, ORIGIN, RUN, null, NOW, null, 86))).toBe("PRODUCTION_CHANGED");
  });
});

describe("Decision 0163 trigger", () => {
  it("allows only a refusal before START or the executor's own return to Off", () => {
    expect(delegationTrigger({ outcome: "refused", productionActivated: false, offCleanup: "not_attempted" })).toBe("refused-before-start");
    expect(delegationTrigger({ outcome: "refused", productionActivated: true, offCleanup: "returned_off" })).toBe("returned-off-after-failed-activation");
    for (const latest of [
      { outcome: "succeeded", productionActivated: true }, { outcome: "in_progress", productionActivated: false },
      { outcome: "refused", productionActivated: true, offCleanup: "other_grant_active" }, { outcome: "refused", productionActivated: "unknown", offCleanup: "UNKNOWN" },
      { outcome: "refused", productionActivated: false, offCleanup: "not_active" }, { outcome: "refused", productionActivated: false, offCleanup: "other_grant_active" },
      { outcome: "refused", productionActivated: false }, { outcome: "refused", productionActivated: true, offCleanup: "OFF_FAILED" }
    ]) expect(code(() => delegationTrigger(latest))).toBe("NOT_A_TRIGGER");
  });
});

describe("Decision 0163 press marker (/actions runner)", () => {
  const delegated = { startRun: { delegation: block() as never } };
  it("records Rowan's delegated press only for a delegated card, and never lets either kind pass as the other", () => {
    expect(delegatedPressMarker(delegated, { decision: "0163", agent: "rowan" })).toEqual({ kind: "delegated", agent: "rowan", decision: "0163", originatingRun: `${ORIGIN}/${RUN}` });
    expect(delegatedPressMarker({ startRun: {} }, undefined)).toBeNull();
    expect(code(() => delegatedPressMarker(delegated, undefined))).toBe("DELEGATED_CARD");
    expect(code(() => delegatedPressMarker({ startRun: {} }, { decision: "0163", agent: "rowan" }))).toBe("NOT_DELEGATED_CARD");
    expect(code(() => delegatedPressMarker(delegated, { decision: "0163", agent: "operator" }))).toBe("INVALID_DELEGATED_PRESS");
  });
});

describe("Decision 0163 descriptor block", () => {
  const pins = (delegation: unknown, overrides: Partial<StartRunPins> = {}) => ({
    schema: "arcadia-start-run-v1", reviewedRevision: "a".repeat(40), executorSha256: "b".repeat(64), workspace: "martianrover", project: "arcadia",
    plan: DELEGATION_SCOPE.plan, actions: [...DELEGATION_SCOPE.actions], provider: "claude-code-cli", transitions: ["validation", "acceptance", "pointer", "packet_approval"],
    concurrency: 1, packetApprovalHours: 24, intent: "i", spendDecision: "0130", integrationDecision: "0058",
    requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162", "0163"], requiredFiles: ["scripts/start-run.sh"],
    production: { revision: 1, epoch: 1 }, queueRevision: 1, workerLabel: "com.arcadia.local.1.worker", gateCardId: "gate", offId: "off", grantedBy: "Rowan",
    consumedHistory: [{ path: "/abs/x.consumed.json", sha256: "c".repeat(64) }], delegation, ...overrides
  });
  it("validates the block, requires Decision 0163 and keeps the delegated scope", () => {
    expect(() => validateStartRunPins(pins(block()))).not.toThrow();
    expect(() => validateDelegationBlock(block({ attempt: 6 }))).toThrow(/2 to 5/);
    expect(() => validateStartRunPins(pins(block(), { requiredDecisions: ["0130", "0058", "0156", "0157", "0161"] }))).toThrow(/Decision 0163/);
    expect(() => validateStartRunPins(pins(block(), { actions: ["other-action"] }))).toThrow(/scope Decision 0163 delegates/);
    expect(() => validateStartRunPins(pins(block({ extra: 1 })))).toThrow(/exactly/);
  });
});
