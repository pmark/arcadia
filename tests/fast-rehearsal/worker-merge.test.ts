import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";
import { withReadOnlyDatabase } from "../../src/db/connection.js";
import { listWorkerMerges } from "../../src/production/workerMerge.js";

/**
 * The worker's automated review-and-merge (Decision 0097, Action
 * worker-review-and-merge) end to end: the activation's integration grant opts
 * in with `--integration-grant-merge-pull-request`, so after both independent
 * reviewers pass the exact settled head and every check is green, the tick
 * merges each fixture PR on the (fake) GitHub with `gh pr merge --merge
 * --match-head-commit <head>`, the local base moves onto the remote's merge
 * commit, and Action 2 launches from that merged main (merge-then-next): its
 * PR targets `main`, not a stacked candidate branch.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
let one: ExecutorResult;
let firstHead = "";
let firstUrl = "";
let mainAfterFirst = "";
let remoteMainAfterFirst = "";

beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("worker-merge-through-pull-request", isolation, import.meta.filename, { workerMerge: true });
  world.start();
  const first = world.untilLaunched(ACTION_1, 3);
  one = world.execute(first.launch, ACTION_1);
  world.untilIntegrated(ACTION_1, 10);
  const pr = world.pullRequestFor(ACTION_1)!;
  firstUrl = pr.url;
  firstHead = world.github.headOf(pr.branch);
  mainAfterFirst = git(world.repo, ["rev-parse", "refs/heads/main"]).trim();
  remoteMainAfterFirst = world.github.headOf("main");
  const second = world.untilLaunched(ACTION_2, 4);
  world.execute(second.launch, ACTION_2);
  world.untilIntegrated(ACTION_2, 10);
  world.ticks(2);
  world.finish();
}, SCENARIO_TIMEOUT_MS);

afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("worker merge through the pull request (Decision 0097)", () => {
  it("merges each fixture PR only through GitHub, pinned to its exact reviewed head", () => {
    const merges = world.github.ghCalls.filter((call) => call.startsWith("gh pr merge"));
    expect(merges).toHaveLength(2);
    expect(merges[0]).toBe(`gh pr merge ${firstUrl} --merge --match-head-commit ${firstHead}`);
    expect(world.github.mergeCalls.map((call) => call.merged)).toEqual([true, true]);
    expect(world.github.prs.map((pr) => pr.state)).toEqual(["MERGED", "MERGED"]);
    // Both reviewers judged exactly the merged head before the merge.
    const reviewed = world.github.reviewerCalls.filter((call) => call.url === firstUrl);
    expect(reviewed.map((call) => call.role).sort()).toEqual(["code-review", "qa"]);
    expect(reviewed.every((call) => call.head === firstHead)).toBe(true);
  });

  it("lands the base as GitHub's merge commit, never a local fast-forward of the candidate", () => {
    // The local base equals the remote's merge commit, whose second parent is the reviewed head.
    expect(mainAfterFirst).toBe(remoteMainAfterFirst);
    expect(mainAfterFirst).not.toBe(firstHead);
    expect(git(world.repo, ["rev-parse", `${mainAfterFirst}^2`]).trim()).toBe(firstHead);
    git(world.repo, ["merge-base", "--is-ancestor", one.workCommit, "refs/heads/main"]);
    // The worker never pushed the base branch itself.
    expect(world.github.pushes.filter((push) => push.branch === "main")).toEqual([]);
  });

  it("launches Action 2 from the merged main: its PR targets main, not a stacked branch", () => {
    expect(world.github.prs[1].baseBranch).toBe("main");
    expect(world.planAction(world.repo, ACTION_1)).toBe("done");
    expect(world.planAction(world.repo, ACTION_2)).toBe("done");
  });

  it("records each merge durably and leaves nothing for the operator", () => {
    const rows = withReadOnlyDatabase(world.workspace, (db) => listWorkerMerges(db));
    expect(rows.map((row) => row.outcome)).toEqual(["merged", "merged"]);
    expect(world.escalations()).toEqual([]);
    expect(world.redAlerts()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
  });
});
