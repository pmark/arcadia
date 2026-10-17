import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { OperatorScriptContractError, validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { runWorkspaceConfigEdit } from "../src/operatorActions/workspaceConfigEdit.js";
import { workspaceConfigEditLauncher } from "../src/operatorActions/workspaceConfigEditContract.js";
import { activateProduction, deactivateProduction, fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

// Hermetic proof for the one-press "turn the capacity gate on" card: a disposable temp workspace and
// library only (Decision 0082 allows temp-dir fixtures). The live workspace is never resolved or read.
const repo = path.resolve(import.meta.dirname, "..");
const ID = "enable-capacity-gate-20261017";
const published = JSON.parse(readFileSync(path.join(repo, "artifacts/generated/operator-scripts", `${ID}.json`), "utf8"));
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

let root: string;
let workspace: string;
let library: string;
let configPath: string;
let env: NodeJS.ProcessEnv;

function writeConfig(codingAgent: Record<string, unknown> | undefined, raw?: string): string {
  const base = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  delete base.codingAgent;
  const value = codingAgent === undefined ? base : { ...base, codingAgent, reviewFocus: { projectOrder: ["Arcadia"], maxItems: 5 } };
  const text = raw ?? JSON.stringify(value, null, 2) + "\n";
  writeFileSync(configPath, text);
  return text;
}

function publishPair(pin: string = workspace, script?: string): string {
  const descriptor = { ...published, workspaceConfigEdit: { ...published.workspaceConfigEdit, workspace: pin } };
  const file = path.join(library, `${ID}.json`);
  writeFileSync(file, JSON.stringify(descriptor, null, 2) + "\n");
  writeFileSync(path.join(library, `${ID}.sh`), script ?? workspaceConfigEditLauncher(ID));
  chmodSync(path.join(library, `${ID}.sh`), 0o755);
  return file;
}

function activate(): void {
  const scope = normalizeProductionScope({
    intent: "Freeze proof.", projects: ["demo"], plans: ["demo/queue-plan"], actions: [],
    providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: []
  });
  withDatabase(workspace, (db) => activateProduction(db, { requestId: "freeze-proof", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" }));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-config-edit-")));
  workspace = path.join(root, "workspace");
  library = path.join(root, "artifacts/generated/operator-scripts");
  mkdirSync(library, { recursive: true });
  initWorkspace(workspace);
  configPath = getWorkspacePaths(workspace).configFile;
  env = { ARCADIA_WORKSPACE: workspace };
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("published enable-capacity-gate pair", () => {
  it("pins the live workspace, the one allowlisted field and the exact shared launcher", () => {
    const script = readFileSync(path.join(repo, "artifacts/generated/operator-scripts", `${ID}.sh`), "utf8");
    const d = validateOperatorScriptContract(published, ID, script);
    expect(d.workspaceConfigEdit).toEqual({
      schema: "arcadia-workspace-config-edit-v1", workspace: "/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover",
      operation: "remove", field: "codingAgent.capacityGateEnabled", expected: false
    });
    expect(d.repeatable).toBe(false);
    expect(d.kind).toBeUndefined();
  });

  it("refuses a bespoke script, a widened field, a repeatable pin and a stray worker reference", () => {
    const reason = (value: unknown, script: string) => {
      try { validateOperatorScriptContract(value, ID, script); return "accepted"; }
      catch (error) { return (error as OperatorScriptContractError).reason; }
    };
    const launcher = workspaceConfigEditLauncher(ID);
    expect(reason(published, launcher + "echo extra\n")).toBe("WORKSPACE_CONFIG_EDIT_RUNNER_REQUIRED");
    expect(reason({ ...published, workspaceConfigEdit: { ...published.workspaceConfigEdit, field: "memory.enabled" } }, launcher)).toBe("INVALID_WORKSPACE_CONFIG_EDIT");
    expect(reason({ ...published, workspaceConfigEdit: { ...published.workspaceConfigEdit, expected: true } }, launcher)).toBe("INVALID_WORKSPACE_CONFIG_EDIT");
    expect(reason({ ...published, workspaceConfigEdit: { ...published.workspaceConfigEdit, workspace: "relative/ws" } }, launcher)).toBe("INVALID_WORKSPACE_CONFIG_EDIT");
    expect(reason({ ...published, repeatable: true }, launcher)).toBe("INVALID_WORKSPACE_CONFIG_EDIT");
    const { workspaceConfigEdit: _pin, ...bare } = published;
    expect(reason(bare, launcher)).toBe("WORKSPACE_CONFIG_EDIT_RUNNER_REQUIRED");
  });
});

describe("enable-capacity-gate runner against a disposable workspace", () => {
  it("refuses while production is Active and changes nothing", () => {
    const before = writeConfig({ capacityGateEnabled: false });
    activate();
    const receipt = runWorkspaceConfigEdit(publishPair(), { env });
    expect(receipt).toMatchObject({ status: "failed", reason: "PRODUCTION_ACTIVE_FREEZE" });
    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(existsSync(path.join(receipt.runDirectory, "failure-handoff.txt"))).toBe(true);
  });

  it("refuses drift: a true value, an absent field, non-canonical bytes, and another workspace", () => {
    const file = publishPair();
    for (const [agent, reason] of [[{ capacityGateEnabled: true }, "PRECONDITION_DRIFT"], [{}, "PRECONDITION_DRIFT"], [undefined, "PRECONDITION_DRIFT"]] as const) {
      const before = writeConfig(agent);
      expect(runWorkspaceConfigEdit(file, { env })).toMatchObject({ status: "failed", reason });
      expect(readFileSync(configPath, "utf8")).toBe(before);
    }
    const compact = JSON.stringify({ ...JSON.parse(readFileSync(configPath, "utf8")), codingAgent: { capacityGateEnabled: false } });
    writeConfig(undefined, compact);
    expect(runWorkspaceConfigEdit(file, { env })).toMatchObject({ status: "failed", reason: "NONCANONICAL_CONFIG" });
    expect(readFileSync(configPath, "utf8")).toBe(compact);

    const other = path.join(root, "other");
    initWorkspace(other);
    writeConfig({ capacityGateEnabled: false });
    expect(runWorkspaceConfigEdit(file, { env: { ARCADIA_WORKSPACE: other } })).toMatchObject({ status: "failed", reason: "WORKSPACE_DRIFT" });
  });

  it("removes exactly the one field, writes before/after sha256, then refuses a second press", () => {
    const before = writeConfig({ capacityGateEnabled: false });
    activate();
    withDatabase(workspace, (db) => deactivateProduction(db, { requestId: "freeze-proof-off", reason: "proof" }));
    const file = publishPair();
    const receipt = runWorkspaceConfigEdit(file, { env });
    expect(receipt).toMatchObject({ schema: "arcadia-plan-amendment-receipt-v1", id: ID, status: "succeeded", reason: "APPLIED" });

    const after = readFileSync(configPath, "utf8");
    const expected = JSON.parse(before);
    delete expected.codingAgent.capacityGateEnabled;
    expect(after).toBe(JSON.stringify(expected, null, 2) + "\n");
    // Only the removed line (and the now-empty object's brackets) differ.
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    expect(beforeLines.filter((line) => !afterLines.includes(line)).map((line) => line.trim())).toEqual(["\"codingAgent\": {", "\"capacityGateEnabled\": false", "},"]);
    expect(receipt.configEdit).toMatchObject({
      workspace, field: "codingAgent.capacityGateEnabled", removedValue: false,
      beforeSha256: sha(before), afterSha256: sha(after), productionObserved: { desiredState: "inactive" }
    });
    expect(receipt.configEdit?.inverse).toContain("capacityGateEnabled\": false back");
    expect(readFileSync(path.join(receipt.runDirectory, "config-before.json"), "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(path.join(library, "runs/receipts", `${ID}.json`), "utf8")).status).toBe("succeeded");

    // One-shot: even if the flag were put back, a recorded success refuses and never overwrites the success receipt.
    const second = runWorkspaceConfigEdit(file, { env });
    expect(second).toMatchObject({ status: "failed", reason: "ALREADY_APPLIED" });
    writeConfig({ capacityGateEnabled: false });
    expect(runWorkspaceConfigEdit(file, { env })).toMatchObject({ status: "failed", reason: "ALREADY_APPLIED" });
    expect(JSON.parse(readFileSync(path.join(library, "runs/receipts", `${ID}.json`), "utf8")).status).toBe("succeeded");
  });

  it("runs end to end through the exact launcher and worker", () => {
    writeConfig({ capacityGateEnabled: false });
    publishPair();
    // The launcher resolves the repo as library/../../..; point a fake repo at this checkout's worker.
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    writeFileSync(path.join(root, "scripts/workspace-config-edit-worker.ts"), `import "${path.join(repo, "scripts/workspace-config-edit-worker.ts")}";\n`);
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "mise"), "#!/bin/sh\nshift; shift; cd \"" + repo + "\" && exec \"$@\"\n");
    chmodSync(path.join(bin, "mise"), 0o755);
    const result = spawnSync(path.join(library, `${ID}.sh`), ["run"], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, ARCADIA_WORKSPACE: workspace }, encoding: "utf8", timeout: 60_000
    });
    expect(result.stderr).not.toMatch(/Error/);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "succeeded", reason: "APPLIED" });
    expect(JSON.parse(readFileSync(configPath, "utf8")).codingAgent).toEqual({});
    const again = spawnSync(path.join(library, `${ID}.sh`), ["run"], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, ARCADIA_WORKSPACE: workspace }, encoding: "utf8", timeout: 60_000
    });
    expect(again.status).toBe(1);
    expect(JSON.parse(again.stdout)).toMatchObject({ status: "failed", reason: "ALREADY_APPLIED" });
  });
});
