import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  checkFixtureClean,
  emptySoakState,
  failureSignature,
  gateFilesTouched,
  parseVitestReport,
  runSoak,
  type SoakDeps,
  type SoakFailure,
  type SoakOptions,
  type SoakState
} from "../src/soak/rehearsalSoak.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");

function failure(name: string, message = "boom"): SoakFailure {
  return { signature: failureSignature(name, message), testName: name, message, location: "tests/x.ts:1" };
}

function harness(script: SoakFailure[][], overrides: Partial<SoakOptions> = {}) {
  const options: SoakOptions = { cleanTarget: 5, maxIterations: 20, tokenBudget: null, nonBlocking: [], ...overrides };
  const calls = { iterations: 0, issues: [] as string[], printed: [] as string[], saved: 0 };
  const deps: SoakDeps = {
    runIteration: () => ({ failures: script[calls.iterations++] ?? [] }),
    fileIssue: (found) => {
      calls.issues.push(found.signature);
      return `issue-for-${found.signature}`;
    },
    save: () => { calls.saved += 1; },
    now: () => NOW,
    print: (line) => calls.printed.push(line)
  };
  return { options, deps, calls };
}

describe("soak stop conditions", () => {
  it("stops after N consecutive clean iterations, default 5, and records the reason", () => {
    const { options, deps, calls } = harness([]);
    const outcome = runSoak(emptySoakState(), options, deps);
    expect(outcome.reason).toBe("clean_target_reached");
    expect(calls.iterations).toBe(5);
    expect(outcome.state.stops).toEqual([expect.objectContaining({ reason: "clean_target_reached", at: NOW.toISOString() })]);
    expect(calls.printed.at(-1)).toMatch(/^soak stop: clean_target_reached/);
  });

  it("stops on the iteration budget before the clean target", () => {
    const { options, deps, calls } = harness([], { maxIterations: 3 });
    expect(runSoak(emptySoakState(), options, deps).reason).toBe("iteration_budget_exhausted");
    expect(calls.iterations).toBe(3);
  });

  it("stops on the token budget before running anything when it is already spent", () => {
    const { options, deps, calls } = harness([], { tokenBudget: 1000 });
    const state: SoakState = { ...emptySoakState(), tokensSpent: 1000 };
    expect(runSoak(state, options, deps).reason).toBe("token_budget_exhausted");
    expect(calls.iterations).toBe(0);
  });

  it("stops on a blocking failure so the session can fix it, filing its Issue first", () => {
    const bad = failure("rehearsal Step 3");
    const { options, deps, calls } = harness([[], [bad]]);
    const outcome = runSoak(emptySoakState(), options, deps);
    expect(outcome.reason).toBe("blocking_failure_needs_fix");
    expect(calls.issues).toEqual([bad.signature]);
    expect(outcome.detail).toContain(`issue-for-${bad.signature}`);
    expect(outcome.state.consecutiveClean).toBe(0);
  });

  it("stops when the same failure recurs after three fix attempts, across reruns of the command", () => {
    const bad = failure("rehearsal Step 3");
    const { options } = harness([]);
    const state = emptySoakState();
    const reasons: string[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const rerun = harness([[bad]]);
      reasons.push(runSoak(state, options, rerun.deps).reason);
    }
    expect(reasons).toEqual(["blocking_failure_needs_fix", "blocking_failure_needs_fix", "blocking_failure_needs_fix", "same_failure_after_fix_attempts"]);
    expect(state.occurrences[bad.signature]).toBe(4);
  });

  it("files a non-blocking failure as an Issue without failing the iteration", () => {
    const noisy = failure("rehearsal provider: opencode flake");
    const { options, deps, calls } = harness([[noisy], [noisy], [noisy], [noisy], [noisy]], { nonBlocking: ["opencode flake"] });
    const outcome = runSoak(emptySoakState(), options, deps);
    expect(outcome.reason).toBe("clean_target_reached");
    expect(calls.issues).toHaveLength(5);
  });

  it("gives the same failure the same signature regardless of temp paths and shas", () => {
    expect(failureSignature("t", "no file /var/folders/ab/xyz/1 at abcdef1")).toBe(failureSignature("t", "no file /private/tmp/qq/2 at 1234567"));
  });
});

describe("vitest report parsing", () => {
  it("extracts failed tests with their first repository frame, and treats a missing report as a failure", () => {
    const json = JSON.stringify({
      testResults: [{ assertionResults: [
        { fullName: "a passes", status: "passed", failureMessages: [] },
        { fullName: "b fails", status: "failed", failureMessages: ["Error: nope\n    at Object.<anonymous> (/x/tests/rehearsal-two-action.test.ts:42:7)"] }
      ] }]
    });
    const failures = parseVitestReport(json, 1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ testName: "b fails", location: "tests/rehearsal-two-action.test.ts:42" });
    expect(parseVitestReport(null, 137)[0]?.testName).toBe("vitest-run");
    expect(parseVitestReport(JSON.stringify({ testResults: [] }), 1)[0]?.testName).toBe("vitest-run");
    expect(parseVitestReport(JSON.stringify({ testResults: [] }), 0)).toEqual([]);
  });
});

describe("clean-fixture refusal", () => {
  function fixtureDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE production_repair_attempts (action_key TEXT PRIMARY KEY, attempts INTEGER);
      CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, repository_path TEXT);
      CREATE TABLE session_exit_receipts (session_id TEXT, request_id TEXT, outcome TEXT, superseded_by_session_id TEXT);
      CREATE TABLE agent_worktree_reservations (worktree_path TEXT, repository_path TEXT, expires_at TEXT);
      CREATE TABLE production_policy_receipts (request_id TEXT);
    `);
    return db;
  }
  const input = { repositoryPath: "/repo", actionKeys: ["p/a"], requestIds: ["req-1"], now: NOW };

  it("accepts a fixture with no residue, and one whose tables do not exist yet", () => {
    expect(checkFixtureClean(fixtureDb(), input)).toEqual([]);
    expect(checkFixtureClean(new Database(":memory:"), input)).toEqual([]);
  });

  it("names each kind of residue: repair budget, stale handoff, live claim and reused request_id", () => {
    const db = fixtureDb();
    db.prepare("INSERT INTO production_repair_attempts VALUES ('p/a', 2)").run();
    db.prepare("INSERT INTO agent_sessions VALUES ('s1', '/repo')").run();
    db.prepare("INSERT INTO session_exit_receipts VALUES ('s1', 'exit-1', 'incomplete_resumable', NULL)").run();
    db.prepare("INSERT INTO agent_worktree_reservations VALUES ('/wt', '/repo', '2026-09-30T00:00:00.000Z')").run();
    db.prepare("INSERT INTO production_policy_receipts VALUES ('req-1')").run();
    const violations = checkFixtureClean(db, input);
    expect(violations).toHaveLength(4);
    expect(violations.join("\n")).toMatch(/leftover repair budget.*p\/a[\s\S]*stale handoff[\s\S]*live claim[\s\S]*reused request_id: req-1/);
  });

  it("ignores superseded handoffs, expired claims, other repositories and other Actions", () => {
    const db = fixtureDb();
    db.prepare("INSERT INTO production_repair_attempts VALUES ('p/other', 2)").run();
    db.prepare("INSERT INTO agent_sessions VALUES ('s1', '/repo')").run();
    db.prepare("INSERT INTO session_exit_receipts VALUES ('s1', 'exit-1', 'incomplete_resumable', 's2')").run();
    db.prepare("INSERT INTO agent_worktree_reservations VALUES ('/wt', '/repo', '2026-09-28T00:00:00.000Z')").run();
    db.prepare("INSERT INTO agent_worktree_reservations VALUES ('/wt2', '/elsewhere', '2026-09-30T00:00:00.000Z')").run();
    expect(checkFixtureClean(db, input)).toEqual([]);
  });
});

describe("gate-file merge refusal", () => {
  it("flags the concurrency gate, admission policy and approval boundary files and nothing else", () => {
    const touched = gateFilesTouched([
      "src/production/policy.ts",
      "src/production/tick.ts",
      "src/codingAgents/capacity.ts",
      "CONSTITUTION.md",
      "src/stewardship/prBlastRadius.ts",
      "src/soak/rehearsalSoak.ts",
      "tests/rehearsal-soak.test.ts",
      "START_HERE.md"
    ]);
    expect(touched).toEqual(["src/production/policy.ts", "src/production/tick.ts", "src/codingAgents/capacity.ts", "CONSTITUTION.md", "src/stewardship/prBlastRadius.ts"]);
  });

  it("passes a change that touches no gate file", () => {
    expect(gateFilesTouched(["src/soak/rehearsalSoak.ts", "docs/notes-to-self.md"])).toEqual([]);
  });
});
