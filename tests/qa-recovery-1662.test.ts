import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  run: vi.fn(), qa: vi.fn(), policy: vi.fn(), rows: [] as unknown[], limit: vi.fn(),
  open: vi.fn(() => 1), write: vi.fn(), mkdir: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.run }));
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(), openSync: mocks.open, closeSync: vi.fn(), writeFileSync: mocks.write, mkdirSync: mocks.mkdir }));
vi.mock("../src/db/connection.js", () => ({ withReadOnlyDatabase: (_: string, callback: (db: unknown) => unknown) => callback({ prepare: () => ({ all: () => mocks.rows }) }) }));
vi.mock("../src/cli/workspace.js", () => ({ resolveReadyWorkspace: () => ({ workspacePath: "/fixture" }) }));
vi.mock("../src/production/policy.js", () => ({ readProductionPolicySafely: mocks.policy }));
vi.mock("../src/sessions/roleLineage.js", () => ({ verdictAttemptLimit: mocks.limit }));
vi.mock("../src/qa/prReview.js", () => ({ runQaPrReviewCommand: mocks.qa }));
import { runQa1662Recovery } from "../scripts/qa-recovery-1662.js";

const root = path.resolve(import.meta.dirname, "..");
const id = "recover-qa-1662-20261022";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T17:00:00Z"));
  vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_ID", id);
  vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", path.join(root, "artifacts/generated/operator-scripts", `${id}.json`));
  vi.stubEnv("CODEX_SANDBOX", "");
  mocks.run.mockImplementation((command: string, args: string[]) => {
    if (command === "git" && args[0] === "branch") return "main\n";
    if (command === "git" && args[0] === "status") return "";
    if (command === "git" && args[0] === "rev-parse") return "fixture-head";
    if (command === "git" && args[0] === "ls-remote") return "fixture-head refs/heads/main";
    if (command === "git" && args[0] === "show") return readFileSync(path.join(root, args[1].slice(5)), "utf8");
    throw new Error("unexpected command");
  });
  mocks.policy.mockReturnValue({ status: "ok", policy: { desiredState: "inactive", scope: null } });
  mocks.rows = [];
}

describe("one-shot #1662 operator recovery", () => {
  afterEach(() => vi.useRealTimers());
  it("refuses Off before any readiness, marker or QA side effect", async () => {
    setup();
    await expect(runQa1662Recovery()).rejects.toThrow("production is Off");
    expect(mocks.qa).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.run.mock.calls.every(([command]) => command === "git")).toBe(true);
  });
  it("refuses an unapproved launch context before external reads", async () => {
    setup(); vi.stubEnv("ARCADIA_OPERATOR_SCRIPT_ID", "wrong-card");
    await expect(runQa1662Recovery()).rejects.toThrow("launch only from this card");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("refuses expired cards", async () => {
    setup(); vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
    await expect(runQa1662Recovery()).rejects.toThrow("card expired");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("refuses an Active scope for a different provider before any mutation", async () => {
    setup();
    mocks.policy.mockReturnValue({ status: "ok", policy: { desiredState: "active", scope: { projects: ["arcadia"], plans: [], actions: [], providers: ["codex-cli"], maxConcurrentSessions: 1 } } });
    await expect(runQa1662Recovery()).rejects.toThrow("Active scope does not cover");
    expect(mocks.qa).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("refuses a moved QA lineage before readiness or rerun", async () => {
    setup();
    mocks.policy.mockReturnValue({ status: "ok", policy: { desiredState: "active", scope: { projects: ["arcadia"], plans: ["arcadia/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider"], actions: ["arcadia/cover-mail-ack-receipt-kind-collision"], providers: ["claude-code-cli"], maxConcurrentSessions: 1 } } });
    mocks.rows = [{ role: "qa", ordinal: 4, status: "failed" }];
    await expect(runQa1662Recovery()).rejects.toThrow("QA lineage moved");
    expect(mocks.qa).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
});
