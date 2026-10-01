import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

function retry(mode: string) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-button-retry-"));
  const activeAsk = path.resolve(".arcadia/asks/agent-ask-propose-bounded-host-browser-audit-847-2026-10-01.yaml");
  const ask = existsSync(activeAsk) ? activeAsk : path.resolve(".arcadia/asks/archive/agent-ask-propose-bounded-host-browser-audit-847-2026-10-01.yaml");
  try {
    return spawnSync("python3", [
      path.resolve("tests/fixtures/browserAuditOperatorRetry.py"),
      root, path.resolve("artifacts/generated/operator-scripts"),
      ask, mode
    ], { encoding: "utf8" });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("browser-audit Decision button publication recovery", () => {
  it("replays an applied receipt without its preview-only review list", () => {
    const result = retry("applied");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("published exact receipt");
  });
  it("refuses a Decision whose state changed after settlement", () => {
    const result = retry("changed");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Decision state changed");
    expect(result.stdout).not.toContain("published exact receipt");
  });
  it("refuses unrelated local history before publishing", () => {
    const result = retry("unrelated");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unrelated history");
    expect(result.stdout).not.toContain("published exact receipt");
  });
});
