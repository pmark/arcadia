import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { integrateFirstAction, preserveSecondAction } from "./helpers/stacked.js";
import { ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Stacked PR bases (Issue #987) when the stacked PR's base changes on GitHub
 * after host preservation opened it: retargeted to another branch (GitHub does
 * so when its base branch is deleted after a merge; a person may too), or the
 * stacked base branch's tip moved.
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

function world(name: string): FastRehearsal {
  const created = new FastRehearsal(name, isolation, import.meta.filename);
  worlds.push(created);
  created.start();
  return created;
}

describe("the stacked PR was retargeted on GitHub after it was opened", () => {
  it("withholds every verdict with one escalation naming the base its plan describes, and resumes once retargeted back", () => {
    const w = world("stacked-base-pr-retargeted");
    const { remoteMain } = integrateFirstAction(w);
    const previous = w.gh.prs[0].branch;
    preserveSecondAction(w);
    const stacked = w.pullRequestFor(ACTION_2)!;
    expect(stacked.baseBranch).toBe(previous);
    // GitHub retargets a PR whose base branch is deleted after a merge; a person may too.
    stacked.baseBranch = "main";
    const reviewersBefore = w.github.reviewerCalls.length;
    w.ticks(3);
    expect(w.github.reviewerCalls.length).toBe(reviewersBefore);
    const { data } = w.productionStatus();
    expect(data.operatorEscalations).toHaveLength(1);
    expect(data.operatorEscalations[0]).toMatchObject({ actionKey: w.actionKey(ACTION_2), kind: "review_pull_request_unavailable" });
    expect(data.operatorEscalations[0].message).toContain(`is now based on main, but host preservation opened it on ${previous}`);
    expect(data.operatorEscalations[0].remedy).toContain(`gh pr edit ${stacked.url} --base ${previous}`);

    stacked.baseBranch = previous;
    w.untilIntegrated(ACTION_2);
    expect(w.escalations()).toEqual([]);
    expect(w.github.headOf("main")).toBe(remoteMain);
    expect(isolation.guardCalls()).toEqual([]);
    expect(w.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

describe("the stacked base's tip moved after the PR was opened", () => {
  it("withholds every verdict while the base branch is not at the tip preservation chose (here: moved onto the candidate's own head), and resumes once restored", () => {
    const w = world("stacked-base-tip-moved");
    const { one, remoteMain } = integrateFirstAction(w);
    const previous = w.gh.prs[0].branch;
    const { two } = preserveSecondAction(w);
    expect(w.pullRequestFor(ACTION_2)!.baseBranch).toBe(previous);
    // Someone moves the previous candidate's branch onto Action 2's head: GitHub's diff would shrink to nothing.
    git(w.github.origin, ["update-ref", `refs/heads/${previous}`, w.github.headOf(w.pullRequestFor(ACTION_2)!.branch)]);
    expect(w.gh.view(w.pullRequestFor(ACTION_2)!).files.length).toBeLessThan(2);
    const reviewersBefore = w.github.reviewerCalls.length;
    w.ticks(3);
    expect(w.github.reviewerCalls.length).toBe(reviewersBefore);
    const { data } = w.productionStatus();
    expect(data.operatorEscalations).toHaveLength(1);
    expect(data.operatorEscalations[0]).toMatchObject({ actionKey: w.actionKey(ACTION_2), kind: "review_pull_request_unavailable" });
    expect(data.operatorEscalations[0].message).toContain(`stacked base ${previous} moved from ${one.finalHead.slice(0, 12)}`);
    expect(data.operatorEscalations[0].remedy).toContain(`Restore ${previous} on the remote to ${one.finalHead}`);

    git(w.github.origin, ["update-ref", `refs/heads/${previous}`, one.finalHead]);
    w.untilIntegrated(ACTION_2);
    expect(git(w.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(two.finalHead);
    expect(w.escalations()).toEqual([]);
    expect(w.github.headOf("main")).toBe(remoteMain);
    expect(isolation.guardCalls()).toEqual([]);
    expect(w.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
