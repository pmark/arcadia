import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { recordRepairBudgetParkIssues } from "../src/production/terminalCandidates.js";
import { ensureProductionTickTables, recordOperatorEscalation, resetProductionRepairBudget } from "../src/production/tick.js";
import { isolateProcess, type IsolatedProcess } from "./fast-rehearsal/helpers/environment.js";
import { FastRehearsal, SCENARIO_TIMEOUT_MS } from "./fast-rehearsal/helpers/world.js";

/**
 * Issue #2629 (Decision 0223 A): parking an Action on an Action-local
 * repair_budget_exhausted hold records a GitHub Issue naming the Action, the
 * failure and the revival trigger. Real worker tick; only GitHub (an injected
 * command runner), tmux and the agent are faked (the fast-rehearsal harness).
 */
const PARKED = "parked-a";
const OTHER = "parked-b";
const ISSUE_URL = "https://github.com/example/repo/issues/9001";
const REPO = "example/repo";
const LAST_ERROR = "Resumed Session exited incomplete without changing its candidate.";

const fixturePlan = {
  firstAction: PARKED,
  genesisFiles: { "scripts/check-parked.mjs": "process.exit(0);\n" },
  actionsYaml: [PARKED, OTHER].map((id) => `  - id: ${id}
    title: Implement docs/parked/${id}.md containing the line "${id} done".
    status: open
    responsibility: agent
    effort: session
    next_action: Implement docs/parked/${id}.md containing the line "${id} done".
    expected_artifact: docs/parked/${id}.md
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - docs/parked/${id}.md contains the line "${id} done" and nothing else.
    depends_on: []
    decisions: []
`).join("")
};

interface GhCall { args: string[] }
interface ParkOptions {
  localAttempts: number;
  kind?: string;
  /** Every `gh issue create` fails. */
  failFiling?: boolean;
  /** The first `gh issue create` fails after GitHub already created the Issue (a crash after filing). */
  phantomFirst?: boolean;
  /** `gh repo view` cannot resolve a repository. */
  noRepo?: boolean;
}
let isolation: IsolatedProcess | undefined;
let world: FastRehearsal | undefined;
afterEach(() => { world?.dispose(); isolation?.restore(); world = undefined; isolation = undefined; });

/** A world with PARKED parked on a repair_budget_exhausted hold; `localAttempts` 3 is Action-local, 0 a global cause. */
function parkWorld(name: string, options: ParkOptions) {
  isolation = isolateProcess();
  const w = new FastRehearsal(name, isolation, import.meta.filename, { fixturePlan, validationCommand: "node scripts/check-parked.mjs", workerMerge: true });
  world = w;
  w.start();
  const ghCalls: GhCall[] = [];
  const bodies: string[] = [];
  const titles: string[] = [];
  const server: Array<{ url: string; body: string }> = [];
  let createCount = 0;
  const original = w.gh.runCommand;
  const runner = (input: Parameters<typeof original>[0]) => {
    if (input.command === "gh" && input.args[0] === "repo") {
      return options.noRepo ? { status: 1, stdout: "", stderr: "no git remotes", error: null } : { status: 0, stdout: `${REPO}\n`, stderr: "", error: null };
    }
    if (input.command === "gh" && input.args[0] === "issue") {
      ghCalls.push({ args: input.args });
      if (input.args[1] === "create") {
        createCount += 1;
        const body = input.args[input.args.indexOf("--body") + 1] ?? "";
        titles.push(input.args[input.args.indexOf("--title") + 1] ?? "");
        bodies.push(body);
        if (options.failFiling) return { status: 1, stdout: "", stderr: "gh: not authenticated", error: null };
        const url = `https://github.com/example/repo/issues/${9000 + createCount}`;
        server.push({ url, body });
        if (options.phantomFirst && createCount === 1) return { status: 1, stdout: "", stderr: "connection reset after create", error: null };
        return { status: 0, stdout: `${url}\n`, stderr: "", error: null };
      }
      return { status: 0, stdout: JSON.stringify(server), stderr: "", error: null };
    }
    return original(input);
  };
  Object.defineProperty(w.gh, "runCommand", { value: runner });
  const key = w.actionKey(PARKED);
  const park = (at: Date) => withDatabase(w.workspace, (db) => {
    ensureProductionTickTables(db);
    const iso = at.toISOString();
    db.prepare(`INSERT OR REPLACE INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at, local_attempts)
      VALUES (?, 3, ?, ?, ?, ?)`).run(key, LAST_ERROR, iso, iso, options.localAttempts);
    recordOperatorEscalation(db, {
      actionKey: key, kind: options.kind ?? "repair_budget_exhausted",
      message: `Repair budget exhausted for ${key} after 3 failed launch attempt(s); most recent error: ${LAST_ERROR}`,
      remedy: `Repair the underlying problem, then run \`arcadia production reset-repair-budget ${key}\`.`, now: at
    });
  });
  park(new Date(w.now.getTime()));
  const state = () => withReadOnlyDatabase(w.workspace, (db) => ({
    counters: db.prepare("SELECT attempts, local_attempts FROM production_repair_attempts WHERE action_key = ?").get(key),
    escalation: db.prepare("SELECT kind, message, remedy FROM production_operator_escalations WHERE action_key = ?").get(key)
  }));
  const creates = () => ghCalls.filter((call) => call.args[1] === "create");
  return { w, key, ghCalls, bodies, titles, creates, state, park, runner };
}

describe("Issue #2629: an Action-local repair-budget park records one GitHub Issue", () => {
  it("files exactly one Issue per park episode, naming the Action, the failure and the revival trigger, and none on later ticks", () => {
    const park = parkWorld("park-records-issue-local", { localAttempts: 3 });
    const before = park.state();
    park.w.ticks(1);
    expect(park.creates()).toHaveLength(1);
    park.w.ticks(4);
    expect(park.creates()).toHaveLength(1);
    expect(park.creates()[0]?.args).toEqual(expect.arrayContaining(["--repo", REPO]));
    expect(park.titles[0]).toContain(park.key);
    const body = park.bodies[0] ?? "";
    expect(body).toContain(park.key);
    expect(body).toContain(LAST_ERROR);
    expect(body).toContain(`arcadia production reset-repair-budget ${park.key}`);
    expect(body).toMatch(/<!-- repair-budget-parked:[^>]+ -->/);
    expect(park.w.log.filter((line) => line.includes(`Filed ${ISSUE_URL}`))).toHaveLength(1);
    // The park itself is untouched: same escalation, same counters, still open.
    expect(park.state()).toEqual(before);
    expect(park.w.planAction(park.w.repo, PARKED)).toBe("open");
  }, SCENARIO_TIMEOUT_MS);

  it("a filing failure only logs: bounded attempts, and the park, counters and escalation are unchanged", () => {
    const park = parkWorld("park-records-issue-failing", { localAttempts: 3, failFiling: true });
    const before = park.state();
    park.w.ticks(6);
    expect(park.creates().length).toBeGreaterThanOrEqual(1);
    expect(park.creates().length).toBeLessThanOrEqual(3);
    expect(park.w.log.some((line) => line.includes("park is unchanged") && line.includes("not authenticated"))).toBe(true);
    expect(park.state()).toEqual(before);
    expect(park.w.planAction(park.w.repo, PARKED)).toBe("open");
  }, SCENARIO_TIMEOUT_MS);

  it("an unresolvable repository only logs a bounded failed attempt and files nothing", () => {
    const park = parkWorld("park-records-issue-norepo", { localAttempts: 3, noRepo: true });
    const before = park.state();
    park.w.ticks(6);
    expect(park.creates()).toHaveLength(0);
    expect(park.w.log.filter((line) => line.includes("no GitHub repository could be resolved")).length).toBeLessThanOrEqual(3);
    expect(park.w.log.some((line) => line.includes("no GitHub repository could be resolved"))).toBe(true);
    expect(park.state()).toEqual(before);
  }, SCENARIO_TIMEOUT_MS);

  it("a retry after a create that failed but reached GitHub adopts the existing Issue and files no second one", () => {
    const park = parkWorld("park-records-issue-adopt", { localAttempts: 3, phantomFirst: true });
    park.w.ticks(5);
    expect(park.creates()).toHaveLength(1);
    expect(park.ghCalls.some((call) => call.args[1] === "list" && call.args.includes("--repo"))).toBe(true);
    expect(park.w.log.some((line) => line.includes("Filed https://github.com/example/repo/issues/9001"))).toBe(true);
  }, SCENARIO_TIMEOUT_MS);

  it("files one NEW Issue for a re-park after reset-repair-budget (a new episode)", () => {
    const park = parkWorld("park-records-issue-repark", { localAttempts: 3 });
    park.w.ticks(2);
    expect(park.creates()).toHaveLength(1);
    // The operator resets the budget (clearing the hold), and the Action parks again before the next tick.
    withDatabase(park.w.workspace, (db) => { resetProductionRepairBudget(db, park.key); });
    expect(park.state().escalation).toBeUndefined();
    park.park(new Date(park.w.now.getTime() + 10 * 60_000));
    park.w.ticks(3);
    expect(park.creates()).toHaveLength(2);
    expect(park.bodies[0]).not.toEqual(park.bodies[1]);
  }, SCENARIO_TIMEOUT_MS);

  it("files nothing while production is Off, even with a valid parked row", () => {
    const park = parkWorld("park-records-issue-off", { localAttempts: 3 });
    park.w.deactivate();
    park.w.ticks(3);
    expect(park.ghCalls).toHaveLength(0);
  }, SCENARIO_TIMEOUT_MS);

  it("files nothing for a stale row whose Action is done in the checked-in Plan", () => {
    const park = parkWorld("park-records-issue-done", { localAttempts: 3 });
    const planFile = path.join(park.w.repo, "docs", "plans", readdirPlan(park.w.repo));
    const text = readFileSync(planFile, "utf8");
    const block = text.split(`  - id: ${PARKED}\n`);
    expect(block).toHaveLength(2);
    writeFileSync(planFile, `${block[0]}  - id: ${PARKED}\n${(block[1] ?? "").replace("status: open", "status: done")}`);
    withDatabase(park.w.workspace, (db) => recordRepairBudgetParkIssues(db, {
      projectSlug: park.w.projectSlug, repoRoot: park.w.repo, now: park.w.now, runCommand: park.runner
    }));
    expect(park.ghCalls).toHaveLength(0);
    // Control: the same direct call files once while the Action is still open.
    writeFileSync(planFile, text);
    withDatabase(park.w.workspace, (db) => recordRepairBudgetParkIssues(db, {
      projectSlug: park.w.projectSlug, repoRoot: park.w.repo, now: park.w.now, runCommand: park.runner
    }));
    expect(park.creates()).toHaveLength(1);
  }, SCENARIO_TIMEOUT_MS);

  it("does no doc discovery and no gh calls on later ticks once the Issue is recorded or attempts are exhausted", () => {
    for (const failFiling of [false, true]) {
      const park = parkWorld(`park-records-issue-cheap-${failFiling ? "exhausted" : "recorded"}`, { localAttempts: 3, failFiling });
      let planReads = 0;
      let tick = 0;
      const sweep = () => {
        tick += 1;
        withDatabase(park.w.workspace, (db) => recordRepairBudgetParkIssues(db, {
          projectSlug: park.w.projectSlug, repoRoot: park.w.repo, now: new Date(park.w.now.getTime() + tick * 60_000), runCommand: park.runner,
          actionStillOpen: () => { planReads += 1; return true; }
        }));
      };
      // Drive to the settled state: one successful Issue, or the 3 bounded failed attempts.
      for (let i = 0; i < 4; i += 1) sweep();
      const readsSettled = planReads;
      const callsSettled = park.ghCalls.length;
      expect(readsSettled).toBe(failFiling ? 3 : 1);
      for (let i = 0; i < 5; i += 1) sweep();
      expect(planReads).toBe(readsSettled);
      expect(park.ghCalls).toHaveLength(callsSettled);
      world?.dispose(); isolation?.restore();
    }
  }, SCENARIO_TIMEOUT_MS);

  it("files nothing for a global-cause exhaustion", () => {
    const park = parkWorld("park-records-issue-global", { localAttempts: 0 });
    park.w.ticks(3);
    expect(park.creates()).toHaveLength(0);
  }, SCENARIO_TIMEOUT_MS);

  it("files nothing for another held kind", () => {
    const park = parkWorld("park-records-issue-otherkind", { localAttempts: 3, kind: "completion_loopback_denied" });
    park.w.ticks(3);
    expect(park.creates()).toHaveLength(0);
  }, SCENARIO_TIMEOUT_MS);
});

/** The one Plan document the fixture checks in. */
function readdirPlan(repo: string): string {
  const files = readdirSync(path.join(repo, "docs", "plans")).filter((name) => name.endsWith(".md"));
  expect(files).toHaveLength(1);
  return files[0] ?? "";
}
