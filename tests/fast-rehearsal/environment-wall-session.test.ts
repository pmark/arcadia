import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withReadOnlyDatabase } from "../../src/db/connection.js";
import { listProductionAttemptTokens } from "../../src/production/tick.js";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { ENVIRONMENT_WALL_SESSION, writeEnvironmentWallSessionLog } from "./helpers/environmentWall.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * The 2026-10-12 00:40Z production Session replayed through the real
 * lifecycle (A12): the agent makes no diff, its log records the workspace
 * write denied and sandbox refusals, and it spent ~11M input tokens. The
 * lifecycle must stop there: one named `environment_wall` blocker, no second
 * launch, the attempt's tokens recorded, nothing integrated. Without the
 * environment-wall stop the tick relaunches the Action every few ticks.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
let sessionId: string;
let baseBefore: string;
beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("environment-wall-session", isolation, import.meta.filename);
  world.start();
  world.expectError(/^Environment wall for .* will not be relaunched automatically/);
  world.expectError(/The candidate has no commits or changes beyond its base revision/);
  baseBefore = git(world.repo, ["rev-parse", "refs/heads/main"]).trim();
  const { session, launch } = world.untilLaunched(ACTION_1, 3);
  sessionId = session.id;
  writeEnvironmentWallSessionLog(world.workspace, session.id);
  world.execute(launch, ACTION_1, "exits-without-completing");
  // Many ticks, hours apart inside the Grant: a relaunch would show by now.
  world.ticks(4);
  world.advanceClock(4 * 3_600_000);
  world.ticks(4);
  world.finish();
}, SCENARIO_TIMEOUT_MS);
afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("the recorded environment-wall Session", () => {
  it("ends in exactly one named environment_wall blocker, without a second launch", () => {
    expect(world.tmux.launches).toHaveLength(1);
    expect(world.sessions().map((s) => [s.action_id, s.status])).toEqual([[ACTION_1, expect.any(String)]]);
    const escalations = world.escalations();
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({ actionKey: world.actionKey(ACTION_1), kind: "environment_wall" });
    expect(escalations[0]?.message).toContain("workspace_write");
    expect(escalations[0]?.message).toContain("host_validation");
    expect(escalations[0]?.message).toContain("preservation");
    expect(escalations[0]?.remedy).toContain("reset this Action's repair budget");
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(baseBefore);
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
  });

  it("records the attempt's tokens once and stays within the fixed bound", () => {
    const rows = withReadOnlyDatabase(world.workspace, (db) => listProductionAttemptTokens(db, world.actionKey(ACTION_1)));
    expect(rows).toEqual([expect.objectContaining({
      sessionId,
      inputTokens: ENVIRONMENT_WALL_SESSION.totalInputTokens - ENVIRONMENT_WALL_SESSION.cachedInputTokens,
      cachedInputTokens: ENVIRONMENT_WALL_SESSION.cachedInputTokens,
      outputTokens: ENVIRONMENT_WALL_SESSION.outputTokens
    })]);
    const spent = rows.reduce((sum, row) => sum + row.inputTokens + row.cachedInputTokens, 0);
    expect(spent).toBeLessThanOrEqual(ENVIRONMENT_WALL_SESSION.tokenBound);
  });
});
