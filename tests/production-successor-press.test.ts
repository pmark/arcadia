import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProductionLivenessTimerCommand } from "../src/commands/productionMomentum.js";
import { ROWAN_OFF_REQUEST, standingGrantStatus, STANDING_SLUG, type DayGrantPressKind, type StandingDecisionSource } from "../src/operatorActions/startRunDayGrant.js";
import { deriveStartCard, verifyDerivedCard, type DeriveInput, type DerivePlanAction, type FailedBatchClearance } from "../src/operatorActions/startRunDerive.js";
import { delegatedPressMarker } from "../src/operatorActions/startRunDelegation.js";
import { buildReplayReceipt, checkReplayReceipt, replayCardIdentity, replayReceiptPath } from "../src/operatorActions/startRunReplayReceipt.js";
import { SUCCESSOR_OFF_SLUG, emptySuccessorState, runSuccessorPressStep, type SuccessorPorts, type SuccessorProduction, type SuccessorState } from "../src/production/successorPress.js";
import { DAY_PLAN, DAY_RUN, STOP_ID, writeDayApproval, writeDayScenario } from "./helpers/dayGrantFixture.js";

/**
 * The successor-press step of the host timer: while a standing grant is open it mints, checks and presses the next START card
 * after each clean batch. The ports are fakes over one temp library; the card is the real `deriveStartCard` result, the replay
 * receipt is the real one and the delegated marker is the runner's own `delegatedPressMarker`.
 */
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const tempDir = (prefix: string) => { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))); directories.push(dir); return dir; };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const T0 = Date.parse("2026-11-17T20:00:30Z");
const MINUTE = 60_000;
const MAIN = "a".repeat(40);
const GRANT_CARD = "approve-standing-grant-fixture";

interface World {
  library: string;
  now: number;
  production: SuccessorProduction;
  batch: { press: string; kind: DayGrantPressKind | "unsettled" } | null;
  checks: { green: boolean; detail: string };
  holds: string[];
  grantOpen: boolean;
  /** Plan Action ids in queue order, and which are done. */
  actions: string[];
  done: Set<string>;
  clearances: Map<string, FailedBatchClearance>;
  pressRefusal: { code: string; message: string } | null;
  replayNoLaunch: boolean;
  pings: Array<{ message: string; key: string }>;
  offs: string[];
  lastCard?: string[];
  minted: Array<{ id: string; at: number }>;
  pressLog: Array<{ card: string; at: number }>;
  ports: SuccessorPorts;
}

const ids = (count: number) => Array.from({ length: count }, (_, index) => `action-${String(index).padStart(2, "0")}`);

function world(options: { actions?: number; library?: string } = {}): World {
  const library = options.library ?? tempDir("arcadia-successor-");
  mkdirSync(path.join(library, "reviewed"), { recursive: true });
  const w: World = {
    library, now: T0, production: { desiredState: "inactive", liveAdmissions: 0, scopeComplete: false, revision: 90 }, batch: null, checks: { green: true, detail: "green" }, holds: [], grantOpen: true,
    actions: ids(options.actions ?? 14), done: new Set(), clearances: new Map(), pressRefusal: null, replayNoLaunch: false, pings: [], offs: [], minted: [], pressLog: [], ports: undefined as never
  };
  const deriveFor = (clearance: FailedBatchClearance | null) => {
    const planActions: DerivePlanAction[] = w.actions.map((id) => ({ id, status: w.done.has(id) ? "done" : "open", dependsOn: [], criteriaErrors: [] }));
    const input: DeriveInput = {
      originMain: MAIN, now: new Date(w.now), executorSha256: sha("executor"), workspace: "martianrover", workerLabel: "com.arcadia.local.1.worker", gateCardId: "enable-capacity-gate-20261017", offId: STOP_ID,
      grant: { open: true, plan: DAY_PLAN, approvalCard: GRANT_CARD, approvalRun: DAY_RUN, reason: null },
      plan: { slug: DAY_PLAN, project: "arcadia", status: "active", isProjectActivePlan: true, actions: planActions },
      production: { desiredState: w.production.desiredState, liveAdmissions: w.production.liveAdmissions, revision: w.production.revision, epoch: 50 },
      queue: { revision: 290, orderValid: true, unpositionedCount: 0, keys: w.actions.filter((id) => !w.done.has(id)).map((id) => `arcadia/${id}`) },
      chain: { receiptSha256: "a".repeat(64), pressSha256: "b".repeat(64), attemptsSoFar: w.pressLog.length, latest: w.batch && w.batch.kind !== "unsettled" ? { press: w.batch.press, kind: w.batch.kind } : null },
      consumedHistory: [{ path: "/runs/receipts/consumed-1.json", sha256: "c".repeat(64) }], ...(clearance ? { failedBatchClearance: clearance } : {})
    };
    return deriveStartCard(input);
  };
  w.ports = {
    get now() { return new Date(w.now); },
    grant: () => ({ open: w.grantOpen, plan: DAY_PLAN, approvalCard: GRANT_CARD, approvalRun: DAY_RUN }),
    production: () => ({ ...w.production }),
    batch: () => w.batch,
    mainChecks: () => w.checks,
    holds: () => w.holds,
    clearance: (press) => w.clearances.get(press) ?? null,
    derive: deriveFor,
    mint: (card) => {
      writeFileSync(path.join(library, `${card.id}.json`), card.descriptorBytes);
      writeFileSync(path.join(library, `${card.id}.sh`), card.launcher);
      writeFileSync(path.join(library, "reviewed", `${card.id}.json`), card.manifestBytes);
      w.minted.push({ id: card.id, at: w.now });
    },
    replay: (card) => {
      const bound = replayCardIdentity(readFileSync(path.join(library, `${card.id}.json`), "utf8"))!;
      const launches = w.replayNoLaunch ? [] : card.actions.map((action, index) => ({ launch: { outcome: "launched", actionKey: `arcadia/${action}` }, index }));
      const receipt = buildReplayReceipt(card.id, bound.identity, "arcadia", { activation: { ok: true }, ticks: launches }, new Date(w.now).toISOString());
      mkdirSync(path.join(library, "replays"), { recursive: true });
      writeFileSync(replayReceiptPath(library, card.id), JSON.stringify(receipt));
      return checkReplayReceipt(readFileSync(replayReceiptPath(library, card.id), "utf8"), bound.identity);
    },
    recordPrePress: (card, pointer) => writeFileSync(path.join(library, "reviewed", `${card.id}.json`), `${JSON.stringify({ ...JSON.parse(card.manifestBytes), premortem: pointer }, null, 2)}\n`),
    preflight: () => ({ ok: true }),
    press: (card) => {
      if (w.pressRefusal) return { ok: false, ...w.pressRefusal };
      const descriptor = JSON.parse(readFileSync(path.join(library, `${card}.json`), "utf8")) as { startRun: { actions: string[]; delegation: never } };
      // The runner records Rowan's press with the marker it derives from the card; an operator press records none.
      const press = delegatedPressMarker(descriptor, { decision: "0173", agent: "rowan" })!;
      const pressId = `${new Date(w.now).toISOString().replace(/[-:.TZ]/g, "")}-${card}`;
      const dir = path.join(library, "runs", "operator", card, pressId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "run.json"), JSON.stringify({ schema: "arcadia-operator-script-run-v1", runId: pressId, scriptId: card, status: "running", startedAt: new Date(w.now).toISOString(), press }));
      w.pressLog.push({ card, at: w.now });
      w.production = { ...w.production, desiredState: "active", liveAdmissions: 1, scopeComplete: false, revision: w.production.revision + 1 };
      w.lastCard = descriptor.startRun.actions;
      return { ok: true, runId: pressId };
    },
    retire: (card) => { for (const file of [`${card}.json`, `${card}.sh`, `reviewed/${card}.json`]) rmSync(path.join(library, file), { force: true }); },
    ping: (input) => { w.pings.push(input); return `ping-${w.pings.length}`; },
    off: (slug) => { w.offs.push(`rowan-off-${slug}`); w.production = { ...w.production, desiredState: "inactive", liveAdmissions: 0, scopeComplete: false, revision: w.production.revision + 1 }; }
  };
  return w;
}

/** The batch the last press started runs to scope complete: its Actions merge, production reads Active with nothing left. */
function finishBatch(w: World, kind: DayGrantPressKind = "clean-batch") {
  for (const id of w.lastCard ?? []) w.done.add(id);
  const last = w.pressLog.at(-1)!;
  w.production = { ...w.production, liveAdmissions: 0, scopeComplete: true };
  w.batch = { press: `${last.card}/run`, kind };
  w.now += 30 * MINUTE;
}
const step = (w: World, state: SuccessorState) => runSuccessorPressStep(w.ports, state);
const cardsInLibrary = (library: string) => readdirSync(library).filter((name) => name.endsWith(".json") && name.startsWith("standing-start-"));
const pressRecords = (library: string) => {
  const root = path.join(library, "runs", "operator");
  const records: Array<{ card: string; press?: { kind: string }; browserPress?: boolean }> = [];
  for (const card of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const run of readdirSync(path.join(root, card.name))) records.push({ card: card.name, ...JSON.parse(readFileSync(path.join(root, card.name, run, "run.json"), "utf8")) });
  }
  return records;
};

describe("successor press: two batches on one Plan", () => {
  it("runs two consecutive batches to scope complete with exactly 1 operator press, the standing grant, and both START presses delegated", () => {
    const w = world({ actions: 14 });
    // The operator's one press: the standing-grant approval, written as the /actions runner records a browser press.
    writeDayApproval(w.library, { standing: true, card: GRANT_CARD, run: DAY_RUN, pressedAt: T0 - 60 * MINUTE });
    let state = emptySuccessorState();

    const first = step(w, state); state = first.state;
    expect(first.outcome).toMatchObject({ kind: "pressed" });
    expect((first.outcome as { actions: string[] }).actions).toEqual(ids(14).slice(0, 12));
    expect(step(w, state).outcome).toMatchObject({ kind: "skipped", reason: "PRODUCTION_NOT_OFF" });

    finishBatch(w);
    const second = step(w, state); state = second.state;
    expect(second.outcome).toMatchObject({ kind: "pressed", offIssued: true });
    expect((second.outcome as { actions: string[] }).actions).toEqual(ids(14).slice(12));

    finishBatch(w);
    const third = step(w, state);
    expect(third.outcome).toMatchObject({ kind: "skipped", reason: "NOTHING_READY", offIssued: true });
    expect(w.offs).toEqual([`rowan-off-${SUCCESSOR_OFF_SLUG}`, `rowan-off-${SUCCESSOR_OFF_SLUG}`]);
    expect(w.done.size).toBe(14);

    const records = pressRecords(w.library);
    const operator = records.filter((record) => record.card === GRANT_CARD && record.browserPress === true && record.press === undefined);
    const delegated = records.filter((record) => record.press?.kind === "delegated");
    expect(operator).toHaveLength(1);
    expect(delegated).toHaveLength(2);
    expect(records).toHaveLength(3);
    for (const record of delegated) expect(record.press).toMatchObject({ agent: "rowan", decision: "0173" });
  });

  it("mints the next unfinished Actions in queue order, at most 12, and presses in the same run, leaving no unpressed card", () => {
    const w = world({ actions: 30 });
    w.done.add("action-00");
    const result = step(w, emptySuccessorState());
    expect(result.outcome).toMatchObject({ kind: "pressed" });
    expect((result.outcome as { actions: string[] }).actions).toEqual(ids(30).slice(1, 13));
    expect(w.minted).toHaveLength(1);
    expect(w.pressLog).toEqual([{ card: w.minted[0].id, at: w.minted[0].at }]);
    // Every card in the library has a press record: none is waiting, so none can age past its 10 minutes.
    const pressed = new Set(pressRecords(w.library).map((record) => record.card));
    expect(cardsInLibrary(w.library).map((name) => name.slice(0, -".json".length)).filter((id) => !pressed.has(id))).toEqual([]);
  });
});

describe("successor press: when it presses", () => {
  const cases: Array<[string, (w: World) => void, string]> = [
    ["production is not Off", (w) => { w.production = { ...w.production, desiredState: "active", liveAdmissions: 1 }; }, "PRODUCTION_NOT_OFF"],
    ["the previous batch has not finished", (w) => { w.batch = { press: "x/y", kind: "unsettled" }; }, "BATCH_NOT_CLEAN"],
    ["main's required checks are not green", (w) => { w.checks = { green: false, detail: "lint (in_progress)" }; }, "MAIN_CHECKS_NOT_GREEN"],
    ["a card hold exists", (w) => { w.holds = ["START card held-card is held"]; }, "CARD_HELD"],
    ["no standing grant is open", (w) => { w.grantOpen = false; }, "GRANT_NOT_OPEN"]
  ];
  for (const [label, arrange, reason] of cases) {
    it(`records one named skip and presses nothing when ${label}`, () => {
      const w = world();
      arrange(w);
      const result = step(w, emptySuccessorState());
      expect(result.outcome).toMatchObject({ kind: "skipped", reason });
      expect(w.minted).toEqual([]);
      expect(w.pressLog).toEqual([]);
      expect(w.pings).toEqual([]);
      expect(cardsInLibrary(w.library)).toEqual([]);
    });
  }

  it("presses when every condition holds", () => {
    const w = world({ actions: 3 });
    w.batch = { press: "x/y", kind: "clean-batch" };
    expect(step(w, emptySuccessorState()).outcome).toMatchObject({ kind: "pressed" });
  });
});

describe("successor press: the pre-press check", () => {
  it("after a clean batch the manifest carries the replay receipt as its pre-press check and the press passes", () => {
    const w = world({ actions: 3 });
    w.batch = { press: "x/y", kind: "clean-batch" };
    // What the press-time re-derivation returns for this state: the same bytes the step minted, before the press moved production.
    const expected = w.ports.derive(null);
    const result = step(w, emptySuccessorState());
    expect(result.outcome).toMatchObject({ kind: "pressed" });
    const card = (result.outcome as { card: string }).card;
    const manifest = JSON.parse(readFileSync(path.join(w.library, "reviewed", `${card}.json`), "utf8")) as { premortem: string };
    expect(manifest.premortem).toBe(`replays/${card}.json`);
    expect(JSON.parse(readFileSync(path.join(w.library, manifest.premortem), "utf8"))).toMatchObject({ schema: "arcadia-start-run-replay-receipt-v1", card });
    // The press-time re-derivation still accepts the card with that one extra manifest key.
    expect(expected.ok).toBe(true);
    const onDisk = { descriptor: readFileSync(path.join(w.library, `${card}.json`), "utf8"), launcher: readFileSync(path.join(w.library, `${card}.sh`), "utf8"), manifest: readFileSync(path.join(w.library, "reviewed", `${card}.json`), "utf8") };
    expect(verifyDerivedCard(expected, onDisk)).toMatchObject({ verified: true, differs: [] });
  });

  it("refuses the press after a failed batch until an independent pre-mortem pointer and a merged fix are recorded, then presses with that pointer", () => {
    const w = world({ actions: 3 });
    w.batch = { press: "x/y", kind: "failed-attempt" };
    const refused = step(w, emptySuccessorState());
    expect(refused.outcome).toMatchObject({ kind: "refused", code: "FAILED_BATCH_NEEDS_FIX" });
    expect(w.pressLog).toEqual([]);
    expect(w.pings).toHaveLength(1);
    // Replays add neither a press nor a ping while the cause stays unrecorded.
    const replayed = step(w, refused.state);
    expect(replayed.outcome).toMatchObject({ kind: "skipped", reason: "STEP_ENDED" });
    expect(w.pings).toHaveLength(1);

    w.clearances.set("x/y", {
      cause: "worker-merge-race", premortem: "https://github.com/pmark/arcadia/issues/1#issuecomment-9",
      fix: { pullRequest: "https://github.com/pmark/arcadia/pull/2", commit: "c".repeat(40), reproduction: "src/production/workerMerge.ts" }
    });
    const resumed = step(w, replayed.state);
    expect(resumed.outcome).toMatchObject({ kind: "pressed" });
    const card = (resumed.outcome as { card: string }).card;
    const manifest = JSON.parse(readFileSync(path.join(w.library, "reviewed", `${card}.json`), "utf8")) as { premortem: string };
    expect(manifest.premortem).toBe("https://github.com/pmark/arcadia/issues/1#issuecomment-9");
    const descriptor = JSON.parse(readFileSync(path.join(w.library, `${card}.json`), "utf8")) as { startRun: { delegation: { previous: { kind: string; clearance: { kind: string; cause: string } } } } };
    expect(descriptor.startRun.delegation.previous).toMatchObject({ kind: "failed-attempt", clearance: { kind: "merged-fix", cause: "worker-merge-race" } });
  });
});

describe("successor press: a refused press", () => {
  it("sends exactly one operator ping naming the refusal code, ends the step for that grant, and a replay adds no second press or ping", () => {
    const w = world({ actions: 3 });
    w.pressRefusal = { code: "PREVIOUS_UNSETTLED", message: "the latest START press has not finished" };
    const first = step(w, emptySuccessorState());
    expect(first.outcome).toMatchObject({ kind: "refused", code: "PREVIOUS_UNSETTLED", pingId: "ping-1" });
    expect(w.pings).toHaveLength(1);
    expect(w.pings[0].message).toContain("PREVIOUS_UNSETTLED");
    expect(w.pressLog).toEqual([]);
    // The refused card is retired, so the library holds no unpressed delegated card.
    expect(cardsInLibrary(w.library)).toEqual([]);

    w.pressRefusal = null;
    const again = step(w, first.state);
    const third = step(w, again.state);
    expect(again.outcome).toMatchObject({ kind: "skipped", reason: "STEP_ENDED" });
    expect(third.outcome).toMatchObject({ kind: "skipped", reason: "STEP_ENDED" });
    expect(w.pings).toHaveLength(1);
    expect(w.pressLog).toEqual([]);
    expect(w.minted).toHaveLength(1);
  });

  it("retries only an undelivered ping, never a press", () => {
    const w = world({ actions: 3 });
    w.pressRefusal = { code: "PRESS_UNREACHABLE", message: "connection refused" };
    let fail = true;
    const realPing = w.ports.ping.bind(w.ports);
    w.ports.ping = (input) => { if (fail) throw new Error("outbox locked"); return realPing(input); };
    const first = step(w, emptySuccessorState());
    expect(first.outcome).toMatchObject({ kind: "refused", pingId: null });
    fail = false;
    const retried = step(w, first.state);
    expect(retried.outcome).toMatchObject({ kind: "skipped", reason: "STEP_ENDED" });
    expect(w.pings).toHaveLength(1);
    expect(retried.state.ended?.pingId).toBe("ping-1");
    expect(w.pressLog).toEqual([]);
  });

  it("refuses a card whose replay predicts no launch, naming the replay's code", () => {
    const w = world({ actions: 3 });
    w.replayNoLaunch = true;
    const result = step(w, emptySuccessorState());
    expect(result.outcome).toMatchObject({ kind: "refused", code: "REPLAY_PREDICTS_NO_LAUNCH" });
    expect(w.pressLog).toEqual([]);
    expect(cardsInLibrary(w.library)).toEqual([]);
  });
});

describe("successor press: the Off at scope complete", () => {
  it("issues the Off through the rowan-off route, which does not end the standing grant", () => {
    const w = world({ actions: 2 });
    writeDayApproval(w.library, { standing: true, card: GRANT_CARD, run: DAY_RUN, pressedAt: T0 - 60 * MINUTE });
    w.production = { desiredState: "active", liveAdmissions: 0, scopeComplete: true, revision: 91 };
    const result = step(w, emptySuccessorState());
    expect(result.outcome).toMatchObject({ offIssued: true });
    expect(w.offs).toEqual([`rowan-off-${SUCCESSOR_OFF_SLUG}`]);
    expect(w.offs[0]).toMatch(ROWAN_OFF_REQUEST);
    // The same Off in production's record leaves the grant open; any other request id ends it.
    const decision: StandingDecisionSource = { paths: [`docs/decisions/0241-${STANDING_SLUG}.md`], read: () => `---\nid: "0241"\nstatus: approved\nanswer: E. Standing grant\n---\n` };
    const status = (offId: string) => {
      const library = tempDir("arcadia-successor-grant-");
      const written = writeDayScenario(library, { label: "", code: "", approval: { standing: true }, steps: [{ off: offId }] }, T0);
      return standingGrantStatus({ library, now: new Date(T0), evidence: written.evidence, offId: STOP_ID, standingDecision: decision });
    };
    expect(status(w.offs[0]).open).toBe(true);
    expect(status("operator-off-by-hand").open).toBe(false);
    expect(status("operator-off-by-hand").endedBy).toBe("operator-off");
  });

  it("issues the Off once per policy revision, and never while Sessions are live or scope is not complete", () => {
    const w = world({ actions: 2 });
    w.production = { desiredState: "active", liveAdmissions: 1, scopeComplete: true, revision: 91 };
    step(w, emptySuccessorState());
    w.production = { desiredState: "active", liveAdmissions: 0, scopeComplete: false, revision: 91 };
    step(w, emptySuccessorState());
    expect(w.offs).toEqual([]);
  });
});

describe("successor press: runs from the existing timer", () => {
  it("is a step of `production liveness-check --successor-press`, with no agent session, and is off without the flag", async () => {
    const workspace = path.join(tempDir("arcadia-successor-ws-"), "workspace");
    const { initWorkspace } = await import("../src/workspace/initWorkspace.js");
    initWorkspace(workspace);
    const w = world({ actions: 2 });
    const calls: string[] = [];
    const run = (successorPress: boolean) => runProductionLivenessTimerCommand(
      { workspace, successorPress },
      { successor: { ports: () => { calls.push("ports"); return w.ports; } } }
    );
    const off = await run(false).catch((error: unknown) => error);
    expect(calls).toEqual([]);
    const on = await run(true).catch((error: unknown) => error);
    expect(calls).toEqual(["ports"]);
    // The liveness and momentum checks may fail on a bare workspace; the step still ran and recorded its outcome.
    if (!(on instanceof Error)) expect((on as { data: { successor: { outcome: { kind: string } } } }).data.successor.outcome.kind).toBe("pressed");
    else expect(w.pressLog).toHaveLength(1);
    void off;
    expect(JSON.parse(readFileSync(path.join(workspace, ".arcadia", "successor-press.json"), "utf8")).pressed).toHaveLength(1);
  });
});
