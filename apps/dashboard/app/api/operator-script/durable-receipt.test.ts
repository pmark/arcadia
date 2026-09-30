import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("Operator endpoint projects shared runner receipts", () => {
  it("shows the canonical receipt and refuses a completed one-shot without any dashboard launcher state", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-receipt-endpoint-")); roots.push(root);
    mkdirSync(path.join(root, "runs/receipts"), { recursive: true });
    writeFileSync(path.join(root, "example.sh"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    const descriptor = { schema: "arcadia-operator-script-v1", id: "example", script: "example.sh", title: "Example", problem: "Example problem", desired_effect: "Example effect", authority: { does: ["One action"], never_does: ["Broaden scope"] }, success: { effect: "Done", next: "Keep receipt" }, failure: { effect: "Refused", next: "Retry exact action" }, repeatable: false };
    writeFileSync(path.join(root, "example.json"), JSON.stringify(descriptor));
    const receipt = { schema: "arcadia-plan-amendment-receipt-v1", id: "example", status: "succeeded", reason: "SETTLED_AND_PUBLISHED", message: "The exact amendment was published.", next: "Keep the receipt.", runDirectory: "runs/example", settlement: { applied: true, documentsCommit: "exact" } };
    writeFileSync(path.join(root, "runs/receipts/example.json"), JSON.stringify(receipt));
    vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_LIBRARY", root); vi.resetModules();
    const { GET, POST } = await import("./route");
    const listing = await (await GET()).json() as { scripts: { state: { status: string }; receipt: unknown }[] };
    expect(listing.scripts[0].state.status).toBe("succeeded");
    expect(listing.scripts[0].receipt).toEqual(receipt);
    const response = await POST(new Request("http://arcadia.test/api/operator-script", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ id: "example" }) }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("already completed") });
  });
});
