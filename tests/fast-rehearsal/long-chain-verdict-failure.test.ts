import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { CHAIN, runChainStep, type ChainStep } from "./helpers/chain.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ScenarioReport } from "./helpers/report.js";
import { FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * The nine-Action chain (helpers/chain.ts) hitting a blocker midway: steps 1
 * to 4 integrate, then the QA reviewer fails step 5's exact head. A failed
 * verdict never integrates, so the chain must stop on that one Action, say so
 * in `production status`, admit nothing later, and stay that way hours later
 * (the operator asleep). The Grant expiring midway is in
 * long-chain-grant-expiry.test.ts.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
let report: ScenarioReport;
const steps: ChainStep[] = [];
let five: ChainStep;
let blocked: ReturnType<FastRehearsal["productionStatus"]>;
let later: ReturnType<FastRehearsal["productionStatus"]>;
let afterBlock: ReturnType<FastRehearsal["ticks"]>;

beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("long-chain-qa-fails-step-5", isolation, import.meta.filename, { longChain: true });
  // The tick's own log lines for the failed verdict and the withheld integration.
  world.expectError(/independent_verdict_failed|qa: failed|verdict on [0-9a-f]+ is fail/);
  world.start();
  for (const index of [0, 1, 2, 3]) steps.push(runChainStep(world, index));
  world.github.verdict = (role, pr) => (role === "qa" && pr?.branch.includes(`/${CHAIN[4]}-`) ? "fail" : "pass");
  five = runChainStep(world, 4, { integrate: false });
  world.tickUntil(() => world.escalations().some((e) => e.kind === "independent_verdict_failed"), 6);
  blocked = world.productionStatus();
  afterBlock = world.ticks(3);
  // The operator is asleep: three simulated hours pass, the worker keeps ticking.
  world.advanceClock(3 * 3_600_000);
  afterBlock.push(...world.ticks(3));
  later = world.productionStatus();
  report = world.finish();
}, SCENARIO_TIMEOUT_MS);

afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("fast rehearsal: the nine-Action chain stops on a failed QA verdict at step 5", () => {
  it("integrates steps 1 to 4 and never step 5", () => {
    expect(report.actions.map((action) => [action.actionId, action.outcome])).toEqual([
      ...CHAIN.slice(0, 4).map((id) => [id, "integrated"]), [CHAIN[4], "preserved"]
    ]);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(steps[3].result.finalHead);
    expect(world.planAction(world.repo, CHAIN[4])).toBe("open");
    // Step 5 is stacked on step 4's branch and reviewed on its exact head; QA failed it, code review passed it.
    expect(five.view).toMatchObject({ baseRefName: world.gh.prs[3].branch, baseRefOid: steps[3].result.finalHead });
    expect(five.consistency.consistent).toBe(true);
    expect(world.attempts(CHAIN[4]).filter((x) => x.role === "code-review" || x.role === "qa").map((x) => [x.role, x.status]))
      .toEqual([["code-review", "passed"], ["qa", "failed"]]);
  });

  it("stops on exactly one named, visible entry in production status, still there hours later", () => {
    const key = world.actionKey(CHAIN[4]);
    for (const status of [blocked, later]) {
      expect(status.data.operatorEscalations.map((e) => [e.actionKey, e.kind])).toEqual([[key, "independent_verdict_failed"]]);
      expect(status.text).toContain("Needs an operator or agent (1):");
      expect(status.text).toContain(`${key} [independent_verdict_failed]`);
      expect(status.data.operatorEscalations[0].remedy).toContain(`arcadia qa pr ${five.view.url} --rerun`);
      expect(status.data.redAlerts).toEqual([]);
      expect(status.data.liveAdmissions).toBe(0);
    }
    // The row is refreshed by every tick: the blocker is current, not a stale record.
    expect(later.data.operatorEscalations[0].lastSeenAt).toBe(world.now.toISOString());
  });

  it("never admits a later Action", () => {
    expect(world.sessions().map((s) => s.action_id)).toEqual(CHAIN.slice(0, 5));
    expect(world.tmux.launches).toHaveLength(5);
    for (const tick of afterBlock) {
      expect(tick.launch?.outcome).not.toBe("launched");
      expect(tick.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringContaining("qa: failed") });
    }
    expect(world.github.headOf("main")).toBe(steps[0].launchBase);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});
