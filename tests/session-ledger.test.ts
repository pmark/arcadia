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
] as const;
const ledgerRows = (text: string) => text.split("\n").filter(line => line.trim() !== "")
  .map(line => JSON.parse(line) as Record<string, unknown>);

function assertLedgerWithBackfills(text: string): void {
  expect(validateSessionLedger(text)).toEqual([]);
  const rows = ledgerRows(text);
  for (const sessionId of BACKFILLED_SESSION_IDS) {
    const required = rows.filter(entry => entry.session_id === sessionId);
    expect(required, `required backfill ${sessionId}`).toHaveLength(1);
    expect(required[0], `required backfilled Session ${sessionId} is missing`).toBeDefined();
    expect(validateSessionLedgerRow(required[0])).toEqual([]);
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
  it.each(BACKFILLED_SESSION_IDS)("refuses a missing required backfill %s", sessionId => {
    const withoutBackfill = ledgerRows(ledger).filter(entry => entry.session_id !== sessionId)
      .map(entry => JSON.stringify(entry)).join("\n");
    // Schema validity alone does not preserve the required historical evidence.
    expect(validateSessionLedger(withoutBackfill)).toEqual([]);
    expect(() => assertLedgerWithBackfills(withoutBackfill)).toThrow(`required backfill ${sessionId}`);
  });
  it.each(BACKFILLED_SESSION_IDS)("globally rejects an appended duplicate backfill %s", sessionId => {
    const backfill = ledgerRows(ledger).find(entry => entry.session_id === sessionId);
    const duplicate = `${ledger.trimEnd()}\n${JSON.stringify(backfill)}\n`;
    expect(validateSessionLedger(duplicate).join()).toContain(`duplicate session_id ${sessionId}`);
    expect(() => assertLedgerWithBackfills(duplicate)).toThrow();
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
  it("preserves exact review linkage and separate configured/effective effort", () => {
    expect(validateSessionLedgerRow({
      ...row(),
      configured_effort: "e2_standard",
      effective_effort: "medium",
      effort_source: "runtime launch receipt",
      review_attempt_request_id: "code-review-request-1",
      resource_scope: "lineage-additional",
      candidate_head: "a".repeat(40),
      evidence_source: "artifacts/session/result.json",
      task_class: "typescript-cli",
      difficulty: "medium"
    })).toEqual([]);
  });
  it("requires linked resource scope so totals cannot double count reviewer usage", () => {
    expect(validateSessionLedgerRow({ ...row(), review_attempt_request_id: "code-review-request-1" }))
      .toContain("review_attempt_request_id requires resource_scope to prevent double counting");
  });
  it("rejects stopped without a stop_reason", () => {
    expect(validateSessionLedgerRow({ ...row(), outcome: "stopped" })).toContain("outcome stopped requires a stop_reason");
    expect(validateSessionLedgerRow({ ...row(), outcome: "stopped", stop_reason: "token ceiling" })).toEqual([]);
  });
});
