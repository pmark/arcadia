import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgentAskPendingCommand } from "../../src/commands/agentAsk.js";
import { runSessionReconcileCommand } from "../../src/commands/advance.js";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorBehaviour, ExecutorResult } from "./helpers/executor.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Scripted-executor behaviours that dirty the candidate after settling (the
 * rest are in executor-behaviours.test.ts; split so the files run in
 * parallel): each one a way a real agent finished (or could finish) Action
 * 1, run through the real lifecycle. Each test asserts
 * what the lifecycle does today, exactly; the property test beside it was an
 * expected failure (`it.fails`) until the fix for Issue #994 flipped it.
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

function scenario(name: string, behaviour: ExecutorBehaviour): { world: FastRehearsal; result: ExecutorResult; baseBefore: string } {
  const world = new FastRehearsal(name, isolation, import.meta.filename);
  worlds.push(world);
  world.start();
  const baseBefore = git(world.repo, ["rev-parse", "refs/heads/main"]).trim();
  const { launch } = world.untilLaunched(ACTION_1, 3);
  return { world, result: world.execute(launch, ACTION_1, behaviour), baseBefore };
}

/**
 * An agent that settles and then dirties its candidate. The exit is
 * reconciled `incomplete_resumable` (the candidate carries work after its
 * settlement) and preservation commits the dirt. Before the fix the tick then
 * relaunched a continuation Session, which drafted and previewed its own
 * `complete` Ask but could not settle it ("Action is already done": the
 * candidate's Plan already says done); that pending Ask gated the Action
 * (resolveProjectTransition answers `decision`) and production status showed
 * nothing (Issues #994 and #997). Now an unfinished exit whose candidate
 * already carries the Action's own recorded completion settlement goes to the
 * terminal guards instead of a continuation: they refuse it (the head is not
 * the settlement commit, so the extra work is never integrated) and escalate
 * once, `terminal_candidate_not_integrable`, with the exact remedy.
 */
describe.each([
  { behaviour: "extra-uncommitted-file" as const, file: "scratch-notes.txt" },
  { behaviour: "extra-commit-after-settle" as const, file: "EXTRA.md" }
])("an agent that settles and then leaves $file ($behaviour)", ({ behaviour, file }) => {
  let world: FastRehearsal;
  let result: ExecutorResult;
  let baseBefore: string;
  beforeAll(() => {
    ({ world, result, baseBefore } = scenario(`behaviour-${behaviour}`, behaviour));
    world.expectError(/reconciliation outcome was incomplete_resumable|differs from its exact canonical completion settlement/);
    world.ticks(3);
    // Hours later (inside the 12-hour Grant): still the same one entry, no relaunch.
    world.advanceClock(4 * 3_600_000);
    world.ticks(3);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("is never relaunched: the terminal guard refuses the head after its settlement commit, and production status shows one terminal_candidate_not_integrable entry", () => {
    expect(world.sessions().map((s) => [s.action_id, s.status])).toEqual([[ACTION_1, "needs_input"]]);
    expect(world.tmux.launches).toHaveLength(1);
    expect(runAgentAskPendingCommand({ workspace: world.workspace }).data.pending).toEqual([]);
    // The work and the extra file are preserved on the candidate branch and its PR head; nothing reached the base.
    const head = git(result.brief.worktree, ["rev-parse", "HEAD"]).trim();
    expect(head).not.toBe(result.settlementCommit);
    git(result.brief.worktree, ["merge-base", "--is-ancestor", result.settlementCommit!, head]);
    expect(git(result.brief.worktree, ["ls-tree", "--name-only", head])).toContain(file);
    expect(world.github.headOf(world.pullRequestFor(ACTION_1)!.branch)).toBe(head);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(baseBefore);
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
    for (const tick of world.recorder.tickLog.slice(-5)) {
      expect(tick.summary).toContain("integration refused");
      expect(tick.summary).not.toMatch(/launch launched|integration integrated/);
    }
    const { data, text } = world.productionStatus();
    expect(data.operatorEscalations.map((entry) => [entry.actionKey, entry.kind])).toEqual([[world.actionKey(ACTION_1), "terminal_candidate_not_integrable"]]);
    const [entry] = data.operatorEscalations;
    expect(entry.remedy).toContain(`after its completion settlement commit ${result.settlementCommit}`);
    expect(entry.remedy).toContain(file);
    expect(entry.remedy).toContain(`merge --ff-only ${result.settlementCommit}`);
    expect(text).toContain(`${world.actionKey(ACTION_1)} [terminal_candidate_not_integrable]`);
    expect(world.log.filter((line) => line.includes("(terminal_candidate_not_integrable)"))).toHaveLength(1);
    expect(data.redAlerts).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
  });

  // Was an EXPECTED FAILURE (Issues #994, #997) until the terminal guards
  // took over an unfinished exit that had already settled its Action.
  it("either integrates the candidate or shows the blocker in production status", () => {
    const status = world.productionStatus().data;
    const integrated = world.planAction(world.repo, ACTION_1) === "done";
    const visible = status.operatorEscalations.some((entry) => entry.actionKey === world.actionKey(ACTION_1))
      || status.redAlerts.some((alert) => alert.actionKey === world.actionKey(ACTION_1));
    expect(integrated || visible).toBe(true);
  });

  it("follows the remedy: once an operator lands the settlement commit itself, the entry clears and the next Action launches once, without the extra work", () => {
    git(world.repo, ["merge", "--ff-only", "--quiet", result.settlementCommit!]);
    world.untilLaunched(ACTION_2, 3);
    expect(world.escalations()).toEqual([]);
    expect(world.sessions().filter((s) => s.action_id === ACTION_2)).toHaveLength(1);
    expect(git(world.repo, ["ls-tree", "--name-only", "refs/heads/main"])).not.toContain(file);
    expect(world.recorder.tickLog.filter((tick) => tick.summary.includes("integration integrated"))).toHaveLength(0);
    expect(isolation.guardCalls()).toEqual([]);
  });
});

/**
 * The same dirty settle, but an operator reconciles the dead Session by hand
 * (`arcadia session reconcile`) before the worker sees it, so the worker never
 * reconciles that exit and resumes it: one continuation Session runs, finds
 * nothing to do, drafts and previews its own `complete` Ask and cannot settle
 * it ("Action is already done"). Its exit then carries the recorded settlement
 * too, so it is handed to the terminal guards like the case above: no second
 * continuation, no loop, one visible entry.
 */
describe("an agent that settles and commits extra work, reconciled by an operator before the worker", () => {
  it("runs one continuation that cannot settle and then stops on one terminal_candidate_not_integrable entry, never relaunched", () => {
    const { world, baseBefore } = scenario("behaviour-extra-commit-operator-reconciled", "extra-commit-after-settle");
    world.expectError(/Action is already done|reconciliation outcome was incomplete_resumable|differs from its exact canonical completion settlement/);
    const [first] = world.sessions();
    expect(runSessionReconcileCommand({ workspace: world.workspace, repo: world.repo, session: first.id, requestId: `operator-reconcile-${first.id}` })
      .data.receipt.outcome).toBe("incomplete_resumable");
    const again = world.untilLaunched(ACTION_1, 3);
    expect(again.session.worktree_path).toBe(first.worktree_path);
    let continuationError: string | null = null;
    try {
      world.execute(again.launch, ACTION_1, "clean");
    } catch (error) {
      continuationError = error instanceof Error ? error.message : String(error);
    }
    expect(continuationError).toBe("Action is already done.");
    world.ticks(3);
    world.advanceClock(4 * 3_600_000);
    world.ticks(3);
    expect(world.sessions().filter((s) => s.action_id === ACTION_1)).toHaveLength(2);
    expect(world.tmux.launches).toHaveLength(2);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(baseBefore);
    const { data, text } = world.productionStatus();
    expect(data.operatorEscalations.map((entry) => [entry.actionKey, entry.kind])).toEqual([[world.actionKey(ACTION_1), "terminal_candidate_not_integrable"]]);
    expect(text).toContain(`${world.actionKey(ACTION_1)} [terminal_candidate_not_integrable]`);
    expect(world.log.filter((line) => line.includes("(terminal_candidate_not_integrable)"))).toHaveLength(1);
    expect(isolation.guardCalls()).toEqual([]);
    expect(world.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
