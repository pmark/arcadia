import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOperatorScriptReceipt } from "./operatorScriptReceipt";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("Dashboard durable operator receipts", () => {
  it("renders a machine-readable refusal and publication recovery without interpreting logs", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-receipt-reader-")); roots.push(root);
    mkdirSync(path.join(root, "runs/receipts"), { recursive: true });
    const receipt = { schema: "arcadia-plan-amendment-receipt-v1", id: "example", status: "failed", reason: "PUBLICATION_FAILED", message: "Settlement is committed locally.", next: "Restore origin and retry this same action; no second settlement.", runDirectory: "runs/example", settlement: { applied: true, documentsCommit: "exact-commit" } };
    writeFileSync(path.join(root, "runs/receipts/example.json"), JSON.stringify(receipt));
    expect(await loadOperatorScriptReceipt(root, "example")).toEqual(receipt);
    expect(await loadOperatorScriptReceipt(root, "missing")).toBeNull();
    await expect(loadOperatorScriptReceipt(root, "../escape")).rejects.toThrow("Invalid operator action id");
    writeFileSync(path.join(root, "runs/receipts/example.json"), JSON.stringify({ ...receipt, id: "different" }));
    await expect(loadOperatorScriptReceipt(root, "example")).rejects.toThrow("Invalid durable");
  });
});
