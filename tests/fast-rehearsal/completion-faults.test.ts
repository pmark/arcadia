import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { expectAdvancedExactlyOnce } from "./helpers/assertions.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Failure injection at the completion boundary: interruptions and step errors
 * (Git command failures are in git-faults.test.ts; split so the files run in
 * parallel). Each scenario breaks Action 1's finish at one point and then
 * lets the real lifecycle recover on its own. Faults are in-process (a thrown
 * error, a failing Git shim), not process kills: cleanup a killed process
 * would skip still runs. "Advances exactly once" means: Action 1 is
 * integrated once, with the agent's work commit on the base (no lost
 * commit), and Action 2 is admitted exactly once (no double admission).
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


describe("the agent is interrupted after its work commit, before recording completion", () => {
  it("is reconciled incomplete, resumed in the same worktree by one continuation Session that settles, and advances exactly once", () => {
    const rehearsal = world("fault-interrupted-after-work-commit");
    rehearsal.expectError(/reconciliation outcome was incomplete_resumable/);
    const first = rehearsal.untilLaunched(ACTION_1, 3);
    const interrupted = rehearsal.execute(first.launch, ACTION_1, "interrupted-after-work-commit");
    expect(interrupted.interrupted).toContain("died after its work commit");
    expect(interrupted.settlementCommit).toBeNull();

    const again = rehearsal.untilLaunched(ACTION_1, 3);
    expect(again.session.worktree_path).toBe(first.session.worktree_path);
    expect(again.session.branch).toBe(first.session.branch);
    const resumed = rehearsal.execute(again.launch, ACTION_1);
    expect(resumed.brief.continuation).toBe(true);
    // The continuation found the interrupted work commit already on its branch.
    expect(resumed.workCommit).toBe(interrupted.workCommit);
    rehearsal.untilIntegrated(ACTION_1);
    expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_1)).toHaveLength(2);
    expectAdvancedExactlyOnce(rehearsal, interrupted, isolation);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

/**
 * The narrowest completion window: `agent-ask settle --apply` has committed
 * the settlement in the candidate (Plan done, pointer moved, Ask archived),
 * and the process dies before the settlement is recorded in the workspace
 * (src/ask/settlement.ts's `beforeOperationalProjection` window). The
 * previewed `complete` proposal stays PENDING in the workspace, and a pending
 * completion Ask is an operator gate: resolveProjectTransition answers
 * `decision` ("Settle this before dispatch: ...", src/sessions/index.ts), so
 * every later tick skips the launch, and production status never shows the
 * gate (Issues #995 and #997; the same mechanism as run 2's stall, #968).
 */
describe("the agent dies after its settlement commit, before the settlement is recorded", () => {
  let rehearsal: FastRehearsal;
  let result: ExecutorResult;
  let baseBefore: string;
  beforeAll(() => {
    rehearsal = world("fault-interrupted-after-settlement-commit");
    rehearsal.expectError(/reconciliation outcome was incomplete_resumable/);
    baseBefore = git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim();
    const { launch } = rehearsal.untilLaunched(ACTION_1, 3);
    result = rehearsal.execute(launch, ACTION_1, "interrupted-after-settlement-commit");
    rehearsal.ticks(3);
    // Hours later (inside the 12-hour Grant): still gated, still nothing visible.
    rehearsal.advanceClock(4 * 3_600_000);
    rehearsal.ticks(3);
    rehearsal.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("preserves the settled candidate, then a pending-Ask operator gate stops it, invisible in production status (today)", () => {
    expect(result.interrupted).toContain("died after the settlement commit");
    expect(result.statusAtExit).toBe("");
    expect(git(result.brief.worktree, ["show", "--name-only", "--format=", result.settlementCommit!])).toContain(`.arcadia/asks/archive/agent-ask-${result.requestId}.yaml`);
    const [exit, ...later] = rehearsal.recorder.tickLog.slice(-6);
    expect(exit.summary).toContain("reconciled incomplete_resumable");
    expect(exit.summary).toContain("preservation preserved");
    // The work is not lost: the settled head is on the remote candidate branch and its draft PR.
    const pr = rehearsal.pullRequestFor(ACTION_1)!;
    expect(rehearsal.github.headOf(pr.branch)).toBe(result.settlementCommit);
    expect(pr.isDraft).toBe(true);
    // Every later tick skips the launch because the pending `complete` Ask gates the Action.
    for (const tick of later) {
      expect(tick.summary).toMatch(new RegExp(`launch skipped.* \\(Record ${ACTION_1} complete\\.\\)`));
      expect(tick.summary).not.toMatch(/launch launched|integration integrated/);
    }
    expect(rehearsal.sessions().map((s) => [s.action_id, s.status])).toEqual([[ACTION_1, "needs_input"]]);
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(baseBefore);
    expect(rehearsal.planAction(rehearsal.repo, ACTION_1)).toBe("open");
    expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_2)).toEqual([]);
    expect(rehearsal.log.some((line) => line.includes("Integration waits on a governed completion; reconciliation outcome was incomplete_resumable."))).toBe(true);
    const status = rehearsal.productionStatus().data;
    expect(status.operatorEscalations).toEqual([]);
    expect(status.redAlerts).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
  });

  // EXPECTED FAILURE (Issues #995, #997): nothing recovers this window today.
  // When the lifecycle completes the recorded settlement (or resumes the
  // Action) and advances exactly once, this body passes and the marker
  // fails: change `it.fails` to `it`.
  it.fails("recovers and advances exactly once", () => {
    expect(rehearsal.planAction(rehearsal.repo, ACTION_1)).toBe("done");
    expect(rehearsal.recorder.tickLog.filter((tick) => tick.summary.includes("integration integrated"))).toHaveLength(1);
    expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_2)).toHaveLength(1);
  });
});

/**
 * Not a process kill: the step error thrown inside readiness is caught by the
 * tick's own reconcile catch (src/production/tick.ts), which logs
 * "Reconciliation failed". That catch raises a `reconcile_failed` red alert
 * only for a live lease (observeReconcileFailure in
 * src/production/redAlerts.ts returns early without one), and a terminal
 * Session's handoff runs with no lease, so here no red alert is raised: the
 * failure shows only in the worker log. The fresh module graph then shows
 * that no in-process state carries the handoff: the next tick resumes from
 * the database and GitHub alone (it would with or without the restart).
 */
describe("a step error between preservation and readiness, then a fresh module graph", () => {
  it("logs the step error (no red alert for a terminal Session's handoff), readies the PR once and advances exactly once", async () => {
    const rehearsal = world("fault-readiness-step-error-then-fresh-modules");
    rehearsal.expectError(/step error before gh pr ready took effect/);
    const { launch } = rehearsal.untilLaunched(ACTION_1, 3);
    const work = rehearsal.execute(launch, ACTION_1);
    const exit = rehearsal.tick();
    expect(exit.handoff?.preservation.kind).toBe("preserved");
    const pr = rehearsal.pullRequestFor(ACTION_1)!;
    expect(pr.isDraft).toBe(true);

    rehearsal.github.beforeReady = () => { throw new Error("step error before gh pr ready took effect"); };
    rehearsal.tick();
    expect(pr.isDraft).toBe(true);
    expect(rehearsal.github.readyCalls).toEqual([]);
    expect(rehearsal.log.some((line) => line.includes("Reconciliation failed for") && line.includes("step error before gh pr ready took effect"))).toBe(true);
    expect(rehearsal.redAlerts()).toEqual([]);
    await rehearsal.restartWorker();

    rehearsal.untilIntegrated(ACTION_1);
    expect(rehearsal.redAlerts()).toEqual([]);
    expect(pr.isDraft).toBe(false);
    expect(rehearsal.github.readyCalls).toEqual([pr.url]);
    expect(rehearsal.github.reviewerCalls.map((call) => [call.role, call.head])).toEqual([["code-review", work.finalHead], ["qa", work.finalHead]]);
    expectAdvancedExactlyOnce(rehearsal, work, isolation);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
