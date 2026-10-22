import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  run: vi.fn(), qa: vi.fn(), policy: vi.fn(), rows: [] as unknown[], limit: vi.fn(),
  open: vi.fn(() => 1), write: vi.fn(), mkdir: vi.fn(),
}));
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), execFileSync: mocks.run }));
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(), openSync: mocks.open, closeSync: vi.fn(), writeFileSync: mocks.write, mkdirSync: mocks.mkdir }));
vi.mock("../src/db/connection.js", () => ({ withReadOnlyDatabase: (_: string, callback: (db: unknown) => unknown) => callback({ prepare: () => ({ all: () => mocks.rows }) }) }));
vi.mock("../src/cli/workspace.js", () => ({ resolveReadyWorkspace: () => ({ workspacePath: "/fixture" }) }));
vi.mock("../src/production/policy.js", () => ({ readProductionPolicySafely: mocks.policy }));
vi.mock("../src/sessions/roleLineage.js", () => ({ verdictAttemptLimit: mocks.limit }));
vi.mock("../src/qa/prReview.js", async original => ({ ...await original<typeof import("../src/qa/prReview.js")>(), runQaPrReviewCommand: mocks.qa }));
// Keep the published body pin while using a small deterministic body fixture.
vi.mock("node:crypto", async original => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, createHash: (algorithm: string) => {
    const hash = actual.createHash(algorithm);
    const update = hash.update.bind(hash);
    hash.update = ((data: string) => data === "repaired QA plan fixture"
      ? { digest: () => "5057d7d18cb5f4046d0a0a0ee743ac50686c71e74399a5cd93fb59216a7f3bf4" }
      : update(data)) as typeof hash.update;
    return hash;
  } };
});
import { runQa1662Recovery, assertRecoveryTerminal } from "../scripts/qa-recovery-1662.js";

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
  mocks.limit.mockReturnValue(7);
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


const pinnedHead = "cff844a22093fbbf4c0a29408502718ab91d047a";
const greenChecks = () => ["lint", "dashboard", "e2e", ...Array.from({length: 8}, (_, i) => `unit-shard-${i + 1}`), ...Array.from({length: 4}, (_, i) => `unit-${i + 1}`)]
  .map(name => ({ name, status: "COMPLETED", conclusion: "SUCCESS" }));
function activeSetup() {
  setup();
  const policy = { desiredState: "active", revision: 80, epoch: 45, scope: { projects: ["arcadia"], plans: ["arcadia/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider"], actions: ["arcadia/cover-mail-ack-receipt-kind-collision"], providers: ["claude-code-cli"], maxConcurrentSessions: 1 } };
  mocks.policy.mockReturnValue({ status: "ok", policy });
  mocks.rows = [1, 2, 3].map(ordinal => ({ role: "qa", ordinal, status: "failed", target_head: pinnedHead }));
  mocks.rows.push({ role: "code-review", ordinal: 5, status: "passed", target_head: pinnedHead });
  const git = mocks.run.getMockImplementation()!;
  const reads = [greenChecks(), greenChecks()];
  let read = 0;
  mocks.run.mockImplementation((command: string, args: string[]) => {
    if (command !== "gh") return git(command, args);
    if (args[1] === "view") return JSON.stringify({ headRefOid: pinnedHead, body: "repaired QA plan fixture", state: "OPEN", isDraft: true, statusCheckRollup: reads[read++] });
    if (args[1] === "ready") return "ready";
    throw new Error("unexpected GitHub command");
  });
  return { reads, policy };
}
function expectNoReadyOrQa() {
  expect(mocks.run.mock.calls.some(([command, args]) => command === "gh" && args[1] === "ready")).toBe(false);
  expect(mocks.qa).not.toHaveBeenCalled();
}
describe("final recovery mutation gates", () => {
  afterEach(() => vi.useRealTimers());
  const changes = [
    { name: "e2e", status: "IN_PROGRESS", conclusion: null },
    { name: "e2e", status: "COMPLETED", conclusion: "FAILURE" },
    { name: "extra-validation", status: "COMPLETED", conclusion: "FAILURE" },
  ];
  it.each(changes)("refuses conflicting/additional $name ($status/$conclusion) before consuming the card", async change => {
    const { reads } = activeSetup();
    reads[0].push(change as typeof reads[0][number]);
    await expect(runQa1662Recovery()).rejects.toThrow("required CI not green");
    expect(mocks.open).not.toHaveBeenCalled(); expectNoReadyOrQa();
  });
  it.each(changes)("rechecks changed final CI $name ($status/$conclusion) before readiness", async change => {
    const { reads } = activeSetup();
    reads[1].push(change as typeof reads[1][number]);
    await expect(runQa1662Recovery()).rejects.toThrow("required CI not green");
    expect(mocks.open).toHaveBeenCalledTimes(1); expectNoReadyOrQa();
  });
  it.each([0, 1])("requires every named CI job at read %s", async read => {
    const { reads } = activeSetup();
    reads[read] = reads[read].filter(check => check.name !== "e2e");
    await expect(runQa1662Recovery()).rejects.toThrow("required CI not green");
    expectNoReadyOrQa();
  });
  it.each(["revision", "epoch"] as const)("refuses authority $0 drift during the final remote read before readiness", async key => {
    const { policy } = activeSetup();
    const remote = mocks.run.getMockImplementation()!;
    let read = 0;
    mocks.run.mockImplementation((command: string, args: string[]) => {
      const result = remote(command, args);
      if (command === "gh" && args[1] === "view" && ++read === 2) {
        mocks.policy.mockReturnValue({ status: "ok", policy: { ...policy, [key]: policy[key] + 1 } });
      }
      return result;
    });
    await expect(runQa1662Recovery()).rejects.toThrow("production authority changed immediately before readiness");
    expectNoReadyOrQa();
  });
  it("passes the final guards for a current fully green candidate", async () => {
    activeSetup();
    mocks.qa.mockImplementation(() => { throw new Error("fixture stops at guarded QA boundary"); });
    await expect(runQa1662Recovery()).rejects.toThrow("fixture stops at guarded QA boundary");
    expect(mocks.run.mock.calls.filter(([command, args]) => command === "gh" && args[1] === "ready")).toHaveLength(1);
    expect(mocks.qa).toHaveBeenCalledTimes(1);
    expect(mocks.qa.mock.calls[0][0].expectedCandidate).toMatchObject({ headSha: pinnedHead, maxOrdinal: 4 });
  });
});

describe("canonical recovery read-back", () => {
  const head = "cff844a22093fbbf4c0a29408502718ab91d047a";
  const input = "04991ec7485bf6ff4bdbce6183a44591108922de2f817ea602228b3992dbe99d";
  const row = { ordinal: 4, status: "passed", target_head: head, input_revision: input, terminal_receipt_json: JSON.stringify({ artifactId: "artifact-qa", headSha: head, verdict: "pass" }) };
  it("accepts only the exact canonical terminal and matching result receipt", () => {
    expect(() => assertRecoveryTerminal(row, "artifact-qa")).not.toThrow();
    for (const change of [{ status: "failed" }, { ordinal: 5 }, { target_head: "moved" }, { input_revision: "moved" }, { terminal_receipt_json: "{}" }]) {
      expect(() => assertRecoveryTerminal({ ...row, ...change }, "artifact-qa")).toThrow("canonical passed attempt 4");
    }
    expect(() => assertRecoveryTerminal(row, "different-artifact")).toThrow("canonical passed attempt 4");
    expect(() => assertRecoveryTerminal(undefined, "artifact-qa")).toThrow("canonical passed attempt 4");
  });
});
