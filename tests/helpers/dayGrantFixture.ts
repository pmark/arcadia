import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DayEvidence, DayGrantPrevious } from "../../src/operatorActions/startRunDayGrant.js";

/**
 * Decision 0173 fixtures: the files the /actions runner and the executors leave on disk, and one table of scenarios that
 * tests/start-run-day-grant.test.ts runs against the TypeScript computation and tests/start-run-executor.test.ts runs
 * against scripts/start-run.sh, so the two implementations are held to the same refusal codes.
 */
export const DAY_PLAN = "arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider";
export const DAY_CARD = "approve-critical-path-day-fixture";
export const DAY_RUN = "20261104T090000Z-777";
export const DAY_PRESS = "20261104090000000-day-press";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

export const dayGrantPins = (overrides: Record<string, unknown> = {}) => ({
  schema: "arcadia-day-grant-v1", decision: "0173", executorSha256: "e".repeat(64), project: "arcadia", plan: DAY_PLAN, provider: "claude-code-cli", concurrency: 1, spendDecision: "0130", ...overrides
});

export interface ApprovalSpec {
  card?: string;
  run?: string;
  press?: string;
  pressedAt: number;
  baseline?: number;
  pins?: Record<string, unknown>;
  /** A delegated press marker on the press record: never an approval. */
  delegated?: boolean;
  browser?: boolean;
  /** No press record at all: a receipt someone wrote by hand. */
  noPressRecord?: boolean;
  noConsumedMarker?: boolean;
  /** A press record its executor run never claimed. */
  noClaim?: boolean;
  receipt?: Record<string, unknown>;
  record?: Record<string, unknown>;
}
export interface ApprovalFiles { card: string; run: string; receiptPath: string; pressPath: string; receiptSha256: string; pressSha256: string }

export function writeDayApproval(library: string, spec: ApprovalSpec): ApprovalFiles {
  const card = spec.card ?? DAY_CARD, run = spec.run ?? DAY_RUN, press = spec.press ?? DAY_PRESS;
  const pressedAt = iso(spec.pressedAt);
  const pressDir = path.join(library, "runs", "operator", card, press);
  const receiptPath = path.join(library, "runs", card, run, "receipt.json");
  const pressPath = path.join(pressDir, "run.json");
  const pins = dayGrantPins(spec.pins);
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  const receipt = JSON.stringify({
    schema: "arcadia-day-grant-receipt-v1", id: card, runId: run, mode: "run", startedAt: pressedAt, outcome: "approved", allowanceConsumed: true, reason: "",
    record: {
      operatorRunId: press, pressStartedAt: pressedAt, windowClosesAt: iso(spec.pressedAt + 24 * 60 * MINUTE), policyRevisionAtApproval: spec.baseline ?? 83,
      project: pins.project, plan: pins.plan, provider: pins.provider, spendDecision: pins.spendDecision, ...spec.record
    }, ...spec.receipt
  });
  writeFileSync(receiptPath, receipt);
  if (!spec.noConsumedMarker) writeFileSync(path.join(library, `${card}.consumed.json`), JSON.stringify({ state: "CONSUMED", requestId: card, runId: run }));
  let pressBytes = "";
  if (!spec.noPressRecord) {
    mkdirSync(pressDir, { recursive: true });
    pressBytes = JSON.stringify({
      schema: "arcadia-operator-script-run-v1", runId: press, scriptId: card, status: "succeeded", startedAt: pressedAt,
      ...(spec.browser === false ? {} : { browserPress: true }),
      ...(spec.delegated ? { press: { kind: "delegated", agent: "rowan", decision: "0173", originatingRun: "x/y" } } : {})
    });
    writeFileSync(pressPath, pressBytes);
    writeFileSync(path.join(pressDir, "descriptor.json"), JSON.stringify({ dayGrant: dayGrantPins(spec.pins) }));
    if (!spec.noClaim) writeFileSync(path.join(pressDir, "day-grant.claimed"), `${run}\n`);
  }
  return { card, run, receiptPath, pressPath, receiptSha256: sha(receipt), pressSha256: sha(pressBytes) };
}

export interface PressSpec {
  card: string;
  /** A second press of one card needs its own id. */
  id?: string;
  at: number;
  /** Rowan's delegated press under Decision 0173, naming the press before it. */
  previous?: { press: string; cause: string; kind?: DayGrantPrevious["kind"] };
  status?: string;
  /** Executor receipt; null leaves none. */
  receipt?: Record<string, unknown> | null;
}
export const pressId = (card: string) => `20261104000000000-${card}`;
export const pressKey = (card: string) => `${card}/${pressId(card)}`;
const RUN_PREFIX = "20261104T1";

export function writeStartPress(library: string, spec: PressSpec, index: number): void {
  const id = spec.id ?? pressId(spec.card);
  const dir = path.join(library, "runs", "operator", spec.card, id);
  mkdirSync(dir, { recursive: true });
  const delegated = spec.previous !== undefined;
  writeFileSync(path.join(dir, "run.json"), JSON.stringify({
    schema: "arcadia-operator-script-run-v1", runId: id, scriptId: spec.card, status: spec.status ?? "failed", startedAt: iso(spec.at),
    ...(delegated ? { press: { kind: "delegated", agent: "rowan", decision: "0173", originatingRun: `${DAY_CARD}/${DAY_RUN}` } } : {})
  }));
  const delegation = delegated
    ? { delegation: { decision: "0173", approvalCard: DAY_CARD, approvalRun: DAY_RUN, attempt: 1, previous: { press: spec.previous!.press, kind: spec.previous!.kind ?? "no-session", cause: spec.previous!.cause, evidence: "docs/x.md", clearance: { kind: "observed-cleared", observation: "docs/y.md" } } } }
    : {};
  writeFileSync(path.join(dir, "descriptor.json"), JSON.stringify({ startRun: { plan: DAY_PLAN, ...delegation } }));
  if (spec.receipt === null) return;
  const run = `${RUN_PREFIX}${String(index).padStart(5, "0")}Z-${index + 1}`;
  mkdirSync(path.join(library, "runs", spec.card, run), { recursive: true });
  writeFileSync(path.join(library, "runs", spec.card, run, "receipt.json"), JSON.stringify({ id: spec.card, runId: run, mode: "run", outcome: "refused", phase: "P2", reason: `refused for the fixture reason of ${spec.card}`, record: { operatorRunId: id }, ...spec.receipt }));
}

/** The STOP card every fixture card pins. */
export const STOP_ID = "restore-off-production";

/** A press of a STOP card while production is Off: a press record and no policy receipt. */
export function writeStopPress(library: string, at: number, options: { card?: string; run?: unknown } = {}): void {
  const card = options.card ?? STOP_ID;
  const id = "20261104000000000-stop";
  const dir = path.join(library, "runs", "operator", card, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "run.json"), options.run === undefined ? JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: id, scriptId: card, status: "succeeded", startedAt: iso(at) }) : String(options.run));
  writeFileSync(path.join(dir, "descriptor.json"), "{}");
}

/**
 * One production move. An activation admits one Session unless `admitted` says otherwise; its batch is failed (Decision 0181)
 * unless `clean` records the tick's scope complete inside its run, with `escalated` Actions escalated (default none).
 */
export type DayStep = { activate: string; admitted?: number; clean?: boolean; escalated?: number } | { off: string };

/**
 * Production's moves as `start-run day-evidence` reports them: each step moves the revision by one. `earlier` steps happened
 * before the approval press (an hour before `now` in every scenario) and end at `baseline`; `steps` follow it from `baseline`.
 */
export function evidenceOf(baseline: number, now: number, steps: DayStep[], earlier: DayStep[] = []): { evidence: DayEvidence; revision: number } {
  const evidence: DayEvidence = { transitions: [], activations: [] };
  let revision = baseline - earlier.length;
  const timed = [
    ...earlier.map((step, index) => ({ step, at: iso(now - (90 + earlier.length - index) * MINUTE) })),
    ...steps.map((step, index) => ({ step, at: iso(now - (steps.length - index) * MINUTE) }))
  ];
  timed.forEach(({ step, at }, index) => {
    if ("activate" in step) {
      evidence.transitions.push({ requestId: step.activate, transition: "activate", revisionBefore: revision, revisionAfter: revision + 1, at });
      const off = timed.slice(index + 1).find((later) => "off" in later.step);
      evidence.activations.push({
        requestId: step.activate, revisionAfter: revision + 1, at, admitted: step.admitted ?? 1, endedAt: off ? off.at : null,
        scopeComplete: step.clean ? { merged: 1, escalated: step.escalated ?? 0 } : null
      });
    } else evidence.transitions.push({ requestId: step.off, transition: "deactivate", revisionBefore: revision, revisionAfter: revision + 1, at });
    revision += 1;
  });
  return { evidence, revision };
}

export const named = (press: string, cause: string, kind: DayGrantPrevious["kind"]): DayGrantPrevious => ({ press, kind, cause, evidence: "https://github.com/pmark/arcadia/issues/1", clearance: { kind: "observed-cleared", observation: "https://github.com/pmark/arcadia/issues/1#issuecomment-1" } });

export interface DayScenario {
  label: string;
  /** The refusal code in both implementations; "none" when the press is allowed. */
  code: string;
  approval?: Partial<ApprovalSpec>;
  /** Press specs, oldest first. */
  presses?: PressSpec[];
  steps?: DayStep[];
  /** Production's moves before the approval press, ending at its baseline revision. */
  earlier?: DayStep[];
  previous?: DayGrantPrevious | null;
  attempt?: number;
  /** Move the card's pinned policy revision off the chain's end. */
  revisionOffset?: number;
  /** Change the files after the card was pinned, or add a later approval. */
  after?: (library: string, approval: ApprovalFiles, now: number) => void;
  plan?: string;
  /** The card's pinned STOP id, when it is not the fixture's. */
  offId?: string;
}

/** Every scenario, relative to `now` so the executor can run them on the real clock. */
export function dayScenarios(now: number): DayScenario[] {
  const m = (minutes: number) => now - minutes * MINUTE;
  const refused = (card: string, minutes: number, reason?: string, previous?: PressSpec["previous"]): PressSpec => ({ card, at: m(minutes), ...(previous ? { previous } : {}), receipt: reason ? { reason } : {} });
  const started = (card: string, minutes: number, previous?: PressSpec["previous"]): PressSpec => ({ card, at: m(minutes), status: "succeeded", ...(previous ? { previous } : {}), receipt: { outcome: "succeeded", reason: "", productionActivated: true, allowanceConsumed: true } });
  return [
    { label: "the first press of a day, with nothing before it", code: "none", attempt: 1, previous: null },
    { label: "the last minutes of the 24 hours", code: "none", attempt: 1, previous: null, approval: { pressedAt: m(24 * 60 - 5) } },
    { label: "an expired window, one second past 24 hours", code: "WINDOW_EXPIRED", attempt: 1, previous: null, approval: { pressedAt: now - 24 * 60 * MINUTE - 1000 } },
    { label: "a forged approval: a receipt with no press record", code: "APPROVAL_NOT_OPERATOR", attempt: 1, previous: null, approval: { noPressRecord: true } },
    { label: "a forged approval: a press record not from a browser", code: "APPROVAL_NOT_OPERATOR", attempt: 1, previous: null, approval: { browser: false } },
    { label: "a forged approval: no one-shot marker", code: "APPROVAL_NOT_PRESSED", attempt: 1, previous: null, approval: { noConsumedMarker: true } },
    { label: "a forged approval: a refused day-grant run", code: "APPROVAL_NOT_PRESSED", attempt: 1, previous: null, approval: { receipt: { outcome: "refused" } } },
    { label: "an approval press record its run never claimed", code: "APPROVAL_NOT_OPERATOR", attempt: 1, previous: null, approval: { noClaim: true } },
    { label: "an approval press record with a loose day-grant block", code: "APPROVAL_NOT_OPERATOR", attempt: 1, previous: null, approval: { pins: { extra: 1 } } },
    { label: "an approval press record naming another provider", code: "APPROVAL_NOT_OPERATOR", attempt: 1, previous: null, approval: { pins: { provider: "codex-cli" } } },
    { label: "a press since Decision 0170 whose record cannot be read", code: "PRESS_UNREADABLE", attempt: 1, previous: null, after: (library) => { const dir = path.join(library, "runs", "operator", "start-a", "20261104000000000-garbled"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "run.json"), "{not json"); writeFileSync(path.join(dir, "descriptor.json"), "{}"); } },
    { label: "a press since Decision 0170 with no descriptor snapshot", code: "PRESS_UNREADABLE", attempt: 1, previous: null, after: (library) => { const dir = path.join(library, "runs", "operator", "start-a", "20261104000000000-start-a"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "run.json"), JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: "20261104000000000-start-a", scriptId: "start-a", status: "failed", startedAt: iso(m(5)) })); } },
    { label: "a later press record that may be a superseding approval and cannot be read", code: "PRESS_UNREADABLE", attempt: 1, previous: null, after: (library) => { const dir = path.join(library, "runs", "operator", "approve-later-day", "20261104100000000-later"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "descriptor.json"), JSON.stringify({ dayGrant: dayGrantPins() })); } },
    { label: "an unreadable press older than Decision 0170, which is out of scope", code: "none", attempt: 1, previous: null, after: (library) => { const dir = path.join(library, "runs", "operator", "start-old", "20261102000000000-old"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "run.json"), "{not json"); } },
    { label: "a cause recorded as the word undefined", code: "INVALID_DELEGATION", attempt: 1, presses: [refused("start-a", 40)], previous: named(pressKey("start-a"), "undefined", "no-session") },
    { label: "evidence recorded as the word undefined", code: "INVALID_DELEGATION", attempt: 1, presses: [refused("start-a", 40)], previous: { ...named(pressKey("start-a"), "origin-moved", "no-session"), evidence: "undefined" } },
    { label: "a delegated press as the approval", code: "APPROVAL_NOT_OPERATOR", attempt: 1, previous: null, approval: { delegated: true } },
    { label: "an approval receipt altered after pinning", code: "APPROVAL_CHANGED", attempt: 1, previous: null, after: (_l, a) => writeFileSync(a.receiptPath, readFileSync(a.receiptPath, "utf8") + " ") },
    { label: "an approval press record altered after pinning", code: "APPROVAL_CHANGED", attempt: 1, previous: null, after: (_l, a) => writeFileSync(a.pressPath, readFileSync(a.pressPath, "utf8") + " ") },
    { label: "a receipt whose window was stretched past 24 hours", code: "APPROVAL_CHANGED", attempt: 1, previous: null, approval: { record: { windowClosesAt: iso(now + 48 * 60 * MINUTE) } } },
    { label: "a card naming a superseded approval", code: "APPROVAL_SUPERSEDED", attempt: 1, previous: null, after: (library) => { writeDayApproval(library, { card: "approve-later-day", run: "20261104T100000Z-888", press: "20261104100000000-later", pressedAt: m(5) }); } },
    { label: "a card outside the Plan the operator approved", code: "SCOPE_NOT_APPROVED", attempt: 1, previous: null, approval: { pins: { plan: "another-active-plan" } } },
    { label: "a card under another spend Decision", code: "SCOPE_NOT_APPROVED", attempt: 1, previous: null, approval: { pins: { spendDecision: "0999" } } },
    { label: "an operator STOP card ending the day", code: "DAY_ENDED_BY_OPERATOR", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a" }, { off: "restore-off-production-20261104T100000Z-1" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt") },
    { label: "the dashboard Off switch ending the day", code: "DAY_ENDED_BY_OPERATOR", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a" }, { off: "dashboard-toggle-1-abcd" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt") },
    { label: "Rowan's own Off, which does not end the day", code: "none", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-scope-complete-20261104" }], previous: named(pressKey("start-a"), "scope-complete", "clean-batch") },
    { label: "an operator STOP pressed while production is Off, with no policy receipt", code: "DAY_ENDED_BY_OPERATOR", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a" }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt"), after: (library) => writeStopPress(library, m(20)) },
    { label: "a refused or failed press of the STOP card, which still ends the day", code: "DAY_ENDED_BY_OPERATOR", attempt: 1, previous: null, after: (library) => writeStopPress(library, m(20), { run: JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: "20261104000000000-stop", scriptId: STOP_ID, status: "failed", startedAt: iso(m(20)) }) }) },
    { label: "a STOP by the id the card pins, whatever it is called", code: "DAY_ENDED_BY_OPERATOR", attempt: 1, previous: null, offId: "a-custom-stop", after: (library) => writeStopPress(library, m(20), { card: "a-custom-stop" }) },
    { label: "a STOP of the family a card pins another id over", code: "DAY_ENDED_BY_OPERATOR", attempt: 1, previous: null, offId: "a-custom-stop", after: (library) => writeStopPress(library, m(20), { card: "restore-off-production-bug-plan" }) },
    { label: "a STOP before the approval, which opened a new day", code: "none", attempt: 1, previous: null, after: (library) => writeStopPress(library, m(70)) },
    { label: "a card naming the day a STOP ended after a later approval", code: "APPROVAL_SUPERSEDED", attempt: 1, previous: null, after: (library) => { writeStopPress(library, m(20)); writeDayApproval(library, { card: "approve-later-day", run: "20261104T100000Z-888", press: "20261104100000000-later", pressedAt: m(5) }); } },
    { label: "a STOP press whose record cannot be read", code: "PRESS_UNREADABLE", attempt: 1, previous: null, after: (library) => writeStopPress(library, m(20), { run: "{not json" }) },
    { label: "a STOP press with no readable start time", code: "PRESS_UNREADABLE", attempt: 1, previous: null, after: (library) => writeStopPress(library, m(20), { run: JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: "20261104000000000-stop", scriptId: STOP_ID, status: "succeeded", startedAt: "not a time" }) }) },
    { label: "an approval receipt that is gone", code: "APPROVAL_MISSING", attempt: 1, previous: null, after: (_l, a) => rmSync(a.receiptPath) },
    { label: "an operator Off shaped like the executor's, naming no run", code: "DAY_ENDED_BY_OPERATOR", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a" }, { off: "start-a-operator-stop-off" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt") },
    { label: "an Off naming a run that did not return its Grant", code: "DAY_ENDED_BY_OPERATOR", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a" }, { off: "start-a-20261104T100000Z-1-off" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt") },
    { label: "a refused re-press of a card whose earlier press admitted a Session", code: "none", attempt: 2, presses: [started("start-a", 50), { card: "start-a", id: "20261104000000000-start-a-again", at: m(40), receipt: { reason: "the one-shot START allowance is consumed" } }], steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }], previous: named("start-a/20261104000000000-start-a-again", "consumed-card", "no-session") },
    { label: "a card calling that refused re-press a failed attempt", code: "PREVIOUS_MISMATCH", attempt: 2, presses: [started("start-a", 50), { card: "start-a", id: "20261104000000000-start-a-again", at: m(40), receipt: { reason: "the one-shot START allowance is consumed" } }], steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }], previous: named("start-a/20261104000000000-start-a-again", "consumed-card", "failed-attempt") },
    { label: "an admitted Session no press of its card owns", code: "EVIDENCE_MISMATCH", attempt: 2, presses: [refused("start-a", 40)], steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "x", "clean-batch") },
    { label: "a press snapshot changed from what the receipt recorded", code: "APPROVAL_CHANGED", attempt: 1, previous: null, approval: { record: { plan: "the-plan-the-receipt-names" } } },
    { label: "the executor returning its own Grant to Off: not the operator's Off, but a failed batch", code: "FAILED_BATCH", attempt: 2, presses: [{ card: "start-a", at: m(40), status: "failed", receipt: { reason: "verification failed", productionActivated: true, offCleanup: "returned_off", allowanceConsumed: true } }], steps: [{ activate: "start-a" }, { off: "start-a-20261104T100000Z-1-off" }], previous: named(pressKey("start-a"), "failed-verification", "failed-attempt") },
    { label: "another Grant activated since the approval", code: "PRODUCTION_CHANGED", attempt: 2, steps: [{ activate: "dashboard-toggle-2-beef", admitted: 1 }, { off: "rowan-off-x" }], previous: null },
    { label: "a policy revision the chain does not explain", code: "PRODUCTION_CHANGED", attempt: 1, previous: null, revisionOffset: 1 },
    { label: "a fourth batch after three clean ones, which no count caps (Decision 0181)", code: "none", attempt: 4,
      presses: [started("start-a", 50), started("start-b", 40, { press: pressKey("start-a"), cause: "scope-complete", kind: "clean-batch" }), started("start-c", 30, { press: pressKey("start-b"), cause: "scope-complete", kind: "clean-batch" })],
      steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }, { activate: "start-b", clean: true }, { off: "rowan-off-b" }, { activate: "start-c", clean: true }, { off: "rowan-off-c" }],
      previous: named(pressKey("start-c"), "scope-complete", "clean-batch") },
    { label: "a clean batch, which does not stop the next card", code: "none", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "scope-complete", "clean-batch") },
    { label: "a clean batch still Active, whose next card waits only on production being Off", code: "none", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a", clean: true }], previous: named(pressKey("start-a"), "scope-complete", "clean-batch") },
    { label: "one failed batch in this day, which stops for the operator", code: "FAILED_BATCH", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a" }, { off: "rowan-off-stuck-20261104" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt") },
    { label: "a failed batch after a clean one in this day", code: "FAILED_BATCH", attempt: 3,
      presses: [started("start-a", 50), started("start-b", 40, { press: pressKey("start-a"), cause: "scope-complete", kind: "clean-batch" })],
      steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }, { activate: "start-b" }, { off: "rowan-off-b" }], previous: named(pressKey("start-b"), "stuck-run", "failed-attempt") },
    { label: "a batch that reached scope complete with an Action escalated, which failed", code: "FAILED_BATCH", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a", clean: true, escalated: 1 }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "escalated", "failed-attempt") },
    { label: "a failed batch still running when the day was pressed", code: "FAILED_BATCH", attempt: 2, presses: [started("start-a", 150)], earlier: [{ activate: "start-a" }], steps: [{ off: "rowan-off-stuck-20261104" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt") },
    { label: "a failed batch over before the day was pressed, which the operator's press moved past", code: "none", attempt: 2, presses: [started("start-a", 150)], earlier: [{ activate: "start-a" }, { off: "dashboard-toggle-1-abcd" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt") },
    { label: "a card calling a clean batch a failed attempt", code: "PREVIOUS_MISMATCH", attempt: 2, presses: [started("start-a", 40)], steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "stuck-run", "failed-attempt") },
    { label: "a card calling a failed batch clean", code: "PREVIOUS_MISMATCH", attempt: 2, presses: [started("start-a", 150)], earlier: [{ activate: "start-a" }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "scope-complete", "clean-batch") },
    { label: "an attempt already used, which counts", code: "ATTEMPT_MISMATCH", attempt: 1, presses: [started("start-a", 40)], steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "scope-complete", "clean-batch") },
    { label: "a START that admitted no Session is no attempt", code: "none", attempt: 1, presses: [started("start-a", 40)], steps: [{ activate: "start-a", admitted: 0 }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "no-admission", "no-session") },
    { label: "a refused press with no attempt used", code: "none", attempt: 1, presses: [refused("start-a", 40)], previous: named(pressKey("start-a"), "origin-moved", "no-session") },
    { label: "a third refused re-press", code: "REPRESSES_EXHAUSTED", attempt: 1,
      presses: [refused("start-a", 50), refused("start-b", 40, undefined, { press: pressKey("start-a"), cause: "one" }), refused("start-c", 30, undefined, { press: pressKey("start-b"), cause: "two" })],
      previous: named(pressKey("start-c"), "three", "no-session") },
    { label: "a second re-press, still within the two", code: "none", attempt: 1,
      presses: [refused("start-a", 50), refused("start-b", 40, undefined, { press: pressKey("start-a"), cause: "one" })],
      previous: named(pressKey("start-b"), "two", "no-session") },
    { label: "the same refusal recurring, however it is renamed", code: "SAME_REFUSAL", attempt: 1,
      presses: [refused("start-a", 50, "origin main is abcdef1234 at revision 83"), refused("start-b", 40, "origin main is 9876543fed at revision 84", { press: pressKey("start-a"), cause: "origin-moved" })],
      previous: named(pressKey("start-b"), "a-new-name", "no-session") },
    { label: "the same named refusal recurring", code: "SAME_REFUSAL", attempt: 1,
      presses: [refused("start-a", 50), refused("start-b", 40, undefined, { press: pressKey("start-a"), cause: "capacity-stale" })],
      previous: named(pressKey("start-b"), "capacity-stale", "no-session") },
    { label: "a same-cause third attempt", code: "SAME_CAUSE", attempt: 3,
      presses: [started("start-a", 160), started("start-b", 140, { press: pressKey("start-a"), cause: "stuck-run", kind: "failed-attempt" })],
      earlier: [{ activate: "start-a" }, { off: "rowan-off-a" }, { activate: "start-b" }, { off: "rowan-off-b" }],
      previous: named(pressKey("start-b"), "stuck-run", "failed-attempt") },
    { label: "a third attempt on a different cause", code: "none", attempt: 3,
      presses: [started("start-a", 160), started("start-b", 140, { press: pressKey("start-a"), cause: "stuck-run", kind: "failed-attempt" })],
      earlier: [{ activate: "start-a" }, { off: "rowan-off-a" }, { activate: "start-b" }, { off: "rowan-off-b" }],
      previous: named(pressKey("start-b"), "provider-outage", "failed-attempt") },
    { label: "two clean batches named for one cause, which no attempt failed on", code: "none", attempt: 3,
      presses: [started("start-a", 50), started("start-b", 40, { press: pressKey("start-a"), cause: "scope-complete", kind: "clean-batch" })],
      steps: [{ activate: "start-a", clean: true }, { off: "rowan-off-a" }, { activate: "start-b", clean: true }, { off: "rowan-off-b" }],
      previous: named(pressKey("start-b"), "scope-complete", "clean-batch") },
    { label: "a card with no cause named for the latest press", code: "PREVIOUS_CAUSE_REQUIRED", attempt: 1, presses: [refused("start-a", 40)], previous: null },
    { label: "a card naming another press as the latest", code: "PREVIOUS_MISMATCH", attempt: 1, presses: [refused("start-a", 40)], previous: named(pressKey("start-zzz"), "x", "no-session") },
    { label: "a card calling a failed attempt a refusal", code: "PREVIOUS_MISMATCH", attempt: 2, presses: [started("start-a", 150)], earlier: [{ activate: "start-a" }, { off: "rowan-off-a" }], previous: named(pressKey("start-a"), "x", "no-session") },
    { label: "a latest press still running", code: "PREVIOUS_UNSETTLED", attempt: 1, presses: [{ card: "start-a", at: m(5), status: "running", receipt: { outcome: "in_progress" } }], previous: named(pressKey("start-a"), "x", "no-session") },
    { label: "a successful START receipt production does not record", code: "EVIDENCE_MISMATCH", attempt: 1, presses: [started("start-a", 40)], previous: named(pressKey("start-a"), "x", "failed-attempt") }
  ];
}

export function writeDayScenario(library: string, scenario: DayScenario, now: number): { approval: ApprovalFiles; evidence: DayEvidence; revision: number; policyRevision: number } {
  const baseline = 83;
  const approval = writeDayApproval(library, { pressedAt: now - 60 * MINUTE, baseline, ...scenario.approval });
  (scenario.presses ?? []).forEach((spec, index) => writeStartPress(library, spec, index));
  const { evidence, revision } = evidenceOf(baseline, now, scenario.steps ?? [], scenario.earlier ?? []);
  scenario.after?.(library, approval, now);
  return { approval, evidence, revision, policyRevision: revision + (scenario.revisionOffset ?? 0) };
}

/** The header set a real browser sends on the Tailnet URL: plain HTTP at a non-loopback name, so no `Sec-Fetch-*` at all. */
export const TAILNET_PRESS_HEADERS = { origin: "http://arcadia-1.alpine-rattlesnake.ts.net:3020", host: "arcadia-1.alpine-rattlesnake.ts.net:3020" };

export const removeFixture = (root: string) => rmSync(root, { recursive: true, force: true });
