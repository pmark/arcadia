import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateSessionLedger, validateSessionLedgerRow } from "../src/reports/sessionLedger.js";

const ledger = readFileSync(path.resolve(import.meta.dirname, "../docs/reports/session-ledger.jsonl"), "utf8");
const row = () => JSON.parse(ledger.split("\n")[0]) as Record<string, unknown>;
const requiredBackfills = [
  "2026-10-12-driver-a12",
  "2026-10-12-driver-a3",
  "2026-10-12-driver-a5",
  "2026-10-12-driver-a6"
] as const;
const ledgerRows = (text: string) => text.split("\n").filter(line => line.trim() !== "")
  .map(line => JSON.parse(line) as Record<string, unknown>);

function assertLedgerWithBackfills(text: string): void {
  expect(validateSessionLedger(text)).toEqual([]);
  const rows = ledgerRows(text);
  for (const sessionId of requiredBackfills) {
    expect(rows.filter(entry => entry.session_id === sessionId), `required backfill ${sessionId}`)
      .toHaveLength(1);
  }
}


describe("session ledger validator", () => {
  it("validates the growing ledger and preserves four backfills", () => {
    assertLedgerWithBackfills(ledger);
  });
  it("accepts an additional valid Session row", () => {
    const added = { ...row(), session_id: "test-only-growing-ledger-row" };
    assertLedgerWithBackfills(`${ledger.trimEnd()}\n${JSON.stringify(added)}\n`);
  });
  it.each(requiredBackfills)("refuses a missing required backfill %s", sessionId => {
    const withoutBackfill = ledgerRows(ledger).filter(entry => entry.session_id !== sessionId)
      .map(entry => JSON.stringify(entry)).join("\n");
    // Schema validity alone does not preserve the required historical evidence.
    expect(validateSessionLedger(withoutBackfill)).toEqual([]);
    expect(() => assertLedgerWithBackfills(withoutBackfill)).toThrow(`required backfill ${sessionId}`);
  });
  it.each(requiredBackfills)("globally rejects an appended duplicate backfill %s", sessionId => {
    const backfill = ledgerRows(ledger).find(entry => entry.session_id === sessionId);
    const duplicate = `${ledger.trimEnd()}\n${JSON.stringify(backfill)}\n`;
    expect(validateSessionLedger(duplicate).join()).toContain(`duplicate session_id ${sessionId}`);
    expect(() => assertLedgerWithBackfills(duplicate)).toThrow();
  });
  it("rejects a missing field", () => {
    const { wall_min: _drop, ...rest } = row();
    expect(validateSessionLedgerRow(rest)).toContain("missing field wall_min");
  });
  it("rejects a mistyped field", () => {
    expect(validateSessionLedgerRow({ ...row(), attempts: "1" })).toContain("field attempts must be a non-negative integer");
  });
  it("rejects fractional attempts", () => {
    expect(validateSessionLedgerRow({ ...row(), attempts: 1.5 })).toContain("field attempts must be a non-negative integer");
  });
  it("rejects an unknown extra key", () => {
    expect(validateSessionLedgerRow({ ...row(), extra: 1 })).toContain("unknown field extra");
  });
  it("rejects a duplicate session_id", () => {
    const line = ledger.split("\n")[0];
    expect(validateSessionLedger(`${line}\n${line}\n`).join()).toContain("duplicate session_id");
  });
  it("tolerates blank and CRLF lines", () => {
    const line = ledger.split("\n")[0];
    expect(validateSessionLedger(`\r\n${line}\r\n\r\n`)).toEqual([]);
  });
  it("limits notes to 200 characters", () => {
    expect(validateSessionLedgerRow({ ...row(), notes: "x".repeat(201) }).join()).toContain("notes");
  });
  it("rejects an unknown role", () => {
    expect(validateSessionLedgerRow({ ...row(), role: "observer" }).join()).toContain("field role must be one of");
  });
  it("rejects stopped without a stop_reason", () => {
    expect(validateSessionLedgerRow({ ...row(), outcome: "stopped" })).toContain("outcome stopped requires a stop_reason");
    expect(validateSessionLedgerRow({ ...row(), outcome: "stopped", stop_reason: "token ceiling" })).toEqual([]);
  });
});
