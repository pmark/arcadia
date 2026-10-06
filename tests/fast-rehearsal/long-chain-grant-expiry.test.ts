import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { CHAIN, runChainStep, type ChainStep } from "./helpers/chain.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import type { ScenarioReport } from "./helpers/report.js";
import { FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * The nine-Action chain (helpers/chain.ts) outrunning its Grant: the
 * activation's integration Grant (Decision 0058) and packet_approval
 * delegation (Decision 0072) both expire 12 simulated hours after the press
 * (2026-09-27T09:00:00Z), while the chain still has work left. Steps 1 to 3
 * (batch 1) integrate first in every scenario. The chain must stop on exactly
 * one named, visible entry in `production status` and never admit a later
 * Action. A failed verdict midway is in long-chain-verdict-failure.test.ts.
 */
const GRANT_EXPIRES_AT = "2026-09-27T09:00:00.000Z";
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

/** A long-chain world with batch 1 (steps 1 to 3) integrated. */
function batchOneIntegrated(name: string): { world: FastRehearsal; steps: ChainStep[] } {
  const world = new FastRehearsal(name, isolation, import.meta.filename, { longChain: true });
  worlds.push(world);
  world.start();
  return { world, steps: [0, 1, 2].map((index) => runChainStep(world, index)) };
}

/** Let simulated time pass, with no tick, until `iso`. */
function clockTo(world: FastRehearsal, iso: string): void {
  world.advanceClock(Date.parse(iso) - world.now.getTime());
}

describe("the Grant expires while step 4's agent is still working", () => {
  let world: FastRehearsal;
  let steps: ChainStep[];
  let four: ExecutorResult;
  let blocked: ReturnType<FastRehearsal["productionStatus"]>;
  let later: ReturnType<FastRehearsal["productionStatus"]>;
  let ticks: ReturnType<FastRehearsal["ticks"]>;
  let report: ScenarioReport;
  beforeAll(() => {
    ({ world, steps } = batchOneIntegrated("long-chain-grant-expires-mid-action"));
    world.expectError(/integration grant expired|cannot integrate|not_integrable/);
    const { launch } = world.untilLaunched(CHAIN[3], 4);
    // Admitted before the expiry; the agent finishes five minutes after it.
    clockTo(world, "2026-09-27T09:05:00.000Z");
    four = world.execute(launch, CHAIN[3]);
    ticks = world.ticks(3);
    blocked = world.productionStatus();
    world.advanceClock(3 * 3_600_000);
    ticks.push(...world.ticks(3));
    later = world.productionStatus();
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("preserves step 4 as a draft PR stacked on step 3's branch and does not ready, review or integrate it", () => {
    const pr = world.pullRequestFor(CHAIN[3])!;
    expect(pr).toMatchObject({ baseBranch: world.gh.prs[2].branch, isDraft: true });
    expect(world.github.headOf(pr.branch)).toBe(four.finalHead);
    expect(world.github.readyCalls).not.toContain(pr.url);
    expect(world.attempts(CHAIN[3]).filter((x) => x.role === "code-review" || x.role === "qa")).toEqual([]);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(steps[2].result.finalHead);
    expect(world.planAction(world.repo, CHAIN[3])).toBe("open");
    for (const tick of ticks) expect(tick.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringContaining(`expired at ${GRANT_EXPIRES_AT}`) });
  });

  it("stops on exactly one named, visible entry in production status that names the lapsed Grant, still there hours later", () => {
    const key = world.actionKey(CHAIN[3]);
    for (const status of [blocked, later]) {
      expect(status.data.operatorEscalations.map((e) => [e.actionKey, e.kind])).toEqual([[key, "terminal_candidate_not_integrable"]]);
      const [escalation] = status.data.operatorEscalations;
      expect(escalation.message).toContain(`The integration grant expired at ${GRANT_EXPIRES_AT} (Decision 0058)`);
      expect(escalation.remedy).toContain(`Record a fresh, unexpired integration Grant (Decision 0058) whose scope names ${key}.`);
      expect(status.text).toContain(`${key} [terminal_candidate_not_integrable]`);
      expect(status.data.redAlerts).toEqual([]);
      expect(status.data.liveAdmissions).toBe(0);
    }
  });

  it("never admits a later Action", () => {
    expect(world.sessions().map((s) => s.action_id)).toEqual(CHAIN.slice(0, 4));
    for (const tick of ticks) expect(tick.launch?.outcome).not.toBe("launched");
    expect(world.github.headOf("main")).toBe(steps[0].launchBase);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});

describe("the Grant expires between step 3 and step 4 (the batch boundary)", () => {
  let world: FastRehearsal;
  let ticks: ReturnType<FastRehearsal["ticks"]>;
  let status: ReturnType<FastRehearsal["productionStatus"]>;
  let report: ScenarioReport;
  beforeAll(() => {
    ({ world } = batchOneIntegrated("long-chain-grant-expires-between-batches"));
    clockTo(world, "2026-09-27T09:00:30.000Z");
    ticks = world.ticks(5);
    status = world.productionStatus();
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("admits no later Action and names the lapsed delegation, not a forgotten approval, in its one escalation", () => {
    const key = world.actionKey(CHAIN[3]);
    expect(world.sessions().map((s) => s.action_id)).toEqual(CHAIN.slice(0, 3));
    for (const tick of ticks) expect(tick.launch).toMatchObject({ outcome: "refused", actionKey: key });
    expect(status.data.operatorEscalations.map((e) => [e.actionKey, e.kind])).toEqual([[key, "build_packet_approval_pending"]]);
    const remedy = status.data.operatorEscalations[0].remedy ?? "";
    expect(remedy).toMatch(new RegExp(`^Blocked: the standing policy's packet_approval delegation expired at ${GRANT_EXPIRES_AT.replaceAll(".", "\\.")}`));
    expect(remedy).toContain(`The integration grant (Decision 0058) expired at ${GRANT_EXPIRES_AT} too`);
    expect(remedy).toMatch(/arcadia review approve review_[a-z0-9]+ --no-execute/);
    expect(status.text).toContain(`${key} [build_packet_approval_pending]`);
    // After five refused ticks the red-alert layer adds its louder signal, about the same Action.
    expect(status.data.redAlerts.map((alert) => [alert.actionKey, alert.trigger])).toEqual([[key, "admission_refused_consecutive"]]);
    expect(status.data.liveAdmissions).toBe(0);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});

/**
 * The delegation approves step 4's packet one tick before the expiry, and the
 * tick after launches it: an Action admitted after the Grant lapsed, which can
 * no longer integrate unattended (the first scenario above is what follows).
 * The standing policy itself has no expiry; only its delegations do, so
 * admission does not consult them (Issue TBD-1).
 */
describe("step 4's packet is approved one tick before the Grant expires", () => {
  let world: FastRehearsal;
  let ticks: ReturnType<FastRehearsal["ticks"]>;
  beforeAll(() => {
    ({ world } = batchOneIntegrated("long-chain-grant-expires-after-approval"));
    // Step 3's integration tick already refused step 4 (not ready); the next tick approves its packet, the one after launches.
    clockTo(world, "2026-09-27T08:58:30.000Z");
    ticks = world.ticks(2);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("launches step 4 one tick after the Grant expired (today)", () => {
    expect(ticks[0].launch?.reason).toContain("Approved the build packet under the standing policy's packet_approval delegation");
    expect(ticks[1].launch).toMatchObject({ outcome: "launched", actionKey: world.actionKey(CHAIN[3]) });
    expect(world.now.toISOString()).toBe("2026-09-27T09:00:30.000Z");
    expect(world.productionStatus().data.display.label).toBe("Active · Building (1 admitted)");
  });

  it.fails("admits no Action once the Grant has expired (Issue TBD-1)", () => {
    expect(world.sessions().map((s) => s.action_id)).toEqual(CHAIN.slice(0, 3));
  });
});
