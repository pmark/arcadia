import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorBehaviour, ExecutorResult } from "./helpers/executor.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Scripted-executor behaviours that dirty the candidate after settling (the
 * rest are in executor-behaviours.test.ts; split so the files run in
 * parallel): each one a way a real agent finished (or could finish) Action
 * 1, run through the real lifecycle. Each test asserts
 * what the lifecycle does today, exactly. Where today's answer is a silent
 * stall, a second test states the property it lacks and is marked
 * `it.fails` (an expected failure): fixing the gap flips it.
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
 * An agent that settles and then dirties its candidate. Today the exit is
 * reconciled `incomplete_resumable`, preservation commits the dirt, and the
 * tick relaunches a continuation Session. That continuation drafts and
 * previews its own `complete` Ask (complete-write-marker-a-run-2) but cannot
 * settle it ("Action is already done": the candidate's Plan already says
 * done), so the proposal stays PENDING. A pending completion Ask is an
 * operator gate: resolveProjectTransition answers `decision` ("Settle this
 * before dispatch: ...", src/sessions/index.ts), every later tick skips the
 * launch, and production status renders neither the gate nor an escalation
 * (Issues #994 and #997; the same mechanism as run 2's stall, #968).
 */
describe.each([
  { behaviour: "extra-uncommitted-file" as const, file: "scratch-notes.txt" },
  { behaviour: "extra-commit-after-settle" as const, file: "EXTRA.md" }
])("an agent that settles and then leaves $file ($behaviour)", ({ behaviour, file }) => {
  let world: FastRehearsal;
  let result: ExecutorResult;
  let baseBefore: string;
  let continuationError: string | null = null;
  beforeAll(() => {
    ({ world, result, baseBefore } = scenario(`behaviour-${behaviour}`, behaviour));
    world.expectError(/reconciliation outcome was incomplete_resumable|Action is already done/);
    const again = world.untilLaunched(ACTION_1, 3);
    try {
      world.execute(again.launch, ACTION_1, "clean");
    } catch (error) {
      continuationError = error instanceof Error ? error.message : String(error);
    }
    world.ticks(2);
    // Hours later (inside the 12-hour Grant): still gated, still nothing visible.
    world.advanceClock(4 * 3_600_000);
    world.ticks(3);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("is relaunched as a continuation that cannot settle, then held by a pending-Ask operator gate that production status does not show (today)", () => {
    const sessions = world.sessions();
    expect(sessions.map((s) => [s.action_id, s.status])).toEqual([[ACTION_1, "needs_input"], [ACTION_1, "needs_input"]]);
    expect(new Set(sessions.map((s) => s.worktree_path)).size).toBe(1);
    expect(continuationError).toBe("Action is already done.");
    // The work and the extra file are preserved on the candidate branch and its PR head; nothing reached the base.
    const head = git(result.brief.worktree, ["rev-parse", "HEAD"]).trim();
    git(result.brief.worktree, ["merge-base", "--is-ancestor", result.settlementCommit!, head]);
    expect(git(result.brief.worktree, ["ls-tree", "--name-only", head])).toContain(file);
    expect(world.github.headOf(world.pullRequestFor(ACTION_1)!.branch)).toBe(head);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(baseBefore);
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
    // The gate: the continuation's previewed, unsettled completion Ask.
    for (const tick of world.recorder.tickLog.slice(-4)) {
      expect(tick.summary).toMatch(new RegExp(`launch skipped.* \\(Record ${ACTION_1} complete\\.\\)`));
      expect(tick.summary).not.toMatch(/launch launched|integration integrated/);
    }
    const status = world.productionStatus().data;
    expect(status.operatorEscalations).toEqual([]);
    expect(status.redAlerts).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
  });

  // EXPECTED FAILURE (Issues #994, #997): the gate is invisible. When the
  // lifecycle either integrates this candidate or names the blocker in
  // production status (an escalation or a red alert), this body passes and
  // the marker fails: change `it.fails` to `it`.
  it.fails("either integrates the candidate or shows the blocker in production status", () => {
    const status = world.productionStatus().data;
    const integrated = world.planAction(world.repo, ACTION_1) === "done";
    const visible = status.operatorEscalations.some((entry) => entry.actionKey === world.actionKey(ACTION_1))
      || status.redAlerts.some((alert) => alert.actionKey === world.actionKey(ACTION_1));
    expect(integrated || visible).toBe(true);
  });
});

/**
 * The same dirty settle, but the continuation exits WITHOUT drafting anything
 * (no pending Ask, so no operator gate): the tick keeps resuming the Action
 * until the repair budget is spent, and then escalates `repair_budget_exhausted`,
 * which production status shows.
 */
describe("an agent that settles and leaves an extra file, with continuations that exit without drafting", () => {
  it("relaunches until the repair budget is exhausted, then escalates repair_budget_exhausted in production status", () => {
    const { world, baseBefore } = scenario("behaviour-extra-file-continuation-exits-without-drafting", "extra-uncommitted-file");
    world.expectError(/reconciliation outcome was incomplete_resumable|repair_budget_exhausted|exited incomplete without changing its candidate/);
    let continuations = 0;
    for (let round = 0; round < 6; round += 1) {
      const ticks = world.tickUntil((r) => r.launch?.outcome === "launched" || r.launch?.outcome === "repair_budget_exhausted", 4);
      const last = ticks.at(-1)!;
      if (last.launch?.outcome === "repair_budget_exhausted") break;
      continuations += 1;
      const launch = world.tmux.launches.at(-1)!;
      const resumed = world.execute(launch, ACTION_1, "exits-without-completing");
      expect(resumed.brief.continuation).toBe(true);
    }
    world.ticks(1);
    expect(continuations).toBeGreaterThan(0);
    expect(world.sessions().filter((s) => s.action_id === ACTION_1)).toHaveLength(continuations + 1);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(baseBefore);
    const { data, text } = world.productionStatus();
    expect(data.operatorEscalations.map((entry) => [entry.actionKey, entry.kind])).toEqual([[world.actionKey(ACTION_1), "repair_budget_exhausted"]]);
    expect(text).toContain(`${world.actionKey(ACTION_1)} [repair_budget_exhausted]`);
    world.recorder.notes.push(`continuations before repair_budget_exhausted: ${continuations}`);
    expect(isolation.guardCalls()).toEqual([]);
    expect(world.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
