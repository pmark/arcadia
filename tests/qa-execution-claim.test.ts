import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { withPrReviewExecutionClaim } from "../src/qa/executionClaim.js";
const roots: string[] = [];
const root = () => { const value = mkdtempSync(path.join(os.tmpdir(), "qa-execution-claim-")); roots.push(value); return value; };
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, {recursive: true, force: true}); });
it("excludes concurrent/reentrant execution and releases after normal return", () => {
  const value = root();
  const result = withPrReviewExecutionClaim(value, () => {
    expect(() => withPrReviewExecutionClaim(value, () => { throw new Error("must not run"); })).toThrow("already claimed");
    return 42;
  });
  expect(result).toBe(42);
  expect(existsSync(path.join(value, ".execution-claim"))).toBe(false);
  expect(withPrReviewExecutionClaim(value, () => 43)).toBe(43);
});
it("releases after a bounded reviewer failure but preserves an uncertain inherited owner", () => {
  const value = root();
  expect(() => withPrReviewExecutionClaim(value, () => { throw new Error("reviewer failed"); })).toThrow("reviewer failed");
  expect(existsSync(path.join(value, ".execution-claim"))).toBe(false);
  mkdirSync(path.join(value, ".execution-claim"));
  expect(() => withPrReviewExecutionClaim(value, () => 1)).toThrow("already claimed");
  expect(existsSync(path.join(value, ".execution-claim"))).toBe(true);
});
