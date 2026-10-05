import { copyFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planAmendmentLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import { parseRetirementManifest, sha256 } from "../src/operatorActions/libraryRetirements.js";
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
  it("requires a Grant descriptor to remain one-shot", () => {
    const d = descriptor(); delete d.planAmendment;
    d.kind = "grant"; d.repeatable = true;
    expect(() => validateOperatorScriptContract(d, d.id, "#!/bin/sh\nexit 0\n")).toThrow("incomplete");
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

describe("next_after declares the /actions next-action sequence, presentation only", () => {
  const plain = () => { const d = descriptor(); delete d.planAmendment; return d; };
  const script = "#!/bin/sh\nexit 0\n";
  it("accepts a prerequisite window with voiding actions and an inactive-production condition", () => {
    const d = plain(); d.next_after = { id: "run-prerequisite", within_minutes: 30, voided_by: ["restart-host"], when_production: "inactive" };
    expect(validateOperatorScriptContract(d, d.id, script).next_after).toEqual(d.next_after);
  });
  it.each([
    ["itself as prerequisite", { id: "future-amendment", within_minutes: 30 }],
    ["a fractional window", { id: "run-prerequisite", within_minutes: 0.5 }],
    ["a window over a day", { id: "run-prerequisite", within_minutes: 1441 }],
    ["the prerequisite as a voider", { id: "run-prerequisite", within_minutes: 30, voided_by: ["run-prerequisite"] }],
    ["a duplicate voider", { id: "run-prerequisite", within_minutes: 30, voided_by: ["restart-host", "restart-host"] }],
    ["an unknown production condition", { id: "run-prerequisite", within_minutes: 30, when_production: "active" }],
    ["an unknown field", { id: "run-prerequisite", within_minutes: 30, grants: true }]
  ])("refuses %s", (_label, nextAfter) => {
    const d = plain(); (d as unknown as Record<string, unknown>).next_after = nextAfter;
    expect(() => validateOperatorScriptContract(d, d.id, script)).toThrow("next_after needs");
  });
  it("fails the library check when the prerequisite is not published beside it", () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-next-after-"))); roots.push(dir);
    const d = plain(); d.next_after = { id: "missing-prerequisite", within_minutes: 30 };
    writeFileSync(path.join(dir, `${d.id}.json`), JSON.stringify(d)); writeFileSync(path.join(dir, d.script), script, { mode: 0o755 });
    const result = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "scripts/check-operator-scripts.ts"), dir], { encoding: "utf8" });
    expect(result.status).toBe(1); expect(JSON.parse(result.stderr)).toMatchObject({ id: d.id, reason: "UNKNOWN_NEXT_AFTER_PREREQUISITE" });
  });
});

describe("Legacy library entries retire only through the exact-hash manifest", () => {
  const checker = path.join(root, "scripts/check-operator-scripts.ts");
  const legacyScript = "#!/bin/sh\narcadia agent-ask settle --apply\n";
  const ids = ["legacy-one", "legacy-two", "legacy-three", "legacy-four", "legacy-five"];
  function tempDir(prefix: string): string { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))); roots.push(dir); return dir; }
  function legacy(id: string): OperatorScriptDescriptor { const d = descriptor(); delete d.planAmendment; d.id = id; d.script = `${id}.sh`; return d; }
  function write(dir: string, d: OperatorScriptDescriptor, script = legacyScript): void {
    writeFileSync(path.join(dir, `${d.id}.json`), JSON.stringify(d)); writeFileSync(path.join(dir, d.script), script, { mode: 0o755 });
  }
  function pinnedLibrary(): { library: string; manifest: string } {
    const library = tempDir("arcadia-retired-library-"); const pins = tempDir("arcadia-retired-manifest-");
    for (const id of ids) write(library, legacy(id));
    const retirements = ids.map(id => ({ id, descriptorSha256: sha256(readFileSync(path.join(library, `${id}.json`))),
      scriptSha256: sha256(readFileSync(path.join(library, `${id}.sh`))), outcome: "succeeded, state retained", reason: "legacy fixture" }));
    const manifest = path.join(pins, "retirements.json");
    writeFileSync(manifest, JSON.stringify({ schema: "arcadia-operator-script-retirements-v1", retirements }));
    return { library, manifest };
  }
  const check = (library: string, manifest?: string) =>
    spawnSync(process.execPath, ["--import", "tsx", checker, library, ...(manifest === undefined ? [] : ["--retirements", manifest])], { encoding: "utf8" });
  const failuresOf = (stderr: string) => stderr.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line) as { id?: string; reason: string });

  it("skips pinned legacy pairs visibly and leaves the library untouched", () => {
    const { library, manifest } = pinnedLibrary();
    const before = readdirSync(library).sort().map(file => [file, sha256(readFileSync(path.join(library, file)))]);
    const result = check(library, manifest);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ checked: 0, retired: 5, retiredIds: [...ids].sort(), failures: 0 });
    expect(readdirSync(library).sort().map(file => [file, sha256(readFileSync(path.join(library, file)))])).toEqual(before);
  });
  it.each([".sh", ".json"])("fully validates a retired id whose %s bytes changed", suffix => {
    const { library, manifest } = pinnedLibrary();
    if (suffix === ".sh") writeFileSync(path.join(library, "legacy-two.sh"), legacyScript + "\n", { mode: 0o755 });
    else write(library, { ...legacy("legacy-two"), title: "Changed title" });
    const result = check(library, manifest);
    expect(result.status).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ retired: 4, failures: 1 });
    expect(failuresOf(result.stderr)).toEqual([{ id: "legacy-two", reason: "UNDECLARED_OPERATOR_SETTLEMENT", message: expect.any(String) }]);
  });
  it("fully validates a new undeclared Agent Ask script and a renamed copy of a retired pair", () => {
    const { library, manifest } = pinnedLibrary();
    write(library, legacy("brand-new-settlement"));
    copyFileSync(path.join(library, "legacy-one.json"), path.join(library, "legacy-one-renamed.json"));
    copyFileSync(path.join(library, "legacy-one.sh"), path.join(library, "legacy-one-renamed.sh"));
    const result = check(library, manifest);
    expect(result.status).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ retired: 5, failures: 2 });
    expect(failuresOf(result.stderr).map(f => [f.id, f.reason])).toEqual([
      ["brand-new-settlement", "UNDECLARED_OPERATOR_SETTLEMENT"], ["legacy-one-renamed", "INVALID_OPERATOR_CONTRACT"]]);
  });
  it("refuses a retired id whose matching script resolves outside the library", () => {
    const { library, manifest } = pinnedLibrary(); const outside = tempDir("arcadia-retired-outside-");
    copyFileSync(path.join(library, "legacy-three.sh"), path.join(outside, "legacy-three.sh"));
    rmSync(path.join(library, "legacy-three.sh")); symlinkSync(path.join(outside, "legacy-three.sh"), path.join(library, "legacy-three.sh"));
    const result = check(library, manifest);
    expect(result.status).toBe(1); expect(failuresOf(result.stderr)).toMatchObject([{ id: "legacy-three", reason: "INVALID_OPERATOR_CONTRACT" }]);
  });
  it("still refuses an existing-Plan amendment even when a manifest is present", () => {
    const { library, manifest } = pinnedLibrary();
    write(library, { ...legacy("plan-target"), agentAsk: { proposal: "amend-plan", intent: "plan", targetRef: "plan/existing" } });
    const result = check(library, manifest);
    expect(result.status).toBe(1); expect(failuresOf(result.stderr)).toMatchObject([{ id: "plan-target", reason: "PLAN_AMENDMENT_RUNNER_REQUIRED" }]);
  });
  it("keeps declared Action, draft-Plan and completion settlements valid", () => {
    const { library, manifest } = pinnedLibrary();
    write(library, { ...legacy("declared-action"), agentAsk: { proposal: "add-action", intent: "action", targetRef: null } });
    write(library, { ...legacy("declared-draft-plan"), agentAsk: { proposal: "create-plan", intent: "plan", targetRef: null } });
    write(library, { ...legacy("declared-completion"), agentAsk: { proposal: "complete-it", intent: "complete", targetRef: "action/some-action" } });
    const result = check(library, manifest);
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ checked: 3, retired: 5, failures: 0 });
  });
  it.each([["missing", (dir: string) => path.join(dir, "absent.json")], ["malformed", (dir: string) => { const p = path.join(dir, "bad.json"); writeFileSync(p, "{"); return p; }],
    ["glob id", (dir: string) => { const p = path.join(dir, "glob.json"); writeFileSync(p, JSON.stringify({ schema: "arcadia-operator-script-retirements-v1",
      retirements: [{ id: "legacy-*", descriptorSha256: "0".repeat(64), scriptSha256: "0".repeat(64), outcome: "x", reason: "y" }] })); return p; }]])(
    "fails closed on a %s manifest", (_label, make) => {
      const { library } = pinnedLibrary(); const result = check(library, make(tempDir("arcadia-retired-bad-")));
      expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(failuresOf(result.stderr)).toMatchObject([{ reason: "INVALID_RETIREMENT_MANIFEST" }]);
    });
  it("rejects id-only, duplicate and malformed-hash entries", () => {
    const entry = { id: "legacy-one", descriptorSha256: "a".repeat(64), scriptSha256: "b".repeat(64), outcome: "x", reason: "y" };
    const parse = (retirements: unknown[]) => () => parseRetirementManifest({ schema: "arcadia-operator-script-retirements-v1", retirements });
    expect(parse([entry])).not.toThrow();
    expect(parse([{ id: "legacy-one" }])).toThrow("exactly");
    expect(parse([entry, entry])).toThrow("Duplicate");
    expect(parse([{ ...entry, scriptSha256: "B".repeat(64) }])).toThrow("exactly");
    expect(parse([{ ...entry, extra: true }])).toThrow("exactly");
  });
  it("ships exactly the five pinned legacy retirements", () => {
    const shipped = JSON.parse(readFileSync(path.join(root, "src/operatorActions/legacyRetirements.json"), "utf8")) as { retirements: { id: string }[] };
    const entries = parseRetirementManifest(shipped);
    expect([...entries.keys()].sort()).toEqual([
      "accept-narrow-managed-session-preservation-actions-2026-09-30-v3", "accept-worker-recovery-completion-2026-09-20",
      "preview-terminal-integration-recovery-2026-10-01", "remove-superseded-branches-and-worktree-2026-09-27",
      "settle-complete-approval-must-apply-or-refuse-2026-09-20"]);
    expect(shipped.retirements).toHaveLength(5);
    for (const e of entries.values()) expect(`${e.id}${e.descriptorSha256}${e.scriptSha256}`).not.toMatch(/[*?[\]{}]/);
  });
});
