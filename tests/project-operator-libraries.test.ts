import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperatorScriptContractError, pinnedAskSettlementLauncher, planAmendmentLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../src/operatorActions/libraryContract.js";
import { discoverProjectOperatorLibraries, parseOperatorScriptKey } from "../src/operatorActions/projectLibraries.js";

const root = path.resolve(import.meta.dirname, "..");
const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = (prefix: string) => { const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))); roots.push(dir); return dir; };

function pinned(): OperatorScriptDescriptor {
  return {
    schema: "arcadia-operator-script-v1", id: "settle-demo-ask", script: "settle-demo-ask.sh", title: "Accept demo Ask", problem: "It waits.",
    desired_effect: "Settle it.", project: "demo", repeatable: false,
    agentAsk: { proposal: "demo-ask", intent: "decision", targetRef: null },
    agentAskSettlement: { schema: "arcadia-agent-ask-settlement-v1", project: "demo", proposalFingerprint: "a".repeat(64), requestId: "settle-demo-ask", disposition: "accepted", placement: null },
    authority: { does: ["Settle exactly demo-ask"], never_does: ["Merge"] }, success: { effect: "Settled", next: "Answer the Decision" }, failure: { effect: "Refused", next: "Read the receipt" }
  };
}
const reason = (run: () => unknown) => { try { run(); return null; } catch (error) { return error instanceof OperatorScriptContractError ? error.reason : String(error); } };

describe("library keys", () => {
  it("parses a bare Arcadia id and a <project>--<id> key, and nothing else", () => {
    expect(parseOperatorScriptKey("own-action")).toEqual({ project: null, id: "own-action" });
    expect(parseOperatorScriptKey("private-practice-now--settle-x-2026-10-19")).toEqual({ project: "private-practice-now", id: "settle-x-2026-10-19" });
    for (const bad of ["", "a---b", "--b", "a--", "a--b--c", "../x", "A--b", "a/b"]) expect(parseOperatorScriptKey(bad)).toBeNull();
  });
});

describe("the pinned Agent Ask settlement contract", () => {
  const launcher = pinnedAskSettlementLauncher("settle-demo-ask");
  it("accepts the exact shared launcher with a complete pin", () => {
    expect(reason(() => validateOperatorScriptContract(pinned(), "settle-demo-ask", launcher))).toBeNull();
  });
  it("refuses a bespoke script, a repeatable pin, a missing agentAsk, a Project mismatch and a placed rejection", () => {
    expect(reason(() => validateOperatorScriptContract(pinned(), "settle-demo-ask", launcher + "echo extra\n"))).toBe("AGENT_ASK_SETTLEMENT_RUNNER_REQUIRED");
    expect(reason(() => validateOperatorScriptContract({ ...pinned(), repeatable: true }, "settle-demo-ask", launcher))).toBe("INVALID_AGENT_ASK_SETTLEMENT");
    const noAsk = pinned(); delete noAsk.agentAsk;
    expect(reason(() => validateOperatorScriptContract(noAsk, "settle-demo-ask", launcher))).toBe("INVALID_AGENT_ASK_SETTLEMENT");
    expect(reason(() => validateOperatorScriptContract({ ...pinned(), project: "other" }, "settle-demo-ask", launcher))).toBe("INVALID_AGENT_ASK_SETTLEMENT");
    const placedRejection = pinned(); placedRejection.agentAskSettlement = { ...placedRejection.agentAskSettlement!, disposition: "rejected", placement: "top" };
    expect(reason(() => validateOperatorScriptContract(placedRejection, "settle-demo-ask", launcher))).toBe("INVALID_AGENT_ASK_SETTLEMENT");
    const short = pinned(); short.agentAskSettlement = { ...short.agentAskSettlement!, proposalFingerprint: "abc" };
    expect(reason(() => validateOperatorScriptContract(short, "settle-demo-ask", launcher))).toBe("INVALID_AGENT_ASK_SETTLEMENT");
  });
  it("refuses the shared launcher without a pin, and an existing-Plan amendment pin", () => {
    const unpinned = pinned(); delete unpinned.agentAskSettlement;
    expect(reason(() => validateOperatorScriptContract(unpinned, "settle-demo-ask", launcher))).toBe("AGENT_ASK_SETTLEMENT_RUNNER_REQUIRED");
    const amendment = pinned(); amendment.agentAsk = { proposal: "demo-ask", intent: "plan", targetRef: "plan/demo" };
    expect(reason(() => validateOperatorScriptContract(amendment, "settle-demo-ask", launcher))).toBe("PLAN_AMENDMENT_RUNNER_REQUIRED");
  });
});

describe("Project library discovery and checking", () => {
  it("confines each Project to a library inside its own checkout and never lists Arcadia's twice", () => {
    const dir = temp("arcadia-discovery-");
    const arcadiaRepo = path.join(dir, "arcadia");
    const arcadia = path.join(arcadiaRepo, "artifacts/generated/operator-scripts");
    const alpha = path.join(dir, "alpha/artifacts/generated/operator-scripts");
    mkdirSync(arcadia, { recursive: true }); mkdirSync(alpha, { recursive: true });
    mkdirSync(path.join(dir, "escape/artifacts/generated"), { recursive: true });
    symlinkSync(alpha, path.join(dir, "escape/artifacts/generated/operator-scripts"), "dir");
    const env = { ARCADIA_OPERATOR_SCRIPT_PROJECT_LIBRARIES: JSON.stringify({ arcadia: arcadiaRepo, alpha: path.join(dir, "alpha"), escape: path.join(dir, "escape"), relative: "alpha", "Bad Slug": path.join(dir, "alpha") }) };
    expect(discoverProjectOperatorLibraries(arcadia, env)).toEqual({ libraries: [{ project: "alpha", path: alpha }], unavailable: null });
    expect(discoverProjectOperatorLibraries(arcadia, { ARCADIA_OPERATOR_SCRIPT_PROJECT_LIBRARIES: "off" }).libraries).toEqual([]);
  });

  it("checks only the entries a Project publishes, and fails a published entry that breaks the contract", () => {
    const repo = temp("arcadia-project-check-");
    const library = path.join(repo, "artifacts/generated/operator-scripts");
    mkdirSync(library, { recursive: true });
    const write = (d: OperatorScriptDescriptor, script: string) => { writeFileSync(path.join(library, `${d.id}.json`), JSON.stringify(d)); writeFileSync(path.join(library, d.script), script, { mode: 0o755 }); };
    write(pinned(), pinnedAskSettlementLauncher("settle-demo-ask"));
    write({ ...pinned(), id: "legacy", script: "legacy.sh", project: undefined, agentAskSettlement: undefined, agentAsk: undefined }, "#!/bin/sh\nexit 0\n");
    const check = () => spawnSync(process.execPath, ["--import", "tsx", path.join(root, "scripts/check-operator-scripts.ts"), "--project", "demo", repo], { encoding: "utf8" });
    let result = check();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ project: "demo", checked: 1, unpublished: 1, unpublishedIds: ["legacy"], failures: 0 });
    write({ ...pinned(), id: "broken", script: "broken.sh" }, "#!/bin/sh\narcadia agent-ask settle --apply\n");
    result = check();
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr.trim().split("\n")[0])).toMatchObject({ id: "demo--broken" });
  });

  it("refuses a published Project entry that would run a same-named Project file instead of Arcadia's runner", () => {
    const repo = temp("arcadia-project-runner-");
    const library = path.join(repo, "artifacts/generated/operator-scripts");
    mkdirSync(library, { recursive: true });
    const d = { ...pinned(), id: "amend-here", script: "amend-here.sh", agentAsk: undefined, agentAskSettlement: undefined, planAmendment: {} } as unknown as OperatorScriptDescriptor;
    writeFileSync(path.join(library, "amend-here.json"), JSON.stringify(d));
    writeFileSync(path.join(library, "amend-here.sh"), planAmendmentLauncher("amend-here"), { mode: 0o755 });
    const result = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "scripts/check-operator-scripts.ts"), "--project", "demo", repo], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr.trim().split("\n")[0])).toMatchObject({ id: "demo--amend-here", reason: "UNSUPPORTED_PROJECT_ENTRY" });
  });
});
