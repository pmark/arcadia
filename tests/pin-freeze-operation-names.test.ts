import { describe, expect, it } from "vitest";
import {
  FREEZE_OPERATIONS,
  freezeReceiptLines,
  isFreezeOperation,
  type RehearsalFreezeDecision
} from "../src/production/freezeWindow.js";

function decision(extra: Pick<RehearsalFreezeDecision, "warning" | "note">): RehearsalFreezeDecision {
  return {
    operation: "services.stop",
    workspace: null,
    state: "no_workspace",
    policyRevision: null,
    policyEpoch: null,
    observedAt: "2026-11-25T00:00:00.000Z",
    checked: [],
    decision: "allowed",
    ...extra
  };
}

describe("freeze operation names", () => {
  it("pins the guarded operations", () => {
    expect([...FREEZE_OPERATIONS]).toEqual(["go-broker.install", "go-broker.ensure", "services.restart", "services.stop"]);
    for (const operation of FREEZE_OPERATIONS) expect(isFreezeOperation(operation)).toBe(true);
    for (const other of ["go-broker.status", "services.start", "Services.Restart", ""]) {
      expect(isFreezeOperation(other)).toBe(false);
    }
  });
});

describe("freezeReceiptLines", () => {
  it("returns the warning then the note, skipping empty lines", () => {
    expect(freezeReceiptLines(decision({ warning: "warn", note: "note" }))).toEqual(["warn", "note"]);
    expect(freezeReceiptLines(decision({ note: "note" }))).toEqual(["note"]);
    expect(freezeReceiptLines(decision({ warning: "", note: undefined }))).toEqual([]);
    expect(freezeReceiptLines(decision({}))).toEqual([]);
  });
});
