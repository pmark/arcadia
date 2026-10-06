import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * It also reproduces Issue #987 end to end: after Action 1 integrates
 * locally, Action 2's PR is opened against the remote's `main`, which the
 * worker never pushes, so the PR's base and changed files disagree with the
 * host-rendered Operator QA plan in its own body.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
let one: ExecutorResult;
let two: ExecutorResult;
let report: ScenarioReport;
/** Action 2's PR the moment its terminal preservation opened it: the plan in its body and what GitHub reports. */
let action2Pr: { body: string; baseRefOid: string; files: string[] };
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
  action2Pr = { body: view.body, baseRefOid: view.baseRefOid, files: view.files.map((file) => file.path).sort() };

  const claims = planClaims(action2Pr.body);
  world.recorder.notes.push(`Issue #987, Action 2's PR: plan base ${String(claims.baseRevision)} vs PR base ${action2Pr.baseRefOid}; `
    + `plan lists ${claims.files.length} files, the PR ${action2Pr.files.length} (${action2Pr.files.filter((file) => !claims.files.includes(file)).join(", ")} extra)`);

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

/** The host-rendered Operator QA plan's claims (src/sessions/operatorQaPlan.ts): its base revision and Step 2's changed files. */
function planClaims(body: string): { baseRevision: string | null; files: string[] } {
  const base = /^- \*\*Base:\*\* `[^`]+` at `([0-9a-f]{40})`$/m.exec(body)?.[1] ?? null;
  const step2 = body.slice(body.indexOf("### Step 2"), body.indexOf("### Step 3"));
  const files = [...step2.matchAll(/^ {2}- `[A-Z][0-9]*` `([^`]+)`$/gm)].map((match) => match[1]).sort();
  return { baseRevision: base, files };
}

describe("Issue #987: a serial Action's PR is judged against GitHub's unadvanced base", () => {
  it("records what the plan says and what the PR reports for Action 2 (today: they differ)", () => {
    const plan = planClaims(action2Pr.body);
    // The plan is rendered against the local base Action 2 started from: Action 1's integrated head.
    expect(plan.baseRevision).toBe(baseAfterAction1);
    expect(plan.files).toEqual(expect.arrayContaining(["MARKER.md", "tests/marker.test.mjs"]));
    // GitHub reports the remote's main, which local integration never moved...
    expect(action2Pr.baseRefOid).toBe(remoteMain);
    expect(action2Pr.baseRefOid).not.toBe(plan.baseRevision);
    // ...so the PR's changed files also carry Action 1's settlement records.
    const extra = action2Pr.files.filter((file) => !plan.files.includes(file));
    expect(extra.length).toBeGreaterThan(0);
    expect(extra).toEqual(expect.arrayContaining([expect.stringMatching(/^\.arcadia\/asks\/archive\/agent-ask-complete-write-marker-a-/)]));
  });

  // EXPECTED FAILURE (Issue #987). `it.fails` passes while the plan and the PR
  // disagree; the fix of #987 makes this body pass, which fails the marker:
  // then change `it.fails` to `it`.
  it.fails("the host QA plan's base and changed files equal the PR's base and files as GitHub reports them", () => {
    const plan = planClaims(action2Pr.body);
    expect(plan.baseRevision).toBe(action2Pr.baseRefOid);
    expect(plan.files).toEqual(action2Pr.files);
  });
});
