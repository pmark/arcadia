import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { integrateFirstAction } from "./helpers/stacked.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Stacked PR bases (Issue #987) when an open PR for the candidate's branch
 * already exists on a base that is no longer a valid choice (for example one
 * opened on `main` before the previous Action integrated). Preservation
 * refuses before anything is pushed, and the tick's pre-check refuses before
 * host validation, so the blocked candidate is never re-validated.
 */
let isolation: IsolatedProcess;
let w: FastRehearsal;
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  w?.dispose();
  isolation?.restore();
});

describe("an open PR for the candidate's branch sits on a no-longer-valid base", () => {
  it("refuses without re-validating, escalates once, and preserves onto that PR once it is retargeted", () => {
    w = new FastRehearsal("stacked-base-existing-pr-mismatch", isolation, import.meta.filename);
    w.start();
    w.expectError(/is opened against main, but this candidate's base revision/);
    const { one, remoteMain } = integrateFirstAction(w);
    const previous = w.gh.prs[0].branch;
    const { session, launch } = w.untilLaunched(ACTION_2, 4);
    // An open PR for Action 2's branch, on main (opened before Action 1 integrated, by a person or an earlier preservation).
    const number = 7 + w.gh.prs.length;
    w.gh.prs.push({ number, url: `https://github.com/pmark/rehearsal/pull/${number}`, branch: session.branch, baseBranch: "main", isDraft: true });
    const two = w.execute(launch, ACTION_2);
    const validationsBefore = w.hostValidations;
    const pushesBefore = w.github.pushes.length;
    const blocked = w.ticks(4);
    for (const tick of blocked) {
      expect(tick.handoff?.preservation).toMatchObject({ kind: "refused", reason: expect.stringContaining(`is opened against main, but this candidate's base revision ${one.finalHead} selects ${previous}`) });
    }
    expect(w.hostValidations).toBe(validationsBefore);
    expect(w.github.pushes.slice(pushesBefore)).toEqual([]);
    const { data } = w.productionStatus();
    expect(data.operatorEscalations).toHaveLength(1);
    expect(data.operatorEscalations[0]).toMatchObject({ actionKey: w.actionKey(ACTION_2), kind: "terminal_candidate_not_integrable" });
    expect(data.operatorEscalations[0].remedy).toContain(`gh pr edit ${number} --base ${previous}`);

    // The remedy: retarget the PR; the next preservation updates its body and reviews it.
    w.gh.prs.find((pr) => pr.number === number)!.baseBranch = previous;
    w.untilIntegrated(ACTION_2);
    expect(w.github.prCreates).toEqual([{ branch: previous, baseBranch: "main" }]);
    expect(w.preservationReceipt(ACTION_2)).toMatchObject({ pullRequestNumber: number, prBase: { kind: "stacked", branch: previous, tip: one.finalHead } });
    expect(w.gh.bodies.get(`https://github.com/pmark/rehearsal/pull/${number}`)).toContain(`- **Base:** \`${previous}\` at \`${one.finalHead}\``);
    expect(git(w.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(two.finalHead);
    expect(w.sessions().map((s) => s.action_id)).toEqual([ACTION_1, ACTION_2]);
    expect(w.escalations()).toEqual([]);
    expect(w.github.headOf("main")).toBe(remoteMain);
    expect(isolation.guardCalls()).toEqual([]);
    expect(w.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
