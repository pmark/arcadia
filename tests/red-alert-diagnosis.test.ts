import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import { upsertProject } from "../src/db/repositories.js";
import {
  DEFAULT_DIAGNOSIS_TOKEN_BUDGET,
  diagnoseOpenRedAlerts,
  diagnoseRedAlert,
  listRedAlertDiagnoses,
  readDiagnosisSettings,
  safetyGateFilesTouched,
  type DiagnosisDeps,
  type DiagnosisSettings,
  type GhRunner
} from "../src/production/redAlertDiagnosis.js";
import { listOpenRedAlerts, raiseRedAlert } from "../src/production/redAlerts.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const enabled: DiagnosisSettings = { enabled: true, issueRepo: "pmark/arcadia", tokenBudget: 4000, disabledReason: null };

function fixture() {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-red-diagnosis-"));
  roots.push(workspace);
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    upsertProject(db, { name: "Test Project", mission: "Diagnose alerts.", goal: "Diagnose alerts.", status: "active" });
  });
  return workspace;
}

function raise(db: Database.Database, workspace: string, subject = "sess-1") {
  return raiseRedAlert(db, {
    workspace,
    projectSlug: "test-project",
    actionKey: "test-project/define-contract",
    sessionId: subject,
    trigger: "session_stalled",
    detail: () => "Session past its stall window.",
    now: new Date("2026-09-29T00:00:00.000Z")
  }).alert;
}

const goodFinding = {
  cause: "The stall detector never resets its deadline after output resumes.",
  evidence: [{ file: "src/production/stallDetection.ts", line: 42, note: "deadline is compared but never refreshed" }],
  proposedFix: {
    summary: "Refresh the stall deadline when pane output changes.",
    files: ["src/production/stallDetection.ts"],
    acceptance: ["A Session whose pane output resumes is no longer reported stalled."]
  }
};

function makeDeps(overrides: { finding?: unknown; tokensUsed?: number; existingIssues?: string; throwModel?: boolean } = {}) {
  const diagnose = vi.fn(async () => {
    if (overrides.throwModel) throw new Error("local model unreachable");
    return { finding: overrides.finding ?? goodFinding, tokensUsed: overrides.tokensUsed ?? 900 };
  });
  const ghCalls: string[][] = [];
  const gh: GhRunner = async (args) => {
    ghCalls.push(args);
    if (args[1] === "list") return { status: 0, stdout: overrides.existingIssues ?? "[]", stderr: "" };
    if (args[1] === "create") return { status: 0, stdout: "https://github.com/pmark/arcadia/issues/901\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const drafted: string[] = [];
  const draftAsk = vi.fn((request: string) => {
    drafted.push(request);
    return { path: "/tmp/drafted-ask.yaml" };
  });
  const deps: DiagnosisDeps = { model: { route: "fake-local-route", diagnose }, gh, draftAsk };
  return { deps, diagnose, ghCalls, drafted, draftAsk };
}

describe("red alert diagnosis", () => {
  it("is disabled by default and a disabled run calls no model, files no Issue and drafts no Ask", async () => {
    const workspace = fixture();
    expect(readDiagnosisSettings(workspace)).toMatchObject({ enabled: false, tokenBudget: DEFAULT_DIAGNOSIS_TOKEN_BUDGET });
    const made = makeDeps();
    const result = await withDb(workspace, async (db) => {
      raise(db, workspace);
      return diagnoseOpenRedAlerts(db, readDiagnosisSettings(workspace), () => made.deps);
    });
    expect(result.enabled).toBe(false);
    expect(made.diagnose).not.toHaveBeenCalled();
    expect(made.ghCalls).toHaveLength(0);
    expect(made.draftAsk).not.toHaveBeenCalled();
    withDatabase(workspace, (db) => expect(listRedAlertDiagnoses(db)).toHaveLength(0));
  });

  it("stays disabled when enabled is set without an issueRepo, and reads a full enable", () => {
    const workspace = fixture();
    const configFile = getWorkspacePaths(workspace).configFile;
    const base = JSON.parse(readFileSync(configFile, "utf8"));
    writeFileSync(configFile, JSON.stringify({ ...base, redAlertDiagnosis: { enabled: true } }));
    expect(readDiagnosisSettings(workspace)).toMatchObject({ enabled: false, disabledReason: expect.stringContaining("issueRepo") });
    writeFileSync(configFile, JSON.stringify({ ...base, redAlertDiagnosis: { enabled: true, issueRepo: "pmark/arcadia", tokenBudget: 1500 } }));
    expect(readDiagnosisSettings(workspace)).toEqual({ enabled: true, issueRepo: "pmark/arcadia", tokenBudget: 1500, disabledReason: null });
  });

  it("files one Issue with file:line evidence, drafts one fix Action Ask, and records the route and budget on the alert", async () => {
    const workspace = fixture();
    const made = makeDeps();
    const diagnosis = await withDb(workspace, async (db) => {
      const alert = raise(db, workspace);
      const outcome = await diagnoseRedAlert(db, alert, enabled, made.deps);
      expect(listOpenRedAlerts(db)).toHaveLength(1);
      return { outcome, alert };
    });
    expect(diagnosis.outcome).toMatchObject({ status: "proposed", tokenBudget: 4000, tokensUsed: 900, modelRoute: "fake-local-route", issueUrl: "https://github.com/pmark/arcadia/issues/901" });
    const create = made.ghCalls.find((args) => args[1] === "create")!;
    expect(create).toContain("bug");
    expect(create.join(" ")).toContain("src/production/stallDetection.ts:42");
    expect(made.ghCalls.filter((args) => args[1] === "create")).toHaveLength(1);
    const ask = JSON.parse(made.drafted[0]);
    expect(ask).toMatchObject({ intent: "action", project: "test-project" });
    expect(ask.actions).toHaveLength(1);
    expect(ask.actions[0].acceptance).toContain("A Session whose pane output resumes is no longer reported stalled.");
    const evidence = readFileSync(diagnosis.alert.evidencePath, "utf8");
    expect(evidence).toContain("## Diagnosis");
    expect(evidence).toContain("fake-local-route");
    expect(evidence).toContain("4000");
  });

  it("updates the existing Issue instead of filing a second one", async () => {
    const workspace = fixture();
    const made = makeDeps({ existingIssues: JSON.stringify([{ number: 77, url: "https://github.com/pmark/arcadia/issues/77" }]) });
    const outcome = await withDb(workspace, async (db) => diagnoseRedAlert(db, raise(db, workspace), enabled, made.deps));
    expect(outcome?.issueUrl).toBe("https://github.com/pmark/arcadia/issues/77");
    expect(made.ghCalls.some((args) => args[1] === "create")).toBe(false);
    expect(made.ghCalls.some((args) => args[1] === "comment" && args[2] === "77")).toBe(true);
  });

  it("starts at most one diagnosis per alert, however many times the driver runs", async () => {
    const workspace = fixture();
    const made = makeDeps();
    await withDb(workspace, async (db) => {
      raise(db, workspace);
      const first = await diagnoseOpenRedAlerts(db, enabled, () => made.deps);
      const second = await diagnoseOpenRedAlerts(db, enabled, () => made.deps);
      const third = await diagnoseOpenRedAlerts(db, enabled, () => made.deps);
      expect(first.diagnosed).toHaveLength(1);
      expect(second).toMatchObject({ diagnosed: [], skipped: 1 });
      expect(third).toMatchObject({ diagnosed: [], skipped: 1 });
      expect(listRedAlertDiagnoses(db)).toHaveLength(1);
    });
    expect(made.diagnose).toHaveBeenCalledTimes(1);
  });

  it("does not retry after a failed diagnosis", async () => {
    const workspace = fixture();
    const made = makeDeps({ throwModel: true });
    await withDb(workspace, async (db) => {
      raise(db, workspace);
      const first = await diagnoseOpenRedAlerts(db, enabled, () => made.deps);
      expect(first.diagnosed[0]).toMatchObject({ status: "failed" });
      await diagnoseOpenRedAlerts(db, enabled, () => made.deps);
      expect(listOpenRedAlerts(db)).toHaveLength(1);
    });
    expect(made.diagnose).toHaveBeenCalledTimes(1);
    expect(made.ghCalls).toHaveLength(0);
  });

  it("stops at the token budget: an over-budget call is discarded and the alert stays open", async () => {
    const workspace = fixture();
    const made = makeDeps({ tokensUsed: 4001 });
    const outcome = await withDb(workspace, async (db) => {
      const result = await diagnoseRedAlert(db, raise(db, workspace), enabled, made.deps);
      expect(listOpenRedAlerts(db)).toHaveLength(1);
      return result;
    });
    expect(outcome).toMatchObject({ status: "budget_exceeded", tokensUsed: 4001, tokenBudget: 4000 });
    expect(made.ghCalls).toHaveLength(0);
    expect(made.draftAsk).not.toHaveBeenCalled();
  });

  it("stops before calling the model when the prompt alone exceeds the budget", async () => {
    const workspace = fixture();
    const made = makeDeps();
    const outcome = await withDb(workspace, async (db) => diagnoseRedAlert(db, raise(db, workspace), { ...enabled, tokenBudget: 10 }, made.deps));
    expect(outcome).toMatchObject({ status: "budget_exceeded" });
    expect(made.diagnose).not.toHaveBeenCalled();
  });

  it("records no_cause on the alert when the model names no cause with file:line evidence, and files nothing", async () => {
    const workspace = fixture();
    for (const finding of [{ cause: null, evidence: [], proposedFix: null }, { cause: "Something", evidence: [{ file: "src/x.ts", line: 0 }], proposedFix: goodFinding.proposedFix }]) {
      const made = makeDeps({ finding });
      const outcome = await withDb(workspace, async (db) => {
        const alert = raise(db, workspace, `sess-${Math.random()}`);
        const result = await diagnoseRedAlert(db, alert, enabled, made.deps);
        expect(listOpenRedAlerts(db).some((open) => open.id === alert.id)).toBe(true);
        return result;
      });
      expect(outcome).toMatchObject({ status: "no_cause" });
      expect(made.ghCalls).toHaveLength(0);
      expect(made.draftAsk).not.toHaveBeenCalled();
    }
  });

  it("marks a fix touching a safety gate needs_operator: Issue and Ask are recorded, and the Ask forbids auto-merge", async () => {
    const workspace = fixture();
    const finding = {
      ...goodFinding,
      evidence: [{ file: "src/production/policy.ts", line: 10, note: "admission threshold" }],
      proposedFix: { summary: "Loosen the admission policy.", files: ["src/production/policy.ts", "src/other.ts"], acceptance: ["Admission no longer refuses."] }
    };
    const made = makeDeps({ finding });
    const outcome = await withDb(workspace, async (db) => diagnoseRedAlert(db, raise(db, workspace), enabled, made.deps));
    expect(outcome).toMatchObject({ status: "needs_operator", gateFiles: ["src/production/policy.ts"] });
    expect(outcome?.note).toContain("never auto-merged");
    const ask = JSON.parse(made.drafted[0]);
    expect(ask.actions[0].acceptance.join(" ")).toContain("open pull request for the operator");
  });

  it("classifies gate and credential paths and lets ordinary files through", () => {
    expect(safetyGateFilesTouched(["src/production/policy.ts", "./src/codingAgents/capacity.ts", "src/ask/settlement.ts", "CONSTITUTION.md", "config/defaults/provider-adapters.json", ".env.local", "src/x/credentials.ts"])).toHaveLength(7);
    expect(safetyGateFilesTouched(["src/production/stallDetection.ts", "src/production/redAlerts.ts", "docs/notes-to-self.md"])).toEqual([]);
  });
});

async function withDb<T>(workspace: string, callback: (db: Database.Database) => Promise<T>): Promise<T> {
  const db = openDatabase(workspace);
  try {
    return await callback(db);
  } finally {
    db.close();
  }
}
