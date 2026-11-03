import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { listPendingAgentAskNotifications } from "../src/ask/settlement.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { listOperatorEscalations } from "../src/production/tick.js";
import { classifyRecoverySignals, type RecoveryLedgerRows } from "../src/production/recoverySignals.js";
import { listOpenRedAlerts, RED_ALERT_TRIGGERS, REVIEW_REPAIR_STOP_ALERTS } from "../src/production/redAlerts.js";
import { REVIEW_REPAIR_GATED, REVIEW_REPAIR_ROUNDS_EXHAUSTED } from "../src/production/reviewRepair.js";
import { ensureReviewRepairTable } from "../src/sessions/reviewRepair.js";
import { Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Decision 0169: a `review_repair_rounds_exhausted` or `review_repair_gated`
 * escalation raises one red alert of its own trigger, from the tick reading
 * `production_operator_escalations` (src/production/reviewRepair.ts is
 * untouched). The rows are the real 2026-11-02 ledger rows of
 * tests/recovery-replay.test.ts, replayed into the real worker tick.
 */
const fixture = JSON.parse(readFileSync(new URL("./fixtures/recovery-replay/ledger-rows.json", import.meta.url), "utf8")) as RecoveryLedgerRows;
const repairAt = (at: string) => fixture.reviewRepairs!.find((row) => row.at.startsWith(at))!;
const ESCALATED = repairAt("2026-11-02T07:58:37"); // outcome escalated, QA sole failure
const LAUNCHED = repairAt("2026-11-02T07:42:16"); // outcome launched, the same QA sole failure
const GATED = repairAt("2026-11-02T08:10:09"); // outcome gated, code-review

const rehearsals: Rehearsal[] = [];
afterEach(() => { for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose(); });

function activated(): Rehearsal {
  const rehearsal = new Rehearsal();
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  rehearsal.activate();
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3);
  return rehearsal;
}

/** Record a review repair row and its operator escalation exactly as the repair loop leaves them, from a ledger row. */
function stop(rehearsal: Rehearsal, actionKey: string, row: { requestId: string; round: number; role: string; outcome: string; at: string }, kind: string | null, reason = "fixture", updatedAt = row.at): void {
  withDatabase(rehearsal.workspace, (db) => {
    ensureReviewRepairTable(db);
    db.prepare(
      `INSERT OR REPLACE INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head, start_revision,
         role, verdict, summary, findings_json, failed_checks_json, outcome, reason, created_at, updated_at)
       VALUES (?, ?, 1, ?, 'session_fixture', 'branch', 'head', 'start', ?, 'fail', 'summary', '[]', '[]', ?, ?, ?, ?)`
    ).run(`${row.requestId}-${actionKey}`, actionKey, row.round, row.role, row.outcome, reason, row.at, updatedAt);
    if (kind) {
      db.prepare(
        `INSERT OR REPLACE INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES (?, ?, 'msg', 'remedy', ?, ?)`
      ).run(actionKey, kind, row.at, row.at);
    }
  });
}
const dropEscalation = (rehearsal: Rehearsal, actionKey: string) =>
  withDatabase(rehearsal.workspace, (db) => db.prepare("DELETE FROM production_operator_escalations WHERE action_key = ?").run(actionKey));
const open = (rehearsal: Rehearsal) => withReadOnlyDatabase(rehearsal.workspace, (db) => listOpenRedAlerts(db));
const notices = (rehearsal: Rehearsal) => withDatabase(rehearsal.workspace, (db) => listPendingAgentAskNotifications(db).filter((entry) => entry.requestId?.startsWith("red-alert-")));

describe("the recovery-signal classifier on the replay fixture rows", () => {
  const signals = classifyRecoverySignals(fixture);
  it("reads the escalated 07:58 row as a QA sole failure, no different from the launched row before it: alerts key on outcome", () => {
    const qa = signals.filter((signal) => signal.kind === "qa_plan" && signal.at.startsWith("2026-11-02T07:"));
    expect(qa.filter((signal) => signal.source === ESCALATED.requestId || signal.source === LAUNCHED.requestId).map((signal) => [signal.at.slice(11, 19), signal.failureClass])).toEqual([
      ["07:42:16", "sole_failure"],
      ["07:58:37", "sole_failure"]
    ]);
    expect([LAUNCHED.outcome, ESCALATED.outcome, GATED.outcome]).toEqual(["launched", "escalated", "gated"]);
  });
  it("raises no signal for the gated row (a code-review row: the classifier reads only QA verdicts), which is still a stop the operator must hear about", () => {
    expect(signals.filter((signal) => signal.actionKey === GATED.actionKey)).toEqual([]);
    expect(REVIEW_REPAIR_STOP_ALERTS[REVIEW_REPAIR_GATED]).toEqual({ trigger: "repair_gated", outcome: GATED.outcome });
  });
  it("maps each escalation kind to a registered trigger on the outcome the repair loop writes", () => {
    expect(REVIEW_REPAIR_STOP_ALERTS[REVIEW_REPAIR_ROUNDS_EXHAUSTED]).toEqual({ trigger: "repair_rounds_exhausted", outcome: ESCALATED.outcome });
    for (const { trigger } of Object.values(REVIEW_REPAIR_STOP_ALERTS)) expect(RED_ALERT_TRIGGERS).toContain(trigger);
  });
});

describe("each repair trigger follows the repair row outcome on every fixture row", () => {
  const signals = classifyRecoverySignals(fixture);
  it("raises a stop alert only where the row's outcome is the one its escalation kind stops on, however the classifier reads the verdict", () => {
    const rehearsal = activated();
    const cases = fixture.reviewRepairs!.flatMap((row, index) => Object.entries(REVIEW_REPAIR_STOP_ALERTS).map(([kind, stopAlert]) => ({
      row, kind, key: `${rehearsal.projectSlug}/case-${index}-${stopAlert.trigger}`, expected: row.outcome === stopAlert.outcome ? stopAlert.trigger : null
    })));
    for (const { row, kind, key } of cases) stop(rehearsal, key, row, kind);
    rehearsal.tick();
    const raised = new Map(open(rehearsal).map((alert) => [alert.actionKey, alert.trigger]));
    for (const { key, expected } of cases) expect(raised.get(key) ?? null, key).toBe(expected);
    expect(cases.filter((c) => c.expected).length).toBe(2); // the escalated 07:58 row and the gated 08:10 row
    // The verdicts the classifier reads as a QA sole failure raise no stop alert unless the outcome is escalated.
    const sole = signals.filter((signal) => signal.kind === "qa_plan" && signal.failureClass === "sole_failure");
    expect(sole.map((signal) => signal.at.slice(11, 19))).toEqual(["07:26:46", "07:42:16", "07:58:37"]);
    for (const signal of sole) {
      const row = fixture.reviewRepairs!.find((r) => r.requestId === signal.source)!;
      const triggers = cases.filter((c) => c.row === row && c.expected).map((c) => c.expected);
      expect(triggers, `${row.at} ${row.outcome}`).toEqual(row.outcome === "escalated" ? ["repair_rounds_exhausted"] : []);
    }
  });
});

describe("review repair stops raised by the real tick from escalation rows", () => {
  it("raises one alert of its own trigger per stop, queues one notification each, and never notifies again on later ticks", () => {
    const rehearsal = activated();
    stop(rehearsal, rehearsal.actionA, ESCALATED, REVIEW_REPAIR_ROUNDS_EXHAUSTED);
    stop(rehearsal, rehearsal.actionB, GATED, REVIEW_REPAIR_GATED);
    rehearsal.tick();
    const first = open(rehearsal);
    expect(first.map((alert) => [alert.trigger, alert.actionKey]).sort()).toEqual([
      ["repair_gated", rehearsal.actionB],
      ["repair_rounds_exhausted", rehearsal.actionA]
    ]);
    expect(notices(rehearsal).map((entry) => entry.requestId).sort()).toEqual(first.map((alert) => alert.requestId).sort());
    for (const notice of notices(rehearsal)) expect(notice.desiredResult).toMatch(/RED ALERT \((repair_gated|repair_rounds_exhausted)\)/);

    rehearsal.tick();
    rehearsal.tick();
    const later = open(rehearsal);
    expect(later.map((alert) => alert.id).sort()).toEqual(first.map((alert) => alert.id).sort());
    expect(later.every((alert) => alert.occurrences > 1)).toBe(true);
    expect(notices(rehearsal)).toHaveLength(2);
  });

  it("clears each alert when its escalation clears, leaving the other, and notifies a recurrence as a new episode", () => {
    const rehearsal = activated();
    stop(rehearsal, rehearsal.actionA, ESCALATED, REVIEW_REPAIR_ROUNDS_EXHAUSTED);
    stop(rehearsal, rehearsal.actionB, GATED, REVIEW_REPAIR_GATED);
    rehearsal.tick();
    dropEscalation(rehearsal, rehearsal.actionA);
    rehearsal.tick();
    expect(open(rehearsal).map((alert) => alert.trigger)).toEqual(["repair_gated"]);
    dropEscalation(rehearsal, rehearsal.actionB);
    rehearsal.tick();
    expect(open(rehearsal)).toEqual([]);
    expect(notices(rehearsal)).toHaveLength(2);
    stop(rehearsal, rehearsal.actionA, ESCALATED, REVIEW_REPAIR_ROUNDS_EXHAUSTED);
    rehearsal.tick();
    expect(open(rehearsal)).toHaveLength(1);
    expect(notices(rehearsal)).toHaveLength(3);
  });

  it("keys on the repair outcome: the launched 07:42 row with a stale escalation raises nothing, and a waived head (no repair row, no escalation) raises nothing", () => {
    const rehearsal = activated();
    stop(rehearsal, rehearsal.actionA, LAUNCHED, REVIEW_REPAIR_ROUNDS_EXHAUSTED);
    stop(rehearsal, rehearsal.actionB, GATED, null); // a repair row alone, no escalation
    rehearsal.tick();
    rehearsal.tick();
    expect(open(rehearsal)).toEqual([]);
    expect(notices(rehearsal)).toEqual([]);
  });

  it("keeps the alert while the stop stands even when a later write bumps an older launched row (closeSupersededPullRequests)", () => {
    const rehearsal = activated();
    stop(rehearsal, rehearsal.actionA, LAUNCHED, REVIEW_REPAIR_ROUNDS_EXHAUSTED);
    stop(rehearsal, rehearsal.actionA, ESCALATED, REVIEW_REPAIR_ROUNDS_EXHAUSTED);
    rehearsal.tick();
    expect(open(rehearsal).map((alert) => alert.trigger)).toEqual(["repair_rounds_exhausted"]);
    // The older launched row is written again, so it is now the most recently updated row.
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE production_review_repairs SET updated_at = '2026-11-02T09:00:00.000Z' WHERE outcome = 'launched'").run());
    rehearsal.tick();
    rehearsal.tick();
    expect(open(rehearsal).map((alert) => alert.trigger)).toEqual(["repair_rounds_exhausted"]);
    expect(notices(rehearsal)).toHaveLength(1);
  });

  it("writes a self-contained off-site message: the exact /todo item, no host file path, no URL it cannot make", () => {
    const rehearsal = activated();
    stop(rehearsal, rehearsal.actionB, GATED, REVIEW_REPAIR_GATED);
    rehearsal.tick();
    const text = notices(rehearsal)[0].desiredResult;
    expect(text).toContain(`/todo item escalation:review_repair_gated:${rehearsal.actionB}`);
    expect(text).not.toContain("file://");
    expect(text).not.toContain(rehearsal.workspace);
  });

  it("a healthy tick with no stop raises none, and other escalations raise none", () => {
    const rehearsal = activated();
    withDatabase(rehearsal.workspace, (db) => db.prepare(
      `INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at) VALUES (?, 'awaiting_independent_verdicts', 'm', 'r', 'x', 'x')`
    ).run(rehearsal.actionA));
    rehearsal.tick();
    expect(open(rehearsal)).toEqual([]);
  });

  it("states fixed, bounded text: no finding, reason or Git error is carried into the alert or its notification", () => {
    const rehearsal = activated();
    const noisy = `fatal: ${"x".repeat(5000)} SECRET-STDERR`;
    stop(rehearsal, rehearsal.actionA, GATED, REVIEW_REPAIR_GATED, noisy);
    rehearsal.tick();
    const [alert] = open(rehearsal);
    expect(alert.detail.length).toBeLessThan(500);
    expect(alert.detail).not.toContain("SECRET-STDERR");
    expect(notices(rehearsal)[0].desiredResult).not.toContain("SECRET-STDERR");
    expect(notices(rehearsal)[0].desiredResult.length).toBeLessThan(900);
    expect(alert.detail).not.toMatch(/reset-repair-budget|--rerun/);
  });

  it("a failure to raise is logged and changes nothing: the same ticks give the same outcomes with and without it", () => {
    const run = (breakRaising: boolean) => {
      const rehearsal = activated();
      if (breakRaising) {
        withDatabase(rehearsal.workspace, (db) => db.exec(
          "CREATE TRIGGER inject_red_alert_failure BEFORE INSERT ON production_red_alerts WHEN NEW.trigger IN ('repair_rounds_exhausted', 'repair_gated') BEGIN SELECT RAISE(ABORT, 'injected raise failure'); END;"
        ));
      }
      stop(rehearsal, rehearsal.actionA, ESCALATED, REVIEW_REPAIR_ROUNDS_EXHAUSTED);
      const seeded = withReadOnlyDatabase(rehearsal.workspace, (db) => listOperatorEscalations(db));
      const results = [rehearsal.tick(), rehearsal.tick(), rehearsal.tick()].map((result) => ({
        launch: result.launch && { attempted: result.launch.attempted, outcome: result.launch.outcome, actionKey: result.launch.actionKey },
        reconciled: result.reconciled.length,
        handoff: result.handoff === null
      }));
      const escalations = withReadOnlyDatabase(rehearsal.workspace, (db) => listOperatorEscalations(db));
      const sessions = rehearsal.sessions().map((session) => [session.action_id, session.status]);
      // Observers only read the escalation: the whole seeded row (message, remedy, timestamps) is what the repair loop left.
      expect(escalations).toEqual(seeded);
      return { results, escalations, sessions, alerts: open(rehearsal).length, failures: rehearsal.log.filter((line) => line.includes("Red alert review repair stops failed (ignored)")) };
    };
    const without = run(false);
    const broken = run(true);
    expect(without.alerts).toBe(1);
    expect(broken.alerts).toBe(0);
    expect(broken.failures.length).toBeGreaterThanOrEqual(1);
    expect(broken.failures[0]).toContain("injected raise failure");
    expect(without.failures).toEqual([]);
    expect(broken.results).toEqual(without.results);
    expect(broken.escalations).toEqual(without.escalations);
    expect(broken.sessions).toEqual(without.sessions);
  });
});
