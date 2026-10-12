import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateSessionLedger, validateSessionLedgerRow } from "../src/reports/sessionLedger.js";

const ledger = readFileSync(path.resolve(import.meta.dirname, "../docs/reports/session-ledger.jsonl"), "utf8");
const row = () => JSON.parse(ledger.split("\n")[0]) as Record<string, unknown>;

describe("session ledger validator", () => {
  it("accepts the four backfilled rows", () => {
    expect(validateSessionLedger(ledger)).toEqual([]);
    expect(ledger.trim().split("\n")).toHaveLength(4);
  });
  it("rejects a missing field", () => {
    const { wall_min: _drop, ...rest } = row();
    expect(validateSessionLedgerRow(rest)).toContain("missing field wall_min");
  });
  it("rejects a mistyped field", () => {
    expect(validateSessionLedgerRow({ ...row(), attempts: "1" })).toContain("field attempts must be a non-negative number");
  });
  it("rejects an unknown role", () => {
    expect(validateSessionLedgerRow({ ...row(), role: "observer" }).join()).toContain("field role must be one of");
  });
  it("rejects stopped without a stop_reason", () => {
    expect(validateSessionLedgerRow({ ...row(), outcome: "stopped" })).toContain("outcome stopped requires a stop_reason");
    expect(validateSessionLedgerRow({ ...row(), outcome: "stopped", stop_reason: "token ceiling" })).toEqual([]);
  });
});
