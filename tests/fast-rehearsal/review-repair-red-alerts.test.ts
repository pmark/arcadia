import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listPendingAgentAskNotifications } from "../../src/ask/settlement.js";
import { withDatabase, withReadOnlyDatabase } from "../../src/db/connection.js";
import { PRODUCTION_CONTROL_DEADLINES } from "../../src/production/policy.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ActionWork } from "./helpers/executor.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS, WORK } from "./helpers/world.js";

/**
 * Decision 0169: red alerts for review repair stops and unchanged resumes, in
 * the real worker tick (only the reviewer model, GitHub, tmux and the agent
 * are faked). The alerts are notify-only: a repair loop that runs out of
 * rounds raises one alert while the existing repair loop alone stops it, and
 * repeated unchanged resumes raise one notice while the existing retry budget
 * alone stops retries. A healthy chain raises none.
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

const repairWork = (round: number): ActionWork => ({
  files: { ...(WORK[ACTION_1].files as Record<string, string>), "REPAIR.md": `fixed in repair round ${round}\n` },
  validation: WORK[ACTION_1].validation
});
const notices = (world: FastRehearsal) => withDatabase(world.workspace, (db) =>
  listPendingAgentAskNotifications(db).filter((entry) => entry.requestId?.startsWith("red-alert-")));
const alertsOf = (world: FastRehearsal, trigger: string) => world.redAlerts().filter((alert) => alert.trigger === trigger);
const attempts = (world: FastRehearsal) => withReadOnlyDatabase(world.workspace, (db) =>
  (db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?").get(world.actionKey(ACTION_1)) as { attempts: number } | undefined) ?? { attempts: 0 });

describe("a repair loop that runs out of rounds raises one red alert; the existing loop alone stops it", () => {
  let world: FastRehearsal;
  beforeAll(() => {
    world = new FastRehearsal("red-alert-repair-rounds-exhausted", isolation, import.meta.filename);
    worlds.push(world);
    world.expectError(/independent_verdict_failed|review_repair_rounds_exhausted|code-review: failed|verdict on [0-9a-f]+ (is fail|failed)|repair rounds/);
    world.github.failCriteria = ["correctness"];
    world.github.verdict = (role) => (role === "code-review" ? "fail" : "pass");
    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    world.execute(first.launch, ACTION_1);
    for (const round of [1, 2, 3]) {
      world.tickUntil(() => world.sessions().length > round && world.lease() !== null, 10);
      const session = world.lease()!;
      const launch = world.tmux.launches.find((entry) => entry.name === session.tmux_session_name)!;
      world.execute(launch, ACTION_1, "clean", repairWork(round));
    }
    world.tickUntil(() => world.escalations().some((e) => e.kind === "review_repair_rounds_exhausted"), 10);
    world.ticks(3);
    world.advanceClock(3 * 3_600_000);
    world.ticks(3);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("raises exactly one open alert of its own trigger and queues exactly one notification", () => {
    const open = world.redAlerts();
    expect(open.map((alert) => [alert.trigger, alert.actionKey])).toEqual([["repair_rounds_exhausted", world.actionKey(ACTION_1)]]);
    expect(notices(world)).toHaveLength(1);
    expect(notices(world)[0].requestId).toBe(open[0].requestId);
  });

  it("keeps the existing loop's behaviour: three repairs then nothing, the Action open, nothing merged", () => {
    expect(world.tmux.launches).toHaveLength(4);
    expect(world.lease()).toBeNull();
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
    expect(world.github.mergeCalls).toEqual([]);
    expect(world.escalations().map((e) => e.kind)).toEqual(["review_repair_rounds_exhausted"]);
  });

  it("states a fixed, bounded message with no finding text", () => {
    const detail = world.redAlerts()[0].detail;
    expect(detail.length).toBeLessThan(400);
    expect(detail).not.toContain("Defect");
    expect(detail).not.toContain("[blocker]");
  });
});

describe("repeated unchanged resumes raise one notice while the existing retry budget alone stops retries", () => {
  let world: FastRehearsal;
  const max = PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction;
  let afterFirst: { alerts: number; notices: number; attempts: number };
  let afterSecond: { alerts: number; notices: number; attempts: number };
  beforeAll(() => {
    world = new FastRehearsal("red-alert-unchanged-resumes", isolation, import.meta.filename);
    worlds.push(world);
    world.expectError(/The candidate has no commits or changes beyond its base revision|repair budget|exhaust/i);
    world.start();
    // The first Session commits some work and dies before completing: incomplete and resumable, not a no-progress exit.
    const first = world.untilLaunched(ACTION_1, 3);
    world.execute(first.launch, ACTION_1, "interrupted-after-work-commit");
    let launch = world.untilLaunched(ACTION_1, 6).launch;
    afterFirst = { alerts: world.redAlerts().length, notices: notices(world).length, attempts: attempts(world).attempts };
    for (let resume = 1; resume <= max; resume += 1) {
      // Each resumed Session reads its brief and exits at once, leaving its candidate unchanged.
      world.execute(launch, ACTION_1, "exits-without-completing");
      if (resume < max) launch = world.untilLaunched(ACTION_1, 6).launch;
      else world.ticks(2);
      if (resume === 1) afterSecond = { alerts: alertsOf(world, "resume_no_progress").length, notices: notices(world).length, attempts: attempts(world).attempts };
    }
    world.ticks(3);
    world.advanceClock(3 * 3_600_000);
    world.ticks(3);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("raises nothing for the fresh first Session that exits without completing", () => {
    expect(afterFirst).toEqual({ alerts: 0, notices: 0, attempts: 0 });
  });

  it("raises one notify-only alert at the first unchanged resume, which the retry budget has already counted", () => {
    expect(afterSecond).toEqual({ alerts: 1, notices: 1, attempts: 1 });
  });

  it("raises one alert and one notification in all, however many unchanged resumes follow", () => {
    expect(alertsOf(world, "resume_no_progress")).toHaveLength(1);
    expect(alertsOf(world, "resume_no_progress")[0].detail).toContain(`(${max} attempts)`);
    expect(notices(world).filter((entry) => entry.requestId === alertsOf(world, "resume_no_progress")[0].requestId)).toHaveLength(1);
  });

  it("is stopped by the existing retry budget alone: the budget escalation, no further launch", () => {
    expect(attempts(world).attempts).toBe(max);
    expect(world.escalations().map((e) => e.kind)).toContain("repair_budget_exhausted");
    expect(world.tmux.launches).toHaveLength(1 + max);
    expect(world.lease()).toBeNull();
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
  });
});

describe("a healthy chain raises no red alert and queues no notification", () => {
  let world: FastRehearsal;
  beforeAll(() => {
    world = new FastRehearsal("red-alert-healthy-chain", isolation, import.meta.filename);
    worlds.push(world);
    world.start();
    const one = world.untilLaunched(ACTION_1, 3);
    world.execute(one.launch, ACTION_1);
    world.untilIntegrated(ACTION_1);
    const two = world.untilLaunched(ACTION_2, 4);
    world.execute(two.launch, ACTION_2);
    world.untilIntegrated(ACTION_2);
    world.ticks(3);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("completes both Actions with no alert and no red-alert notification", () => {
    expect(world.redAlerts()).toEqual([]);
    expect(notices(world)).toEqual([]);
    expect(world.escalations()).toEqual([]);
  });
});
