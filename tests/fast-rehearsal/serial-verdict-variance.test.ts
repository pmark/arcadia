import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import type { ScenarioReport } from "./helpers/report.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Reviewer variance (Issue #1018, the operator's 2026-10-06 choice): live runs
 * 1, 3, 5 and 6 each stopped on a non-pass independent verdict with no real
 * defect behind it. The tick now reruns such a verdict (no finding but the
 * gate's refused not-applicable claims, no criterion judged fail) at most twice
 * more per verdict kind per exact head, naming each rerun and counting every
 * reviewer call; a real finding still stops at once. Real worker tick, real
 * review commands and deterministic gate; only the reviewer model is stubbed
 * (`world.github.verdict`: "variance" is needs-follow-up, no finding, one
 * criterion not-checked).
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

const roles = (world: FastRehearsal) => world.github.reviewerCalls.map((call) => call.role);
const lineage = (world: FastRehearsal, actionId: string) =>
  world.attempts(actionId).filter((x) => x.role === "code-review" || x.role === "qa").map((x) => [x.role, x.status]);
const reruns = (world: FastRehearsal) => world.log.filter((line) => line.includes("Automatic rerun of the independent"));

describe("a variance verdict, then a pass: the Action integrates with no operator step", () => {
  let world: FastRehearsal;
  let afterVariance: ReturnType<FastRehearsal["productionStatus"]>;
  let two: ExecutorResult;
  let report: ScenarioReport;
  beforeAll(() => {
    world = new FastRehearsal("serial-variance-then-pass", isolation, import.meta.filename);
    worlds.push(world);
    // While the automatic rerun is pending, the gate's own wait line still reads "code-review: failed".
    world.expectError(/code-review: failed; qa: none/);
    let codeReviews = 0;
    world.github.verdict = (role) => (role === "code-review" && codeReviews++ === 0 ? "variance" : "pass");
    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    world.execute(first.launch, ACTION_1);
    world.tickUntil(() => world.github.reviewerCalls.length >= 1, 6);
    afterVariance = world.productionStatus();
    world.untilIntegrated(ACTION_1);
    const second = world.untilLaunched(ACTION_2, 4);
    two = world.execute(second.launch, ACTION_2);
    world.untilIntegrated(ACTION_2);
    world.ticks(2);
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("reruns the code review once, names that rerun once, and integrates both Actions", () => {
    expect(afterVariance.data.operatorEscalations.map((e) => [e.actionKey, e.kind])).toEqual([[world.actionKey(ACTION_1), "awaiting_independent_verdicts"]]);
    expect(afterVariance.text).toContain("Automatic rerun 2 of 3 follows");
    expect(lineage(world, ACTION_1)).toEqual([["code-review", "failed"], ["code-review", "passed"], ["qa", "passed"]]);
    // The reviewer counts: Action 1 took one extra code-review call, Action 2 none.
    expect(roles(world)).toEqual(["code-review", "code-review", "qa", "code-review", "qa"]);
    expect(reruns(world)).toHaveLength(1);
    expect(reruns(world)[0]).toMatch(/independent code-review of .* attempt 2 of 3; the previous verdict was reviewer variance only/);
    expect(world.planAction(world.repo, ACTION_1)).toBe("done");
    expect(world.planAction(world.repo, ACTION_2)).toBe("done");
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(two.finalHead);
    expect(world.sessions().map((s) => s.action_id)).toEqual([ACTION_1, ACTION_2]);
  });

  it("never needed an operator: no independent_verdict_failed entry was ever recorded and none remains", () => {
    expect(world.log.some((line) => line.includes("independent_verdict_failed"))).toBe(false);
    expect(world.escalations()).toEqual([]);
    expect(world.redAlerts()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});

describe("three variance verdicts: one visible entry says the reruns are spent", () => {
  let world: FastRehearsal;
  let blocked: ReturnType<FastRehearsal["productionStatus"]>;
  let later: ReturnType<FastRehearsal["productionStatus"]>;
  let afterBlock: ReturnType<FastRehearsal["ticks"]>;
  let report: ScenarioReport;
  beforeAll(() => {
    world = new FastRehearsal("serial-variance-three-times", isolation, import.meta.filename);
    worlds.push(world);
    // The tick's own log lines for the spent reruns and the withheld integration.
    world.expectError(/reruns are spent|independent_verdict_failed|code-review: failed|verdict on [0-9a-f]+ was not a pass/);
    world.github.verdict = (role) => (role === "code-review" ? "variance" : "pass");
    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    world.execute(first.launch, ACTION_1);
    world.tickUntil(() => world.escalations().some((e) => e.kind === "independent_verdict_failed"), 12);
    blocked = world.productionStatus();
    afterBlock = world.ticks(3);
    // The operator is asleep: three simulated hours pass, the worker keeps ticking.
    world.advanceClock(3 * 3_600_000);
    afterBlock.push(...world.ticks(3));
    later = world.productionStatus();
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("calls the code reviewer exactly three times, QA never, and records each attempt as a variance verdict", () => {
    expect(roles(world)).toEqual(["code-review", "code-review", "code-review"]);
    expect(lineage(world, ACTION_1)).toEqual([["code-review", "failed"], ["code-review", "failed"], ["code-review", "failed"]]);
    for (const attempt of world.attempts(ACTION_1).filter((x) => x.role === "code-review")) {
      expect(JSON.parse(attempt.terminal_receipt_json!)).toMatchObject({ variance: expect.stringMatching(/^reviewer variance only/), reviewerUnavailable: null });
    }
    expect(reruns(world).map((line) => /attempt (\d) of 3/.exec(line)?.[1])).toEqual(["2", "3"]);
  });

  it("stops on exactly one named entry, still there hours later, and admits nothing after it", () => {
    const key = world.actionKey(ACTION_1);
    for (const status of [blocked, later]) {
      expect(status.data.operatorEscalations.map((e) => [e.actionKey, e.kind])).toEqual([[key, "independent_verdict_failed"]]);
      expect(status.data.operatorEscalations[0].message).toContain("the automatic reruns are spent");
      expect(status.text).toContain(`${key} [independent_verdict_failed]`);
      expect(status.data.operatorEscalations[0].remedy).toContain("arcadia qa code-review");
      expect(status.data.redAlerts).toEqual([]);
    }
    expect(later.data.operatorEscalations[0].lastSeenAt).toBe(world.now.toISOString());
    expect(world.log.filter((line) => line.includes("Escalated") && line.includes("(independent_verdict_failed)"))).toHaveLength(1);
    expect(world.sessions().map((s) => s.action_id)).toEqual([ACTION_1]);
    expect(world.tmux.launches).toHaveLength(1);
    for (const tick of afterBlock) expect(tick.handoff?.integration).toMatchObject({ kind: "refused" });
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});

describe("a real finding stops on the first attempt with no rerun", () => {
  let world: FastRehearsal;
  let status: ReturnType<FastRehearsal["productionStatus"]>;
  let report: ScenarioReport;
  beforeAll(() => {
    world = new FastRehearsal("serial-real-finding-no-rerun", isolation, import.meta.filename);
    worlds.push(world);
    world.expectError(/independent_verdict_failed|code-review: failed|verdict on [0-9a-f]+ is needs-follow-up/);
    world.github.verdict = (role) => (role === "code-review" ? "fail" : "pass");
    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    world.execute(first.launch, ACTION_1);
    world.tickUntil(() => world.escalations().some((e) => e.kind === "independent_verdict_failed"), 8);
    world.ticks(6);
    status = world.productionStatus();
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("calls the reviewer once, never again, and names no rerun", () => {
    expect(roles(world)).toEqual(["code-review"]);
    expect(lineage(world, ACTION_1)).toEqual([["code-review", "failed"]]);
    expect(JSON.parse(world.attempts(ACTION_1).find((x) => x.role === "code-review")!.terminal_receipt_json!).variance).toBeUndefined();
    expect(reruns(world)).toEqual([]);
    expect(status.data.operatorEscalations.map((e) => [e.actionKey, e.kind])).toEqual([[world.actionKey(ACTION_1), "independent_verdict_failed"]]);
    expect(status.data.operatorEscalations[0].message).not.toContain("reruns are spent");
    expect(status.data.operatorEscalations[0].remedy).toContain("--rerun");
    expect(world.sessions().map((s) => s.action_id)).toEqual([ACTION_1]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});
