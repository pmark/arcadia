import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkQaPlanConsistency, parseRenderedPlan, type QaPlanConsistencyReport } from "../../scripts/qa-plan-consistency.js";
import { git, LINE_A, LINE_B } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import { PHASES, type ScenarioReport } from "./helpers/report.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * The baseline scenario: two dependent Actions from one activation, the clean
 * executor, the real lifecycle end to end. Action 1 is admitted, built,
 * settled in its candidate, preserved as a draft PR, readied with its settled
 * head, judged by both reviewers and integrated by local fast-forward; the
 * pointer and queue advance and Action 2 is admitted on the new base and goes
 * through the same path. The run happens once (beforeAll); each test below
 * reads what it left.
 *
 * It also proves Issue #987's fix (the operator's decision: stack the PRs).
 * After Action 1 integrates locally, the remote's `main`, which the worker
 * never pushes, stays behind, so Action 2's draft PR is opened against
 * Action 1's candidate branch, whose tip is Action 2's launch base: GitHub's
 * diff, the reviewers' evidence and the host-rendered Operator QA plan in the
 * PR body then all describe exactly Action 2's change. Live run 5 stopped at
 * QA because its PR was opened on `main` instead; the companion pin below
 * keeps that shape measurable. Measured with the checkpoint-replay check
 * (scripts/qa-plan-consistency.ts, docs/qa-plan-consistency-replay.md) and by
 * comparing the published plan with the PR directly.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
let one: ExecutorResult;
let two: ExecutorResult;
let report: ScenarioReport;
/** Action 2's PR the moment its terminal preservation opened it: the plan its body publishes, and the replay check against GitHub's view. */
let published: ReturnType<typeof parseRenderedPlan>;
let consistency: QaPlanConsistencyReport;
let action2View: { baseRefName: string; baseRefOid: string; headRefOid: string; files: Array<{ path: string; changeType: string }> };
/** What GitHub would report for the same head on the remote's unadvanced `main` (the pre-fix PR of run 5). */
let onMain: QaPlanConsistencyReport;
let action2Base = "";
let baseAfterAction1 = "";
let remoteMain = "";

beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("serial-two-action-clean", isolation, import.meta.filename);
  world.start();
  remoteMain = world.github.headOf("main");

  const first = world.untilLaunched(ACTION_1, 3);
  one = world.execute(first.launch, ACTION_1);
  world.untilIntegrated(ACTION_1);
  baseAfterAction1 = git(world.repo, ["rev-parse", "refs/heads/main"]).trim();

  const second = world.untilLaunched(ACTION_2, 4);
  two = world.execute(second.launch, ACTION_2);
  // The terminal tick reconciles and preserves Action 2: its draft PR exists now.
  world.tickUntil((r) => r.handoff?.preservation.kind === "preserved", 2);
  const pr = world.pullRequestFor(ACTION_2)!;
  const view = world.gh.view(pr);
  published = parseRenderedPlan(view.body);
  action2View = { baseRefName: view.baseRefName, baseRefOid: view.baseRefOid, headRefOid: view.headRefOid, files: view.files };
  action2Base = second.session.base_revision;
  consistency = checkQaPlanConsistency({
    repositoryPath: world.repo, pullRequest: view, base: action2Base, baseSource: "Action 2 Session's launch base", branch: pr.branch
  });
  onMain = checkQaPlanConsistency({
    repositoryPath: world.repo,
    pullRequest: { ...view, baseRefName: "main", baseRefOid: remoteMain, files: world.gh.files(remoteMain, view.headRefOid) },
    base: action2Base, branch: pr.branch, baseBranch: view.baseRefName
  });
  world.recorder.notes.push(`Issue #987, Action 2's PR stacked on ${view.baseRefName} (qa-plan-consistency): ${consistency.consistent ? "consistent" : `mismatches ${JSON.stringify(consistency.mismatches)}`}`);

  world.untilIntegrated(ACTION_2);
  world.ticks(2);
  report = world.finish();
}, SCENARIO_TIMEOUT_MS);

afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("fast rehearsal: serial two-Action run, clean executor", () => {
  it("admits, builds, preserves, readies, reviews and integrates Action 1, then Action 2, each exactly once", () => {
    expect(one.brief).toMatchObject({ project: world.projectSlug, action: ACTION_1, continuation: false });
    expect(one.brief.criteria).toHaveLength(1);
    expect([one.statusAtExit, two.statusAtExit]).toEqual(["", ""]);
    expect(world.planAction(world.repo, ACTION_1)).toBe("done");
    expect(world.planAction(world.repo, ACTION_2)).toBe("done");
    expect(readFileSync(path.join(world.repo, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n`);
    // Action 2 started from the integrated base, and nothing was admitted after it.
    expect(world.sessions().find((s) => s.action_id === ACTION_2)?.base_revision).toBe(baseAfterAction1);
    expect(world.sessions().map((s) => s.action_id)).toEqual([ACTION_1, ACTION_2]);
    expect(world.tmux.launches).toHaveLength(2);
    expect(report.tickLog.slice(-2).every((tick) => !tick.summary.includes("launch launched"))).toBe(true);
    // No commit lost: both settled heads are on the base, which ends at Action 2's.
    for (const result of [one, two]) git(world.repo, ["merge-base", "--is-ancestor", result.finalHead, "refs/heads/main"]);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(two.finalHead);
    for (const actionId of [ACTION_1, ACTION_2]) {
      const lineage = world.attempts(actionId);
      expect(lineage.filter((x) => x.role === "development").map((x) => x.status)).toEqual(["passed"]);
      expect(lineage.filter((x) => x.role === "code-review" || x.role === "qa").map((x) => [x.role, x.status])).toEqual([["code-review", "passed"], ["qa", "passed"]]);
    }
  });

  it("readies each PR once with its settled head, never merges on GitHub and never pushes the base", () => {
    expect(world.gh.prs.map((pr) => pr.isDraft)).toEqual([false, false]);
    expect(world.github.readyCalls).toEqual(world.gh.prs.map((pr) => pr.url));
    expect(world.github.ghCalls.some((call) => / merge\b/.test(call))).toBe(false);
    expect(world.github.headOf("main")).toBe(remoteMain);
    expect(world.github.pushes.map((push) => push.branch)).not.toContain("main");
    for (const [index, result] of [one, two].entries()) expect(world.github.headOf(world.gh.prs[index].branch)).toBe(result.finalHead);
  });

  it("leaves production clean: no live admission, no escalation, and no real gh, tmux or provider binary ever ran", () => {
    expect(world.status().liveAdmissions).toBe(0);
    expect(world.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });

  it("reports every phase for both Actions", () => {
    expect(report.actions.map((action) => [action.actionId, action.outcome])).toEqual([[ACTION_1, "integrated"], [ACTION_2, "integrated"]]);
    for (const action of report.actions) {
      for (const phase of ["queueWait", "validation", "gitFinalization", "review", "integration", "advancement"] as const) {
        expect(action.phases[phase].ms, `${action.actionId} ${phase}`).toBeGreaterThan(0);
      }
      expect(Object.keys(action.phases)).toEqual([...PHASES]);
    }
    expect(report.tickLog.filter((tick) => tick.phase === "integration")).toHaveLength(2);
  });
});

describe("Issue #987 (fixed: stacked PRs): a serial Action's PR is stacked on the previous candidate branch", () => {
  it("opens Action 1's PR on main and Action 2's on Action 1's branch, and records why on each receipt", () => {
    const [first, second] = world.gh.prs;
    expect(world.github.prCreates).toEqual([{ branch: first.branch, baseBranch: "main" }, { branch: second.branch, baseBranch: first.branch }]);
    expect(world.preservationReceipt(ACTION_1)?.prBase).toEqual({
      kind: "project", branch: "main", tip: remoteMain, reason: `The candidate's base revision ${remoteMain.slice(0, 12)} is the tip of main on the remote.`
    });
    const stacked = world.preservationReceipt(ACTION_2);
    expect(stacked?.baseBranch).toBe("main");
    expect(stacked?.prBase).toMatchObject({ kind: "stacked", branch: first.branch, tip: baseAfterAction1 });
    expect(stacked?.prBase?.reason).toContain(`${first.branch} is the remote candidate branch whose tip is ${baseAfterAction1.slice(0, 12)}`);
    // Action 1's branch tip is its settled head, which local integration made the base.
    expect(one.finalHead).toBe(baseAfterAction1);
  });

  it("the published QA plan's base and changed files equal the PR's base and files as GitHub reports them", () => {
    // The published plan is the host renderer's: the replay re-renders exactly the same claims.
    expect(consistency.plan.baseRevision).toBe(published.baseRevision);
    expect(consistency.plan.files).toEqual(published.files);
    expect(published.baseRevision).toBe(action2Base);
    expect(published.baseRevision).toBe(baseAfterAction1);
    expect(published.baseBranch).toBe(world.gh.prs[0].branch);
    expect(published.baseBranch).toBe(action2View.baseRefName);
    expect(published.baseRevision).toBe(action2View.baseRefOid);
    expect(published.fileCount).toBe(action2View.files.length);
    expect(published.files.map((file) => file.path).sort()).toEqual(action2View.files.map((file) => file.path).sort());
    expect(published.files.map((file) => file.path)).toEqual(expect.arrayContaining(["MARKER.md", "tests/marker.test.mjs"]));
    expect(published.files.some((file) => file.path.includes("agent-ask-complete-write-marker-a-"))).toBe(false);
    expect(consistency.consistent).toBe(true);
    expect(consistency.mismatches).toEqual([]);
  });

  // The pre-fix shape, kept measurable: had Action 2's PR been opened on the
  // remote's unadvanced main (run 5's PR #6), GitHub would report Action 1's
  // settlement record too and Action 1's files as ADDED.
  it("pins what a PR on the unadvanced main would report: run 5's mismatch", () => {
    expect(onMain.consistent).toBe(false);
    expect(onMain.mismatches).toEqual([
      { check: "base-branch", plan: world.gh.prs[0].branch, pullRequest: "main" },
      { check: "base-revision", plan: baseAfterAction1, pullRequest: remoteMain },
      { check: "file-count", plan: published.fileCount, pullRequest: published.fileCount + 1 },
      { check: "files", onlyInPlan: [], onlyInPullRequest: [expect.stringMatching(/^\.arcadia\/asks\/archive\/agent-ask-complete-write-marker-a-/)] },
      { check: "file-status", differences: expect.arrayContaining([{ path: "MARKER.md", plan: "M", pullRequest: "ADDED" }]) }
    ]);
  });
});
