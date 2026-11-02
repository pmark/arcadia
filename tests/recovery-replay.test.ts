import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyRecoverySignals,
  type RecoveryLedgerRows,
  type RecoveryReviewRepairRow,
  type RecoverySessionExitRow
} from "../src/production/recoverySignals.js";

// Real rows of 2026-11-02 from the martianrover ledger; see `provenance` in the fixture.
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

describe("recovery signal replay of 2026-11-02 ledger rows", () => {
  const signals = classifyRecoverySignals(rows);

  it("raises no-progress at the 04:44:50Z receipt for pin-worker-merge-allowlist-carve-outs", () => {
    const found = signals.filter(forAction("pin-worker-merge-allowlist-carve-outs"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "no_progress", at: "2026-11-02T04:44:50.866Z" });
  });

  it("raises QA plan signals for pin-blast-radius-safety-patterns: mixed at 07:11:19Z, sole failure at 07:26", () => {
    const found = signals.filter(forAction("pin-blast-radius-safety-patterns"));
    expect(found.map((s) => [s.kind, s.failureClass, s.at.slice(0, 19)])).toEqual([
      ["qa_plan", "mixed", "2026-11-02T07:11:19"],
      ["qa_plan", "sole_failure", "2026-11-02T07:26:46"]
    ]);
  });

  it("raises no signal for bound-guidance-test-teardown-retries (one failed review, one repair, merged)", () => {
    expect(signals.filter(forAction("bound-guidance-test-teardown-retries"))).toEqual([]);
  });

  it("raises no signal for the gated wait on cover-retired-descriptor-byte-change", () => {
    expect(rows.operatorHeldMarks).toHaveLength(1);
    expect(signals.filter(forAction("cover-retired-descriptor-byte-change"))).toEqual([]);
  });

  it("returns signals in time order and does not mutate its input", () => {
    const before = JSON.stringify(rows);
    const ordered = classifyRecoverySignals(rows);
    expect(ordered.map((s) => s.at)).toEqual([...ordered.map((s) => s.at)].sort());
    expect(ordered).toHaveLength(3);
    expect(JSON.stringify(rows)).toBe(before);
  });

  describe("sensitivity to altered rows", () => {
    it("a changed candidate revision yields no no-progress signal", () => {
      const altered = clone(rows);
      const exit = altered.sessionExits!.find((r) => r.at === "2026-11-02T04:44:50.866Z") as RecoverySessionExitRow;
      exit.candidateRevision = "ffffffffffffffffffffffffffffffffffffffff";
      expect(classifyRecoverySignals(altered).filter((s) => s.kind === "no_progress")).toEqual([]);
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
      repair.failedChecks = [
        ...repair.failedChecks,
        { criterion: "tests-and-evidence", name: "Tests and evidence", status: "fail" }
      ];
      const qa = classifyRecoverySignals(altered).filter((s) => s.at.startsWith("2026-11-02T07:26"));
      expect(qa.map((s) => s.failureClass)).toEqual(["mixed"]);
    });
  });
});
