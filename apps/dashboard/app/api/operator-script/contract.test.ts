import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("Operator endpoint refuses runner bypasses before launch", () => {
  it("returns a named refusal without starting a bespoke Plan-amendment script", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "arcadia-operator-contract-")); roots.push(dir);
    const d = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../artifacts/generated/operator-scripts/accept-close-ask-traceability-scope-2026-09-30.json"), "utf8")) as { id: string; script: string };
    d.id = "future-amendment"; d.script = "future-amendment.sh";
    writeFileSync(path.join(dir, d.id + ".json"), JSON.stringify(d));
    const marker = path.join(dir, "launched");
    writeFileSync(path.join(dir, d.script), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", dir); vi.resetModules();
    const { POST } = await import("./route");
    const response = await POST(new Request("http://arcadia.test/api/operator-script", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ id: d.id }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "PLAN_AMENDMENT_RUNNER_REQUIRED", next: expect.stringContaining("check:operator-scripts") });
    expect(existsSync(marker)).toBe(false); expect(existsSync(path.join(dir, "runs/state"))).toBe(false);
  });
});
