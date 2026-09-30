import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planAmendmentLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
const root = path.resolve(import.meta.dirname, "..");
const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function descriptor(): OperatorScriptDescriptor {
  const d = JSON.parse(readFileSync(path.join(root, "artifacts/generated/operator-scripts/accept-close-ask-traceability-scope-2026-09-30.json"), "utf8")) as OperatorScriptDescriptor;
  d.id = "future-amendment"; d.script = "future-amendment.sh"; return d;
}
describe("Every applicable generated action must use the shared runner", () => {
  it("accepts a new id using the canonical launcher and pinned contract", () => {
    const d = descriptor(); expect(validateOperatorScriptContract(d, d.id, planAmendmentLauncher(d.id))).toBe(d);
  });
  it.each(["#!/bin/sh\narcadia agent-ask settle --apply\n", planAmendmentLauncher("future-amendment") + "echo bespoke\n", planAmendmentLauncher("another-amendment")])("refuses bespoke, appended and cross-wired launchers", script => {
    const d = descriptor(); expect(() => validateOperatorScriptContract(d, d.id, script)).toThrow("exactly the shared runner launcher");
  });
  it("refuses illegal flags and repeatable approval descriptors", () => {
    const d = descriptor(); (d.planAmendment!.settlement as unknown as Record<string, unknown>).responsibility = "agent";
    expect(() => validateOperatorScriptContract(d, d.id, planAmendmentLauncher(d.id))).toThrow("unsupported or missing fields");
    const repeatable = descriptor(); repeatable.repeatable = true;
    expect(() => validateOperatorScriptContract(repeatable, repeatable.id, planAmendmentLauncher(repeatable.id))).toThrow("one-shot");
  });
  it("refuses an undeclared direct settlement and an amendment mislabeled as generic", () => {
    const d = descriptor(); delete d.planAmendment;
    expect(() => validateOperatorScriptContract(d, d.id, "agent-ask settle")).toThrow("must declare");
    d.agentAsk = { proposal: "another-proposal", intent: "plan", targetRef: "plan/existing" };
    expect(() => validateOperatorScriptContract(d, d.id, "agent-ask settle")).toThrow("require planAmendment");
  });
  it("keeps declared draft-Plan creation and unrelated operator actions valid", () => {
    const d = descriptor(); delete d.planAmendment;
    d.agentAsk = { proposal: "create-plan", intent: "plan", targetRef: null };
    expect(() => validateOperatorScriptContract(d, d.id, "agent-ask settle")).not.toThrow();
    delete d.agentAsk; expect(() => validateOperatorScriptContract(d, d.id, "#!/bin/sh\nexit 0\n")).not.toThrow();
  });
  it("checks the entire real library without executing any action", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "scripts/check-operator-scripts.ts")], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ failures: 0 });
  });
  it("fails CI for an arbitrary future entry with an extra executable command", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "arcadia-library-check-")); roots.push(dir);
    const d = descriptor(); writeFileSync(path.join(dir, d.id + ".json"), JSON.stringify(d));
    writeFileSync(path.join(dir, d.script), planAmendmentLauncher(d.id) + "exit 99\n", { mode: 0o755 });
    const result = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "scripts/check-operator-scripts.ts"), dir], { encoding: "utf8" });
    expect(result.status).toBe(1); expect(JSON.parse(result.stderr)).toMatchObject({ id: d.id, reason: "PLAN_AMENDMENT_RUNNER_REQUIRED" });
  });
});
