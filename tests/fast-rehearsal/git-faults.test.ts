import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { expectAdvancedExactlyOnce } from "./helpers/assertions.js";
import { installGitFaults, isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Failure injection at the completion boundary: Git commands that fail once (the
 * other faults are in completion-faults.test.ts; split so the files run in
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


describe("a Git command fails once at the completion boundary", () => {
  it("the lifecycle's own `git merge --ff-only` failing once at integration is retried by the next tick, and the Action advances exactly once", () => {
    const rehearsal = world("fault-git-merge-fails-once");
    const faults = installGitFaults(rehearsal.root);
    try {
      rehearsal.expectError(/injected fault: git merge failed once/);
      const { launch } = rehearsal.untilLaunched(ACTION_1, 3);
      const work = rehearsal.execute(launch, ACTION_1);
      // Armed after the agent's own work: the first `git merge` the lifecycle runs is
      // integration's fast-forward (src/production/sessionHandoff.ts).
      faults.arm("merge", 1);
      const ticks = rehearsal.tickUntil(() => faults.injected().length > 0, 6);
      expect(ticks.at(-1)!.handoff?.integration).toMatchObject({ kind: "refused" });
      expect(faults.injected()).toEqual([expect.objectContaining({ subcommand: "merge", cwd: rehearsal.repo, argv: expect.stringContaining("merge --ff-only") })]);
      for (const injected of faults.injected()) {
        rehearsal.recorder.error({ kind: "injected", command: `git ${injected.argv}`, cwd: injected.cwd, exitCode: 128, stderr: "fatal: injected fault: git merge failed once (fast-rehearsal)", expected: true });
      }
      expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).not.toBe(work.finalHead);
      rehearsal.untilIntegrated(ACTION_1);
      expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(work.finalHead);
      expectAdvancedExactlyOnce(rehearsal, work, isolation);
      expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
    } finally {
      faults.remove();
    }
  }, SCENARIO_TIMEOUT_MS);

  // A remote-adapter failure: the shim fails the harness's fake remote's
  // `git push` (FakeGitHub.remote.push, standing in for production's
  // systemPreservationRemote.push), not a Git call of the lifecycle itself.
  it("a failed push through the preservation remote adapter is retried by the next tick, and the Action advances exactly once", () => {
    const rehearsal = world("fault-remote-adapter-push-fails-once");
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
      expect(rehearsal.github.headOf(rehearsal.sessions()[0].branch)).toBe(work.finalHead);
      expectAdvancedExactlyOnce(rehearsal, work, isolation);
      expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
    } finally {
      faults.remove();
    }
  }, SCENARIO_TIMEOUT_MS);
});

