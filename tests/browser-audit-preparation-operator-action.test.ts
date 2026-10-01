import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

function fixture(mode: string) {
  const root = mkdtempSync(path.join(tmpdir(), "audit-preparation-button-"));
  try {
    return spawnSync("python3", [path.resolve("tests/fixtures/browserAuditPreparationApproval.py"), root, path.resolve("artifacts/generated/operator-scripts"), mode], { encoding: "utf8", timeout: 5000 });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
describe("exact preparation answer button (all subprocesses intercepted)", () => {
  it("records and publishes only the exact offered answer", () => {
    const result = fixture("fresh");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("inactive preparation only; no activation or merge");
  });
  it("recovers a publication failure without approving again", () => {
    const result = fixture("retry");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"approved_head": "after"');
  });
  for (const [mode, refusal] of [["changed", "exact original open proposal"], ["expired", "contract expired"], ["ci-failed", "CI is not green"]]) {
    it(`refuses ${mode} before answer or publication`, () => {
      const result = fixture(mode);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(refusal);
      expect(result.stdout).not.toContain('"approved_head"');
    });
  }
});
