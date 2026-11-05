import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyRecoverySignals,
  isNoProgressExit,
  type RecoveryLedgerRows,
  type RecoveryReviewRepairRow,
  type RecoverySessionExitRow
} from "../src/production/recoverySignals.js";

// Every real non-simulated receipt and review repair of 2026-11-02 from the
// martianrover ledger; see `provenance` in the fixture.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/recovery-replay/ledger-rows.json", import.meta.url), "utf8")
) as RecoveryLedgerRows & { provenance: unknown };
const rows: RecoveryLedgerRows = {
  sessionExits: fixture.sessionExits,
  reviewRepairs: fixture.reviewRepairs,
  operatorHeldMarks: fixture.operatorHeldMarks
};

const forAction = (slug: string) => (signal: { actionKey: string }) => signal.actionKey === `arcadia/${slug}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const exitRow = (over: Partial<RecoverySessionExitRow> = {}): RecoverySessionExitRow => ({
  sessionId: "session_x", actionKey: "arcadia/x", outcome: "incomplete_resumable", resumed: true,
  baseRevision: "base", launchRevision: "aaa", candidateRevision: "aaa", at: "2026-11-02T10:00:00.000Z", ...over
});
const repairRow = (over: Partial<RecoveryReviewRepairRow> = {}): RecoveryReviewRepairRow => ({
  requestId: "req_x", actionKey: "arcadia/x", round: 1, role: "qa", verdict: "fail", outcome: "launched",
  failedChecks: [{ criterion: "operator-qa-plan", status: "fail" }], at: "2026-11-02T10:00:00.000Z", ...over
});

describe("recovery signal replay of 2026-11-02 ledger rows", () => {
  const signals = classifyRecoverySignals(rows);

  it("replays every row of the day into exactly the expected ordered signals", () => {
    expect(rows.sessionExits).toHaveLength(16);
    expect(rows.reviewRepairs).toHaveLength(7);
    expect(signals.map((s) => [s.kind, s.failureClass ?? null, s.actionKey.slice(8), s.at.slice(11, 19)])).toEqual([
      ["no_progress", null, "pin-worker-merge-allowlist-carve-outs", "04:44:50"],
      ["no_progress", null, "pin-worker-merge-allowlist-carve-outs", "04:52:40"],
      ["no_progress", null, "pin-worker-merge-allowlist-carve-outs", "04:55:14"],
      ["qa_plan", "mixed", "pin-blast-radius-safety-patterns", "07:11:19"],
      ["qa_plan", "sole_failure", "pin-blast-radius-safety-patterns", "07:26:46"],
      ["qa_plan", "sole_failure", "pin-blast-radius-safety-patterns", "07:42:16"],
      ["qa_plan", "sole_failure", "pin-blast-radius-safety-patterns", "07:58:37"]
    ]);
  });

  it("raises no-progress at the 04:44:50Z receipt for pin-worker-merge-allowlist-carve-outs", () => {
    const found = signals.filter((s) => forAction("pin-worker-merge-allowlist-carve-outs")(s) && s.at.startsWith("2026-11-02T04:44:50"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "no_progress" });
  });

  it("raises QA plan signals for pin-blast-radius-safety-patterns: mixed at 07:11:19Z, sole failure at 07:26", () => {
    const found = signals.filter(forAction("pin-blast-radius-safety-patterns"));
    expect(found.slice(0, 2).map((s) => [s.failureClass, s.at.slice(0, 19)])).toEqual([
      ["mixed", "2026-11-02T07:11:19"],
      ["sole_failure", "2026-11-02T07:26:46"]
    ]);
  });

  it("raises no signal for bound-guidance-test-teardown-retries (one failed review, one repair, merged)", () => {
    expect(signals.filter(forAction("bound-guidance-test-teardown-retries"))).toEqual([]);
  });

  it("raises no signal for the gated wait on cover-retired-descriptor-byte-change", () => {
    expect(rows.operatorHeldMarks).toHaveLength(1);
    expect(signals.filter(forAction("cover-retired-descriptor-byte-change"))).toEqual([]);
  });

  it("raises no signal for the healthy assert-tmux-temp-launcher-removed rows", () => {
    expect(signals.filter(forAction("assert-tmux-temp-launcher-removed"))).toEqual([]);
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(rows);
    classifyRecoverySignals(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });

  describe("sensitivity to altered rows", () => {
    it("a changed candidate revision yields no no-progress signal", () => {
      const altered = clone(rows);
      const exit = altered.sessionExits!.find((r) => r.at === "2026-11-02T04:44:50.866Z") as RecoverySessionExitRow;
      exit.candidateRevision = "ffffffffffffffffffffffffffffffffffffffff";
      expect(classifyRecoverySignals(altered).some((s) => s.at.startsWith("2026-11-02T04:44:50"))).toBe(false);
    });

    it("an operator-held mark yields no signal", () => {
      const altered = clone(rows);
      altered.operatorHeldMarks = [
        { actionKey: "arcadia/pin-worker-merge-allowlist-carve-outs", kind: "gated", at: "2026-11-02T04:44:00.000Z" },
        { actionKey: "arcadia/pin-blast-radius-safety-patterns", kind: "gated", at: "2026-11-02T07:00:00.000Z" }
      ];
      expect(classifyRecoverySignals(altered)).toEqual([]);
    });

    it("an added failed check turns a sole failure into mixed", () => {
      const altered = clone(rows);
      const repair = altered.reviewRepairs!.find((r) => r.at === "2026-11-02T07:26:46.458Z") as RecoveryReviewRepairRow;
      repair.failedChecks = [...repair.failedChecks, { criterion: "tests-and-evidence", name: "Tests", status: "fail" }];
      const qa = classifyRecoverySignals(altered).filter((s) => s.at.startsWith("2026-11-02T07:26"));
      expect(qa.map((s) => s.failureClass)).toEqual(["mixed"]);
    });
  });

  describe("no-progress predicate (same as the tick's unchanged-candidate check)", () => {
    it("a first Session with equal revisions gives no signal", () => {
      expect(classifyRecoverySignals({ sessionExits: [exitRow({ resumed: false })] })).toEqual([]);
    });
    it("falls back to the base revision when there is no launch revision", () => {
      expect(isNoProgressExit(exitRow({ launchRevision: null, baseRevision: "aaa" }))).toBe(true);
      expect(isNoProgressExit(exitRow({ launchRevision: null, baseRevision: "bbb" }))).toBe(false);
    });
    it("an explicit dirty worktree gives no signal; unknown does", () => {
      expect(isNoProgressExit(exitRow({ worktreeClean: false }))).toBe(false);
      expect(isNoProgressExit(exitRow({ worktreeClean: true }))).toBe(true);
      expect(isNoProgressExit(exitRow())).toBe(true);
    });
    it("accepted_completion with equal revisions gives no signal", () => {
      expect(classifyRecoverySignals({ sessionExits: [exitRow({ outcome: "accepted_completion" })] })).toEqual([]);
    });
    it("a missing candidate revision gives no signal", () => {
      expect(isNoProgressExit(exitRow({ candidateRevision: null, launchRevision: null, baseRevision: null }))).toBe(false);
    });
  });

  describe("QA plan classification", () => {
    it("a code-review row carrying operator-qa-plan gives no signal", () => {
      expect(classifyRecoverySignals({ reviewRepairs: [repairRow({ role: "code-review" })] })).toEqual([]);
    });
    it("a not-checked sibling makes the failure mixed, whatever the status", () => {
      for (const status of ["not-checked", "inherited", "not-applicable"]) {
        const out = classifyRecoverySignals({
          reviewRepairs: [repairRow({ failedChecks: [
            { criterion: "operator-qa-plan", status: "fail" }, { criterion: "tests-and-evidence", status }
          ] })]
        });
        expect(out.map((s) => s.failureClass)).toEqual(["mixed"]);
      }
    });
    it("passing siblings do not make it mixed", () => {
      const out = classifyRecoverySignals({
        reviewRepairs: [repairRow({ failedChecks: [
          { criterion: "operator-qa-plan", status: "fail" }, { criterion: "tests-and-evidence", status: "pass" }
        ] })]
      });
      expect(out.map((s) => s.failureClass)).toEqual(["sole_failure"]);
    });
  });

  describe("operator-held marks", () => {
    const mark = { actionKey: "arcadia/x", kind: "gated", at: "2026-11-02T10:00:00.000Z" };
    it("a mark after the signal does not suppress it", () => {
      const out = classifyRecoverySignals({ reviewRepairs: [repairRow()], operatorHeldMarks: [{ ...mark, at: "2026-11-02T10:00:01.000Z" }] });
      expect(out).toHaveLength(1);
    });
    it("a mark stops suppressing at or after its release time", () => {
      const held = { ...mark, at: "2026-11-02T09:00:00.000Z", releasedAt: "2026-11-02T10:00:00.000Z" };
      expect(classifyRecoverySignals({ reviewRepairs: [repairRow({ at: "2026-11-02T09:59:59.000Z" })], operatorHeldMarks: [held] })).toEqual([]);
      expect(classifyRecoverySignals({ reviewRepairs: [repairRow({ at: "2026-11-02T10:00:00.000Z" })], operatorHeldMarks: [held] })).toHaveLength(1);
    });
    it("a mark for another Action does not suppress", () => {
      expect(classifyRecoverySignals({ reviewRepairs: [repairRow()], operatorHeldMarks: [{ ...mark, actionKey: "arcadia/y", at: "2026-11-02T09:00:00.000Z" }] })).toHaveLength(1);
    });
  });

  describe("ordering", () => {
    it("orders by instant, not by string, across UTC offsets", () => {
      // 05:00+02:00 is 03:00Z, earlier than 04:00Z although it sorts later as a string.
      const out = classifyRecoverySignals({
        sessionExits: [exitRow({ sessionId: "late", at: "2026-11-02T04:00:00.000Z" })],
        reviewRepairs: [repairRow({ requestId: "early", at: "2026-11-02T05:00:00.000+02:00" })]
      });
      expect(out.map((s) => s.source)).toEqual(["early", "late"]);
      const instants = out.map((s) => Date.parse(s.at));
      expect(instants).toEqual([...instants].sort((a, b) => a - b));
      expect(out.map((s) => s.at)).not.toEqual([...out.map((s) => s.at)].sort());
    });
    it("keeps the fixture signals in nondecreasing instant order", () => {
      const instants = signals.map((s) => Date.parse(s.at));
      expect(instants).toEqual([...instants].sort((a, b) => a - b));
    });
    it("orders a parseable signal before one with an unparseable time", () => {
      const out = classifyRecoverySignals({
        reviewRepairs: [
          repairRow({ requestId: "unparseable", at: "not-a-time" }),
          repairRow({ requestId: "parseable", at: "2026-11-02T10:00:00.000Z" })
        ]
      });
      expect(out.map((s) => s.source)).toEqual(["parseable", "unparseable"]);
    });
    it("keeps input order for signals whose times are both unparseable", () => {
      const out = classifyRecoverySignals({
        reviewRepairs: [
          repairRow({ requestId: "first", at: "not-a-time" }),
          repairRow({ requestId: "second", at: "also-not-a-time" })
        ]
      });
      expect(out.map((s) => s.source)).toEqual(["first", "second"]);
    });
  });
});
