import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { integrateFirstAction, preserveSecondAction } from "./helpers/stacked.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Stacked PR bases (Issue #987) where no stacking is possible or needed:
 * the previous candidate's branch is gone from the remote (refused, one
 * escalation, nothing pushed; restoring the branch recovers), and the base was
 * published by the operator (the PR opens on main, exactly as before).
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

describe("the previous candidate's branch was deleted on the remote", () => {
  it("refuses Action 2's PR with one escalation naming the blocker and remedy, pushes nothing, and recovers once the branch is restored", () => {
    const w = world("stacked-base-previous-branch-deleted");
    w.expectError(/No remote branch can be this candidate's pull-request base/);
    const { one, remoteMain, localMain } = integrateFirstAction(w);
    const previous = w.gh.prs[0].branch;
    // GitHub's "automatically delete head branches", or a person, removes it.
    git(w.github.origin, ["update-ref", "-d", `refs/heads/${previous}`]);

    const { session, launch } = w.untilLaunched(ACTION_2, 4);
    const two = w.execute(launch, ACTION_2);
    const pushesBefore = w.github.pushes.length;
    const validationsBefore = w.hostValidations;
    const blocked = w.ticks(5);
    // The stacked-base pre-check refuses before host validation: a blocked candidate is never re-validated.
    expect(w.hostValidations).toBe(validationsBefore);
    for (const tick of blocked) {
      expect(tick.handoff?.preservation).toMatchObject({ kind: "refused", reason: expect.stringContaining("No remote branch can be this candidate's pull-request base") });
      expect(tick.launch?.outcome).not.toBe("launched");
    }
    expect(w.gh.prs).toHaveLength(1);
    expect(w.github.prCreates).toEqual([{ branch: previous, baseBranch: "main" }]);
    expect(w.github.pushes.slice(pushesBefore)).toEqual([]);
    expect(w.github.headOf("main")).toBe(remoteMain);
    // Local preservation remains: the candidate's settled head is on its branch, untouched.
    expect(git(w.repo, ["rev-parse", `refs/heads/${session.branch}`]).trim()).toBe(two.finalHead);
    expect(git(w.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(localMain);
    expect(w.log.filter((line) => line.includes("Escalated") && line.includes("terminal_candidate_not_integrable"))).toHaveLength(1);

    const { data, text } = w.productionStatus();
    expect(data.operatorEscalations).toHaveLength(1);
    const escalation = data.operatorEscalations[0];
    expect(escalation).toMatchObject({ actionKey: w.actionKey(ACTION_2), kind: "terminal_candidate_not_integrable" });
    expect(escalation.message).toContain(`its base revision ${localMain} is not on the remote main`);
    expect(escalation.remedy).toContain(`git -C ${w.repo} push origin ${previous}`);
    expect(escalation.remedy).toContain(`push origin ${localMain}:refs/heads/agent/stack-base-${localMain.slice(0, 12)}`);
    expect(escalation.remedy).toContain("the worker never pushes the base");
    expect(text).toContain(`${w.actionKey(ACTION_2)} [terminal_candidate_not_integrable]`);

    // The operator's remedy: push the previous candidate's branch again.
    git(w.repo, ["push", "-q", "origin", previous]);
    w.tickUntil((r) => r.handoff?.preservation.kind === "preserved", 2);
    const pr = w.pullRequestFor(ACTION_2)!;
    expect(pr.baseBranch).toBe(previous);
    expect(w.preservationReceipt(ACTION_2)?.prBase).toMatchObject({ kind: "stacked", branch: previous, tip: one.finalHead });
    w.untilIntegrated(ACTION_2);
    expect(git(w.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(two.finalHead);
    expect(w.sessions().map((s) => s.action_id)).toEqual([ACTION_1, ACTION_2]);
    expect(w.tmux.launches).toHaveLength(2);
    expect(w.escalations()).toEqual([]);
    expect(w.github.headOf("main")).toBe(remoteMain);
    expect(w.github.pushes.map((push) => push.branch)).not.toContain("main");
    expect(isolation.guardCalls()).toEqual([]);
    expect(w.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

describe("the operator published the integrated base before Action 2 preserved", () => {
  it("opens Action 2's PR on main exactly as before stacking existed, consistent with its plan", () => {
    const w = world("stacked-base-published-base");
    const { localMain } = integrateFirstAction(w);
    git(w.repo, ["push", "-q", "origin", "main"]);
    const remoteMain = w.github.headOf("main");
    expect(remoteMain).toBe(localMain);

    const { launchBase, view, consistency } = preserveSecondAction(w);
    expect(launchBase).toBe(remoteMain);
    expect(view).toMatchObject({ baseRefName: "main", baseRefOid: remoteMain });
    expect(w.github.prCreates.map((entry) => entry.baseBranch)).toEqual(["main", "main"]);
    expect(w.preservationReceipt(ACTION_2)?.prBase).toEqual({
      kind: "project", branch: "main", tip: remoteMain, reason: `The candidate's base revision ${remoteMain.slice(0, 12)} is the tip of main on the remote.`
    });
    expect(consistency.mismatches).toEqual([]);
    w.untilIntegrated(ACTION_2);
    expect(w.escalations()).toEqual([]);
    expect(w.github.headOf("main")).toBe(remoteMain);
    expect(isolation.guardCalls()).toEqual([]);
    expect(w.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
