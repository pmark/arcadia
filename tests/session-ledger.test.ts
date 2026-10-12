import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateSessionLedger, validateSessionLedgerRow } from "../src/reports/sessionLedger.js";

const ledger = readFileSync(path.resolve(import.meta.dirname, "../docs/reports/session-ledger.jsonl"), "utf8");
const row = () => JSON.parse(ledger.split("\n")[0]) as Record<string, unknown>;
const BACKFILLED_SESSION_IDS = [
  "2026-10-12-driver-a12",
  "2026-10-12-driver-a3",
  "2026-10-12-driver-a5",
  "2026-10-12-driver-a6"
];

describe("session ledger validator", () => {
  it("accepts the required backfilled rows and validates the entire append-only ledger", () => {
    const rows = ledger.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const byId = new Map(rows.map((entry) => [entry.session_id, entry]));
    for (const sessionId of BACKFILLED_SESSION_IDS) {
      const required = byId.get(sessionId);
      expect(required, `required backfilled Session ${sessionId} is missing`).toBeDefined();
      expect(validateSessionLedgerRow(required)).toEqual([]);
    }
    expect(validateSessionLedger(ledger)).toEqual([]);
  });
  it("accepts a valid unique Session row appended to the ledger", () => {
    const appended = { ...row(), session_id: "2026-10-12-test-appended-session" };
    expect(validateSessionLedger(`${ledger.trim()}\n${JSON.stringify(appended)}\n`)).toEqual([]);
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
