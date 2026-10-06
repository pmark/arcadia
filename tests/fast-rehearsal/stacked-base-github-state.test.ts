import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { integrateFirstAction, mergeOnGitHub, preserveSecondAction } from "./helpers/stacked.js";
import { ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Stacked PR bases (Issue #987) when a person changed the previous PR on
 * GitHub after Action 1 integrated locally: closed it, or merged it.
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

describe("the previous PR was closed on GitHub (its branch kept)", () => {
  it("still stacks Action 2's PR on the previous candidate's branch and integrates it", () => {
    const w = world("stacked-base-previous-pr-closed");
    const { one, remoteMain } = integrateFirstAction(w);
    w.gh.prs[0].state = "CLOSED";

    const { launchBase, view, consistency } = preserveSecondAction(w);
    expect(launchBase).toBe(one.finalHead);
    expect(view).toMatchObject({ state: "OPEN", baseRefName: w.gh.prs[0].branch, baseRefOid: one.finalHead });
    expect(consistency.mismatches).toEqual([]);
    w.untilIntegrated(ACTION_2);
    expect(w.github.headOf("main")).toBe(remoteMain);
    expect(w.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(w.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

describe("the previous PR was merged on GitHub and its branch deleted", () => {
  it("launches Action 2 from the merged remote base (the tick fast-forwards onto it) and opens its PR on main, unchanged and consistent", () => {
    const w = world("stacked-base-previous-pr-merged");
    integrateFirstAction(w);
    const previous = w.gh.prs[0].branch;
    const merged = mergeOnGitHub(w, previous);
    w.gh.prs[0].state = "MERGED";
    git(w.github.origin, ["update-ref", "-d", `refs/heads/${previous}`]);

    const { launchBase, view, consistency } = preserveSecondAction(w);
    // The tick's base-branch observation fetches origin and fast-forwards the local main onto the merge.
    expect(launchBase).toBe(merged);
    expect(view).toMatchObject({ baseRefName: "main", baseRefOid: merged });
    expect(w.preservationReceipt(ACTION_2)?.prBase).toEqual({
      kind: "project", branch: "main", tip: merged, reason: `The candidate's base revision ${merged.slice(0, 12)} is the tip of main on the remote.`
    });
    expect(consistency.mismatches).toEqual([]);
    w.untilIntegrated(ACTION_2);
    // The worker pushed only candidate branches; main moved only by the GitHub merge.
    expect(w.github.pushes.map((push) => push.branch)).not.toContain("main");
    expect(w.github.headOf("main")).toBe(merged);
    expect(w.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(w.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
