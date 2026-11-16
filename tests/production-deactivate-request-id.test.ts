import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { runProductionDeactivateCommand } from "../src/commands/production.js";
import { ROWAN_OFF_REQUEST } from "../src/operatorActions/startRunDayGrant.js";
import { findTransitionReceipt, readProductionPolicy } from "../src/production/policy.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-deactivate-id-"));
  temporary.push(directory);
  const target = path.join(directory, "workspace");
  initWorkspace(target);
  return target;
}

const SLUG = "plan3-pins-13-15-complete-20261115";

describe("production deactivate request ids", () => {
  it("refuses a request id that begins with punctuation and leaves the policy revision alone", () => {
    const target = workspace();
    const before = withDatabase(target, (db) => readProductionPolicy(db).revision);

    let caught: { code?: string; exitCode?: number; details?: { reason?: string } } | undefined;
    try {
      runProductionDeactivateCommand({ workspace: target, requestId: `.-${SLUG}` });
    } catch (error) {
      caught = error as typeof caught;
    }

    expect(caught?.code).toBe("VALIDATION_ERROR");
    expect(caught?.exitCode).toBe(2);
    expect(caught?.details?.reason).toBe("MALFORMED_REQUEST_ID");
    expect(withDatabase(target, (db) => readProductionPolicy(db).revision)).toBe(before);
    expect(withDatabase(target, (db) => findTransitionReceipt(db, `.-${SLUG}`))).toBeFalsy();
  });

  it("composes Rowan's Off id from --rowan-off, and the day-grant check recognises it", () => {
    const target = workspace();
    runProductionDeactivateCommand({ workspace: target, rowanOff: SLUG });

    const receipt = withDatabase(target, (db) => findTransitionReceipt(db, `rowan-off-${SLUG}`));
    expect(receipt).toBeTruthy();
    expect(ROWAN_OFF_REQUEST.test(`rowan-off-${SLUG}`)).toBe(true);
    // The day-grant fixture ("Rowan's own Off, which does not end the day") exercises the full chain check.
  });

  it("refuses --rowan-off combined with --request-id, or with a malformed slug", () => {
    const target = workspace();
    expect(() => runProductionDeactivateCommand({ workspace: target, rowanOff: SLUG, requestId: "x" })).toThrow(/either/i);
    expect(() => runProductionDeactivateCommand({ workspace: target, rowanOff: ".-x" })).toThrow(/rowan-off/i);
  });

  it("does not match operator-shaped Off ids, which still end the day", () => {
    expect(ROWAN_OFF_REQUEST.test("dashboard-toggle-1-abcd")).toBe(false);
    expect(ROWAN_OFF_REQUEST.test("restore-off-production-20261104T100000Z-1")).toBe(false);
  });
});
