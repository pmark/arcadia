import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { installGitFaults, isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Failure injection at the completion boundary. Each scenario breaks Action
 * 1's finish at one point and then lets the real lifecycle recover on its
 * own. "Advances exactly once" means: Action 1 is integrated once, with the
 * agent's work commit on the base (no lost commit), and Action 2 is admitted
 * exactly once (no double admission).
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

/** Action 1 integrated once with `work` on the base, then Action 2 admitted once and nothing else. */
function expectAdvancedExactlyOnce(rehearsal: FastRehearsal, work: ExecutorResult) {
  rehearsal.untilLaunched(ACTION_2, 4);
  rehearsal.ticks(2);
  git(rehearsal.repo, ["merge-base", "--is-ancestor", work.workCommit, "refs/heads/main"]);
  expect(rehearsal.planAction(rehearsal.repo, ACTION_1)).toBe("done");
  expect(rehearsal.pointer()).toBe(ACTION_2);
  expect(rehearsal.recorder.tickLog.filter((tick) => tick.summary.includes("integration integrated"))).toHaveLength(1);
  expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_2)).toHaveLength(1);
  expect(rehearsal.attempts(ACTION_2).filter((x) => x.role === "development")).toHaveLength(1);
  expect(rehearsal.attempts(ACTION_1).filter((x) => x.role === "development").map((x) => x.status)).toEqual(["passed"]);
  expect(rehearsal.gh.prs.filter((pr) => pr.branch === rehearsal.sessions()[0].branch)).toHaveLength(1);
  expect(rehearsal.escalations()).toEqual([]);
  expect(isolation.guardCalls()).toEqual([]);
}

describe("a Git command fails once at the completion boundary", () => {
  it("a failed `git push` during terminal preservation is retried by the next tick, and the Action advances exactly once", () => {
    const rehearsal = world("fault-git-push-fails-once");
    const faults = installGitFaults(rehearsal.root);
    try {
      rehearsal.expectError(/injected fault: git push failed once/);
      const { launch } = rehearsal.untilLaunched(ACTION_1, 3);
      const work = rehearsal.execute(launch, ACTION_1);
      faults.arm("push", 1);
      const exit = rehearsal.tick();
      expect(exit.reconciled.map((entry) => entry.outcome)).toEqual(["accepted_completion"]);
      expect(exit.handoff?.preservation).toMatchObject({ kind: "refused", reason: expect.stringContaining("injected fault: git push failed once") });
      expect(faults.injected()).toEqual([expect.objectContaining({ subcommand: "push", cwd: rehearsal.repo })]);
      for (const injected of faults.injected()) {
        rehearsal.recorder.error({ kind: "injected", command: `git ${injected.argv}`, cwd: injected.cwd, exitCode: 128, stderr: "fatal: injected fault: git push failed once (fast-rehearsal)", expected: true });
      }
      rehearsal.untilIntegrated(ACTION_1);
      expect(rehearsal.github.pushes.length).toBeGreaterThanOrEqual(1);
      expect(rehearsal.github.headOf(rehearsal.sessions()[0].branch)).toBe(work.finalHead);
      expectAdvancedExactlyOnce(rehearsal, work);
      expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
    } finally {
      faults.remove();
    }
  }, SCENARIO_TIMEOUT_MS);
});

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
    expectAdvancedExactlyOnce(rehearsal, interrupted);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

/**
 * The narrowest completion window: `agent-ask settle --apply` has committed
 * the settlement in the candidate (Plan done, pointer moved, Ask archived),
 * and the process dies before the settlement is recorded in the workspace
 * (src/ask/settlement.ts's `beforeOperationalProjection` window).
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
    rehearsal.ticks(7);
    rehearsal.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("preserves the settled candidate but then stalls: reconciled incomplete, never relaunched, never integrated, no escalation (today)", () => {
    expect(result.interrupted).toContain("died after the settlement commit");
    expect(result.statusAtExit).toBe("");
    expect(git(result.brief.worktree, ["show", "--name-only", "--format=", result.settlementCommit!])).toContain(`.arcadia/asks/archive/agent-ask-${result.requestId}.yaml`);
    const [exit, ...later] = rehearsal.recorder.tickLog.slice(-7);
    expect(exit.summary).toContain("reconciled incomplete_resumable");
    expect(exit.summary).toContain("preservation preserved");
    // The work is not lost: the settled head is on the remote candidate branch and its draft PR.
    const pr = rehearsal.pullRequestFor(ACTION_1)!;
    expect(rehearsal.github.headOf(pr.branch)).toBe(result.settlementCommit);
    expect(pr.isDraft).toBe(true);
    for (const tick of later) expect(tick.summary).not.toMatch(/launch launched|integration integrated/);
    expect(rehearsal.sessions().map((s) => [s.action_id, s.status])).toEqual([[ACTION_1, "needs_input"]]);
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(baseBefore);
    expect(rehearsal.log.some((line) => line.includes("Integration waits on a governed completion; reconciliation outcome was incomplete_resumable."))).toBe(true);
    expect(rehearsal.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
  });

  // EXPECTED FAILURE: nothing recovers this window today. When the lifecycle
  // completes the recorded settlement (or resumes the Action) and advances,
  // this body passes and the marker fails: change `it.fails` to `it`.
  it.fails("recovers and advances exactly once", () => {
    expect(rehearsal.planAction(rehearsal.repo, ACTION_1)).toBe("done");
    expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_2)).toHaveLength(1);
  });
});

describe("the worker restarts between preservation and readiness", () => {
  it("a crash inside the readiness step, then a restart on a fresh module graph, readies the PR once and advances exactly once", async () => {
    const rehearsal = world("fault-worker-restart-before-readiness");
    rehearsal.expectError(/worker killed before gh pr ready took effect/);
    const { launch } = rehearsal.untilLaunched(ACTION_1, 3);
    const work = rehearsal.execute(launch, ACTION_1);
    const exit = rehearsal.tick();
    expect(exit.handoff?.preservation.kind).toBe("preserved");
    const pr = rehearsal.pullRequestFor(ACTION_1)!;
    expect(pr.isDraft).toBe(true);

    rehearsal.github.beforeReady = () => { throw new Error("worker killed before gh pr ready took effect"); };
    rehearsal.tick();
    expect(pr.isDraft).toBe(true);
    expect(rehearsal.github.readyCalls).toEqual([]);
    await rehearsal.restartWorker();

    rehearsal.untilIntegrated(ACTION_1);
    expect(pr.isDraft).toBe(false);
    expect(rehearsal.github.readyCalls).toEqual([pr.url]);
    expect(rehearsal.github.reviewerCalls.map((call) => [call.role, call.head])).toEqual([["code-review", work.finalHead], ["qa", work.finalHead]]);
    expectAdvancedExactlyOnce(rehearsal, work);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
