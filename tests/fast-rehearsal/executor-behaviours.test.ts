import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorBehaviour, ExecutorResult } from "./helpers/executor.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Scripted-executor behaviours: each one a way a real agent finished (or
 * could finish) Action 1, run through the real lifecycle. Each test asserts
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

describe("run 4's shape: the drafted Ask is left untracked and unarchived (fixed by #983)", () => {
  it("archives the canonical draft in the settlement commit, so the candidate integrates and Action 2 is admitted exactly once", () => {
    const { world, result } = scenario("behaviour-run4-untracked-unarchived-draft", "untracked-unarchived-draft");
    // The inline preview recorded no source path; #983's canonical-name fallback archived the draft anyway.
    const archived = `.arcadia/asks/archive/agent-ask-${result.requestId}.yaml`;
    expect(result.statusAtExit).toBe("");
    expect(result.settleWarnings).toEqual([]);
    expect(git(result.brief.worktree, ["show", "--name-only", "--format=", result.settlementCommit!])).toContain(archived);
    expect(existsSync(path.join(result.brief.worktree, `.arcadia/asks/agent-ask-${result.requestId}.yaml`))).toBe(false);

    world.untilIntegrated(ACTION_1);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(result.settlementCommit);
    world.untilLaunched(ACTION_2, 4);
    world.ticks(1);
    expect(world.sessions().map((s) => s.action_id)).toEqual([ACTION_1, ACTION_2]);
    expect(world.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(world.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

describe("#983's N4 case: the drafted Ask is edited after an inline preview", () => {
  it("warns at settle, the integration guard refuses every tick, and production status carries one terminal_candidate_not_integrable escalation", () => {
    const { world, result, baseBefore } = scenario("behaviour-n4-edit-draft-after-inline-preview", "edit-draft-after-inline-preview");
    world.expectError(/differs from its exact canonical completion settlement/);
    const draft = `.arcadia/asks/agent-ask-${result.requestId}.yaml`;
    expect(result.settleWarnings).toEqual([expect.stringContaining(`Left ${draft} in place: its content does not match settled proposal ${result.requestId}`)]);
    expect(result.statusAtExit).toBe(`?? ${draft}\n`);

    const ticks = world.ticks(6);
    // The exit tick reconciles an accepted completion and preserves the candidate, committing the stray draft on top.
    expect(ticks[0].reconciled.map((entry) => entry.outcome)).toEqual(["accepted_completion"]);
    expect(ticks[0].handoff?.preservation.kind).toBe("preserved");
    const preservedHead = git(result.brief.worktree, ["rev-parse", "HEAD"]).trim();
    expect(git(result.brief.worktree, ["show", "--name-only", "--format=", preservedHead])).toContain(draft);
    // The exit tick waits on verdicts for the preserved head; every later tick's recovery hits the guard.
    expect(ticks[0].handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringContaining("Integration waits on current independent verdicts") });
    for (const tick of ticks.slice(1)) {
      expect(tick.handoff?.integration).toMatchObject({ kind: "refused", reason: "The terminal candidate differs from its exact canonical completion settlement." });
    }
    expect(ticks.every((tick) => tick.launch?.outcome !== "launched")).toBe(true);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(baseBefore);
    expect(world.log.filter((line) => line.includes("terminal_candidate_not_integrable"))).toHaveLength(1);

    const { data, text } = world.productionStatus();
    expect(data.operatorEscalations).toHaveLength(1);
    expect(data.operatorEscalations[0]).toMatchObject({ actionKey: world.actionKey(ACTION_1), kind: "terminal_candidate_not_integrable" });
    expect(data.operatorEscalations[0].remedy).toContain(draft);
    expect(data.operatorEscalations[0].remedy).toContain(`after its completion settlement commit ${result.settlementCommit}`);
    expect(text).toContain(`${world.actionKey(ACTION_1)} [terminal_candidate_not_integrable]`);
    expect(isolation.guardCalls()).toEqual([]);
    expect(world.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

/**
 * An agent that settles and then dirties its candidate. Today the exit is
 * reconciled `incomplete_resumable`, preservation commits the dirt, and the
 * tick relaunches a continuation Session; that continuation cannot settle
 * again (the candidate's Plan already says done), and the Action then stalls:
 * nothing integrates, nothing launches and production status shows nothing.
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
    world.ticks(5);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("is reconciled incomplete, relaunched as a continuation that cannot settle, and then stalls without an escalation (today)", () => {
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
    expect(world.recorder.tickLog.slice(-5).every((tick) => !tick.summary.includes("launch launched") && !tick.summary.includes("integration integrated"))).toBe(true);
    expect(world.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
  });

  // EXPECTED FAILURE: the stall is silent. When the lifecycle either
  // integrates this candidate or names the blocker in production status,
  // this body passes and the marker fails: change `it.fails` to `it`.
  it.fails("either integrates the candidate or shows an operator escalation for the Action", () => {
    const integrated = world.planAction(world.repo, ACTION_1) === "done";
    const escalated = world.productionStatus().data.operatorEscalations.some((entry) => entry.actionKey === world.actionKey(ACTION_1));
    expect(integrated || escalated).toBe(true);
  });
});
