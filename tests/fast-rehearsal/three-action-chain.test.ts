import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkQaPlanConsistency, parseRenderedPlan, type QaPlanConsistencyReport } from "../../scripts/qa-plan-consistency.js";
import { git, LINE_A, LINE_B, LINE_C } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import { PHASES, type ScenarioReport } from "./helpers/report.js";
import { ACTION_1, ACTION_2, ACTION_3, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * A three-Action chain through the real lifecycle (Issue #987's fix: stacked
 * PRs). Three dependent Actions from one activation; each integrates by local
 * fast-forward and the remote's `main` is never pushed, so each later PR is
 * stacked on the previous candidate's branch: PR 1 on `main`, PR 2 on
 * candidate 1, PR 3 on candidate 2. Each PR's published Operator QA plan must
 * agree with its GitHub diff (scripts/qa-plan-consistency.ts), each Action is
 * admitted exactly once, no commit is lost, and all three integrate locally.
 * The run happens once (beforeAll); each test reads what it left.
 */
const ACTIONS = [ACTION_1, ACTION_2, ACTION_3] as const;
let isolation: IsolatedProcess;
let world: FastRehearsal;
let report: ScenarioReport;
let remoteMain = "";
const results: ExecutorResult[] = [];
/** Per Action, at the moment its terminal preservation opened its PR. */
const opened: Array<{ launchBase: string; baseAfter: string; view: ReturnType<FastRehearsal["gh"]["view"]>; consistency: QaPlanConsistencyReport; published: ReturnType<typeof parseRenderedPlan> }> = [];

beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("three-action-chain-stacked", isolation, import.meta.filename, { thirdAction: true });
  world.start();
  remoteMain = world.github.headOf("main");
  for (const [index, actionId] of ACTIONS.entries()) {
    const { session, launch } = world.untilLaunched(actionId, index === 0 ? 3 : 4);
    results.push(world.execute(launch, actionId));
    world.tickUntil((r) => r.handoff?.preservation.kind === "preserved", 2);
    const pr = world.pullRequestFor(actionId)!;
    const view = world.gh.view(pr);
    const consistency = checkQaPlanConsistency({
      repositoryPath: world.repo, pullRequest: view, base: session.base_revision, baseSource: `${actionId} Session's launch base`, branch: pr.branch
    });
    world.recorder.notes.push(`${actionId}: PR on ${view.baseRefName} (qa-plan-consistency ${consistency.consistent ? "consistent" : JSON.stringify(consistency.mismatches)})`);
    world.untilIntegrated(actionId);
    opened.push({ launchBase: session.base_revision, baseAfter: git(world.repo, ["rev-parse", "refs/heads/main"]).trim(), view, consistency, published: parseRenderedPlan(view.body) });
  }
  world.ticks(2);
  report = world.finish();
}, SCENARIO_TIMEOUT_MS);

afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("fast rehearsal: a three-Action chain with stacked PRs", () => {
  it("stacks every PR on the previous candidate branch: PR 1 on main, PR 2 on candidate 1, PR 3 on candidate 2", () => {
    const branches = world.gh.prs.map((pr) => pr.branch);
    expect(branches).toHaveLength(3);
    expect(world.github.prCreates).toEqual([
      { branch: branches[0], baseBranch: "main" },
      { branch: branches[1], baseBranch: branches[0] },
      { branch: branches[2], baseBranch: branches[1] }
    ]);
    expect(ACTIONS.map((actionId) => world.preservationReceipt(actionId)?.prBase?.kind)).toEqual(["project", "stacked", "stacked"]);
    // Each later launch base is the previous Action's settled head, which is its branch tip on the remote.
    expect(opened[0].launchBase).toBe(remoteMain);
    for (const index of [1, 2]) {
      expect(opened[index].launchBase).toBe(results[index - 1].finalHead);
      expect(opened[index].view).toMatchObject({ baseRefName: branches[index - 1], baseRefOid: results[index - 1].finalHead });
    }
  });

  it("publishes, in every PR, a QA plan whose base and changed files equal the PR's as GitHub reports them", () => {
    for (const [index, entry] of opened.entries()) {
      expect(entry.consistency.mismatches, ACTIONS[index]).toEqual([]);
      expect(entry.consistency.consistent).toBe(true);
      expect(entry.published).toMatchObject({ baseBranch: entry.view.baseRefName, baseRevision: entry.view.baseRefOid, commit: entry.view.headRefOid, fileCount: entry.view.files.length });
      expect(entry.published.files.map((file) => file.path).sort()).toEqual(entry.view.files.map((file) => file.path).sort());
      // Only this Action's settlement record is in its diff, never an earlier one's.
      const archived = entry.view.files.filter((file) => file.path.startsWith(".arcadia/asks/archive/")).map((file) => file.path);
      expect(archived, ACTIONS[index]).toEqual([expect.stringContaining(`agent-ask-complete-${ACTIONS[index]}-`)]);
    }
  });

  it("admits each Action exactly once, integrates all three locally and loses no commit", () => {
    expect(world.sessions().map((s) => s.action_id)).toEqual([...ACTIONS]);
    expect(world.tmux.launches).toHaveLength(3);
    for (const actionId of ACTIONS) expect(world.planAction(world.repo, actionId)).toBe("done");
    expect(readFileSync(path.join(world.repo, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n${LINE_C}\n`);
    for (const result of results) git(world.repo, ["merge-base", "--is-ancestor", result.finalHead, "refs/heads/main"]);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(results[2].finalHead);
    expect(opened.map((entry) => entry.baseAfter)).toEqual(results.map((result) => result.finalHead));
    for (const actionId of ACTIONS) {
      const lineage = world.attempts(actionId);
      expect(lineage.filter((x) => x.role === "development").map((x) => x.status)).toEqual(["passed"]);
      expect(lineage.filter((x) => x.role === "code-review" || x.role === "qa").map((x) => [x.role, x.status])).toEqual([["code-review", "passed"], ["qa", "passed"]]);
    }
    expect(report.tickLog.slice(-2).every((tick) => !tick.summary.includes("launch launched"))).toBe(true);
  });

  it("never pushes or merges the remote base and never force pushes", () => {
    expect(world.github.headOf("main")).toBe(remoteMain);
    expect(world.github.pushes.map((push) => push.branch)).not.toContain("main");
    expect(world.github.ghCalls.some((call) => / merge\b/.test(call))).toBe(false);
    expect(world.github.readyCalls).toEqual(world.gh.prs.map((pr) => pr.url));
    // Every push is a plain `git push` (the adapter has no force flag; a non-fast-forward would fail the scenario), and each tip is its settled head.
    for (const [index, pr] of world.gh.prs.entries()) expect(world.github.headOf(pr.branch)).toBe(results[index].finalHead);
  });

  it("leaves production clean and reports every phase for all three Actions", () => {
    expect(world.status().liveAdmissions).toBe(0);
    expect(world.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
    expect(report.actions.map((action) => [action.actionId, action.outcome])).toEqual(ACTIONS.map((actionId) => [actionId, "integrated"]));
    for (const action of report.actions) expect(Object.keys(action.phases)).toEqual([...PHASES]);
    expect(report.tickLog.filter((tick) => tick.phase === "integration")).toHaveLength(3);
  });
});
