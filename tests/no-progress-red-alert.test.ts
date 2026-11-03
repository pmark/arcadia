import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listPendingAgentAskNotifications } from "../src/ask/settlement.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { RED_ALERT_TRIGGERS } from "../src/production/redAlerts.js";
import { isUnchangedResumeExit } from "../src/production/tick.js";
import { classifyRecoverySignals, type RecoveryLedgerRows, type RecoverySessionExitRow } from "../src/production/recoverySignals.js";
import { isolateProcess, type IsolatedProcess } from "./fast-rehearsal/helpers/environment.js";
import type { ActionWork, LaunchRecord } from "./fast-rehearsal/helpers/executor.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS, WORK } from "./fast-rehearsal/helpers/world.js";

/**
 * Decision 0169: a resumed Session that exits incomplete with its candidate
 * unchanged raises one notify-only red alert, reusing the tick's existing
 * unchanged-resume detection at the exit receipt (`unchanged` in
 * src/production/tick.ts) with no second detector. Real worker tick; only the
 * reviewer model, GitHub, tmux and the agent are faked.
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

const MAX = 2; // PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction, asserted below
const alertsOf = (world: FastRehearsal) => world.redAlerts().filter((alert) => alert.trigger === "resume_no_progress");
const noticesOf = (world: FastRehearsal) => withDatabase(world.workspace, (db) =>
  listPendingAgentAskNotifications(db).filter((entry) => entry.requestId?.startsWith("red-alert-") && entry.desiredResult.includes("(resume_no_progress)")));
const attempts = (world: FastRehearsal) => withReadOnlyDatabase(world.workspace, (db) =>
  (db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?").get(world.actionKey(ACTION_1)) as { attempts: number } | undefined)?.attempts ?? 0);
const moreWork: ActionWork = { files: { ...(WORK[ACTION_1].files as Record<string, string>), "MORE.md": "more work in the resumed Session\n" }, validation: WORK[ACTION_1].validation };

function newWorld(name: string, breakRaising = false): FastRehearsal {
  const world = new FastRehearsal(name, isolation, import.meta.filename);
  worlds.push(world);
  world.expectError(/The candidate has no commits or changes beyond its base revision|repair budget|exhaust|Red alert/i);
  world.start();
  if (breakRaising) {
    withDatabase(world.workspace, (db) => db.exec(
      "CREATE TRIGGER inject_no_progress_failure BEFORE INSERT ON production_red_alerts WHEN NEW.trigger = 'resume_no_progress' BEGIN SELECT RAISE(ABORT, 'injected raise failure'); END;"
    ));
  }
  return world;
}

/** First Session commits work and dies (incomplete, resumable); returns the resumed Session's launch. */
function firstSessionDies(world: FastRehearsal): LaunchRecord {
  const first = world.untilLaunched(ACTION_1, 3);
  world.execute(first.launch, ACTION_1, "interrupted-after-work-commit");
  return world.untilLaunched(ACTION_1, 6).launch;
}

const scrub = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/session_[0-9a-f]+/g, "session_X")) as unknown;

/** The observable run: repair attempts, the next launch decision, the Action's status, escalations, Sessions. */
function observed(world: FastRehearsal) {
  return {
    attempts: attempts(world),
    launches: world.tmux.launches.length,
    lease: world.lease() === null,
    action: world.planAction(world.repo, ACTION_1),
    // Whole rows (message, remedy, timestamps), not kinds: an observer that wrote any of it would differ.
    escalations: scrub(world.escalations()),
    repairAttempts: scrub(withReadOnlyDatabase(world.workspace, (db) => db.prepare("SELECT * FROM production_repair_attempts ORDER BY action_key").all())),
    sessions: world.sessions().map((s) => [s.action_id, s.status])
  };
}

describe("the recovery-signal classifier on the replay fixture rows", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/recovery-replay/ledger-rows.json", import.meta.url), "utf8")) as RecoveryLedgerRows;
  it("produces the no_progress signal the alert is raised for, on the real 04:44:50Z receipt, and the alert trigger is registered", () => {
    const signals = classifyRecoverySignals({ sessionExits: fixture.sessionExits, operatorHeldMarks: fixture.operatorHeldMarks });
    expect(signals.filter((s) => s.kind === "no_progress").map((s) => s.at.slice(11, 19))).toEqual(["04:44:50", "04:52:40", "04:55:14"]);
    expect(RED_ALERT_TRIGGERS).toContain("resume_no_progress");
  });
  it("is silent on exactly the receipts the tick raises nothing for: a changed candidate, a fresh first Session, a held Action", () => {
    const exit = fixture.sessionExits!.find((row) => row.at.startsWith("2026-11-02T04:44:50"))!;
    const kinds = (rows: RecoveryLedgerRows) => classifyRecoverySignals(rows).map((s) => s.kind);
    expect(kinds({ sessionExits: [exit] })).toEqual(["no_progress"]);
    expect(kinds({ sessionExits: [{ ...exit, candidateRevision: "changed" }] })).toEqual([]);
    expect(kinds({ sessionExits: [{ ...exit, resumed: false }] })).toEqual([]);
    expect(kinds({ sessionExits: [exit], operatorHeldMarks: [{ actionKey: exit.actionKey, kind: "gated", at: "2026-11-02T04:00:00.000Z" }] })).toEqual([]);
  });
});

describe("parity: the classifier and the tick's unchanged-resume detection agree on no-progress", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/recovery-replay/ledger-rows.json", import.meta.url), "utf8")) as RecoveryLedgerRows;
  const exits = fixture.sessionExits!;
  // The tick reads the worktree's cleanliness from Git; a receipt does not record it. The classifier fires when it is absent,
  // so both are fed the tick's value: a verified-clean tree (what `git status --porcelain` returned empty) or a dirty one.
  const tick = (exit: RecoverySessionExitRow, clean: boolean, calls: { n: number } = { n: 0 }) => isUnchangedResumeExit({
    resumed: exit.resumed, outcome: exit.outcome, candidateRevision: exit.candidateRevision,
    startRevision: exit.launchRevision ?? exit.baseRevision, worktreeClean: () => { calls.n += 1; return clean; }
  });
  const classifier = (exit: RecoverySessionExitRow, clean: boolean) =>
    classifyRecoverySignals({ sessionExits: [{ ...exit, worktreeClean: clean }] }).some((signal) => signal.kind === "no_progress");

  it("agrees on every real 2026-11-02 receipt with a clean worktree: exactly the three pin-worker-merge-allowlist-carve-outs exits", () => {
    expect(exits).toHaveLength(16);
    const verdicts = exits.map((exit) => [exit.sessionId, tick(exit, true), classifier(exit, true)] as const);
    for (const [id, fromTick, fromClassifier] of verdicts) expect(fromTick, id).toBe(fromClassifier);
    expect(verdicts.filter(([, fromTick]) => fromTick)).toHaveLength(3);
  });
  it("agrees on the dirty-worktree case: neither reports no-progress for any receipt", () => {
    for (const exit of exits) {
      expect(tick(exit, false), exit.sessionId).toBe(false);
      expect(classifier(exit, false), exit.sessionId).toBe(false);
    }
    const unchanged = exits.find((exit) => tick(exit, true))!;
    expect([tick(unchanged, true), tick(unchanged, false), classifier(unchanged, true), classifier(unchanged, false)]).toEqual([true, false, true, false]);
  });
  it("asks Git for cleanliness only once the other conditions hold, and the classifier fires when it is absent (the one place they differ)", () => {
    const unchanged = exits.find((exit) => tick(exit, true))!;
    const calls = { n: 0 };
    for (const exit of exits.filter((e) => e !== unchanged)) tick(exit, true, calls);
    expect(calls.n).toBeLessThanOrEqual(exits.filter((e) => e.resumed && e.outcome === "incomplete_resumable").length);
    const { worktreeClean: _recorded, ...absent } = unchanged;
    expect(classifyRecoverySignals({ sessionExits: [absent] }).map((signal) => signal.kind)).toEqual(["no_progress"]);
  });
});

describe("a resumed Session exiting incomplete with its candidate unchanged", () => {
  let world: FastRehearsal;
  let afterFirstExit: number;
  beforeAll(() => {
    expect(MAX).toBe(2);
    world = newWorld("no-progress-alert");
    const resumed = firstSessionDies(world);
    afterFirstExit = alertsOf(world).length;
    world.execute(resumed, ACTION_1, "exits-without-completing");
    world.ticks(2);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("raises nothing at the fresh first Session's incomplete exit", () => {
    expect(afterFirstExit).toBe(0);
  });
  it("raises one open notify-only alert of the new trigger on the Action, and queues one notification", () => {
    expect(alertsOf(world).map((alert) => [alert.trigger, alert.actionKey])).toEqual([["resume_no_progress", world.actionKey(ACTION_1)]]);
    expect(noticesOf(world)).toHaveLength(1);
    expect(noticesOf(world)[0].requestId).toBe(alertsOf(world)[0].requestId);
    expect(alertsOf(world)[0].detail).toMatch(/Notice only, nothing to press/);
    expect(alertsOf(world)[0].detail).not.toMatch(/reset-repair-budget/);
  });
  it("is the existing detection's doing: the repair attempt was spent by the same receipt", () => {
    expect(attempts(world)).toBe(1);
  });
});

describe("no alert for a resumed Session that changed its candidate", () => {
  let world: FastRehearsal;
  beforeAll(() => {
    world = newWorld("no-progress-changed-candidate");
    const resumed = firstSessionDies(world);
    world.execute(resumed, ACTION_1, "interrupted-after-work-commit", moreWork);
    world.ticks(3);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);
  it("raises none and queues none", () => {
    expect(alertsOf(world)).toEqual([]);
    expect(noticesOf(world)).toEqual([]);
    expect(attempts(world)).toBe(0);
  });
});

describe("no alert for a fresh first Session that exits without changes", () => {
  let world: FastRehearsal;
  beforeAll(() => {
    world = newWorld("no-progress-fresh-session");
    const first = world.untilLaunched(ACTION_1, 3);
    world.execute(first.launch, ACTION_1, "exits-without-completing");
    world.ticks(2);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);
  it("raises none and queues none", () => {
    expect(alertsOf(world)).toEqual([]);
    expect(noticesOf(world)).toEqual([]);
  });
});

describe("no alert for an Action in an operator-held state", () => {
  for (const kind of ["review_repair_gated", "review_repair_rounds_exhausted", "operator_gate_pending"]) {
    it(`raises none when the Action holds a ${kind} escalation`, () => {
      const world = newWorld(`no-progress-held-${kind}`);
      const resumed = firstSessionDies(world);
      withDatabase(world.workspace, (db) => db.prepare(
        `INSERT OR REPLACE INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES (?, ?, 'held', 'r', 'x', 'x')`
      ).run(world.actionKey(ACTION_1), kind));
      world.execute(resumed, ACTION_1, "exits-without-completing");
      world.ticks(2);
      expect(alertsOf(world)).toEqual([]);
      expect(noticesOf(world)).toEqual([]);
      expect(attempts(world)).toBe(1);
      world.finish();
    }, SCENARIO_TIMEOUT_MS);
  }
});

describe("the notice clears when the stall ends", () => {
  it("clears when a later resumed Session changes the candidate", () => {
    const world = newWorld("no-progress-clears-on-progress");
    const resumed = firstSessionDies(world);
    world.execute(resumed, ACTION_1, "exits-without-completing");
    const again = world.untilLaunched(ACTION_1, 6).launch;
    expect(alertsOf(world)).toHaveLength(1);
    world.execute(again, ACTION_1, "interrupted-after-work-commit", moreWork);
    world.ticks(2);
    expect(alertsOf(world)).toEqual([]);
    expect(noticesOf(world)).toHaveLength(1);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("clears when the operator resets the repair budget", () => {
    const world = newWorld("no-progress-clears-on-reset");
    const resumed = firstSessionDies(world);
    world.execute(resumed, ACTION_1, "exits-without-completing");
    world.ticks(1);
    expect(alertsOf(world)).toHaveLength(1);
    withDatabase(world.workspace, (db) => db.prepare("DELETE FROM production_repair_attempts WHERE action_key = ?").run(world.actionKey(ACTION_1)));
    world.ticks(1);
    expect(alertsOf(world)).toEqual([]);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);
});

describe("held state is read before the exit spends the last repair attempt", () => {
  it("raises none when that exit's budget escalation overwrites the held row", () => {
    const world = newWorld("no-progress-held-then-budget");
    const resumed = firstSessionDies(world);
    const key = world.actionKey(ACTION_1);
    withDatabase(world.workspace, (db) => {
      db.prepare("INSERT INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at) VALUES (?, ?, 'earlier', 'x', 'x')").run(key, MAX - 1);
      db.prepare("INSERT OR REPLACE INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES (?, 'review_repair_gated', 'held', 'r', 'x', 'x')").run(key);
    });
    world.execute(resumed, ACTION_1, "exits-without-completing");
    world.ticks(2);
    expect(attempts(world)).toBe(MAX);
    expect(world.escalations().map((e) => e.kind)).toEqual(["repair_budget_exhausted"]); // the held row was overwritten by the spent budget
    expect(alertsOf(world)).toEqual([]);
    expect(noticesOf(world)).toEqual([]);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);
});

describe("the notice clears when its Action is done", () => {
  it("clears although its repair attempts remain", () => {
    const world = newWorld("no-progress-clears-when-done");
    const resumed = firstSessionDies(world);
    world.execute(resumed, ACTION_1, "exits-without-completing");
    world.ticks(1);
    expect(alertsOf(world)).toHaveLength(1);
    expect(attempts(world)).toBe(1);
    const planFile = path.join(world.repo, "docs/plans/two-action-rehearsal-bootstrap.md");
    const plan = readFileSync(planFile, "utf8");
    const marked = plan.split("  - id: ").map((block) => block.startsWith(`${ACTION_1}\n`) ? block.replace(/\n(\s+)status: \S+/, "\n$1status: done") : block).join("  - id: ");
    expect(marked).not.toBe(plan);
    writeFileSync(planFile, marked);
    world.ticks(1);
    expect(attempts(world)).toBe(1);
    expect(alertsOf(world)).toEqual([]);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);
});

describe("the alert is notify-only: the run is identical with and without it", () => {
  const run = (breakRaising: boolean) => {
    const world = newWorld(breakRaising ? "no-progress-without-alert" : "no-progress-with-alert", breakRaising);
    let launch = firstSessionDies(world);
    for (let resume = 1; resume <= MAX; resume += 1) {
      world.execute(launch, ACTION_1, "exits-without-completing");
      if (resume < MAX) launch = world.untilLaunched(ACTION_1, 6).launch;
    }
    world.ticks(3);
    world.advanceClock(3 * 3_600_000);
    world.ticks(3);
    const result = { observed: observed(world), worldKey: world.actionKey(ACTION_1), alerts: alertsOf(world).length, failures: world.log.filter((line) => line.includes("Red alert resume no progress failed (ignored)")) };
    world.finish();
    return result;
  };
  it("gives the same repair attempts, launch decisions, Action status and blockers; a raise failure is logged and changes nothing", () => {
    const withAlert = run(false);
    const worldKey = withAlert.worldKey;
    const without = run(true);
    expect(withAlert.alerts).toBe(1);
    expect(without.alerts).toBe(0);
    expect(without.failures.length).toBeGreaterThanOrEqual(1);
    expect(without.failures[0]).toContain("injected raise failure");
    expect(withAlert.failures).toEqual([]);
    expect(without.observed).toEqual(withAlert.observed);
    // The existing retry budget alone stopped it.
    expect(withAlert.observed.attempts).toBe(MAX);
    expect(JSON.stringify(withAlert.observed.escalations)).toContain("repair_budget_exhausted");
    // Observers never touch the budget escalation's text: its remedy is exactly the one the budget recorded.
    expect((withAlert.observed.escalations as Array<{ remedy: string }>)[0].remedy).toBe(`Repair the underlying problem, then run \`arcadia production reset-repair-budget ${worldKey}\`.`);
    expect(withAlert.observed.launches).toBe(1 + MAX);
  }, 2 * SCENARIO_TIMEOUT_MS);
});
