import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withReadOnlyDatabase } from "../../src/db/connection.js";
import { sessionLogPath } from "../../src/sessions/sessionRecording.js";
import { listProductionAttemptTokens } from "../../src/production/tick.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * The same spend as the environment-wall replay but with NO wall text in the
 * log: only the platform token ceiling can stop it. The Session exits without
 * a diff after ~9M input tokens (above the 3M light-tier default (the rehearsal model)); the
 * lifecycle must record both counts, write the `budget_exhausted` stop, raise
 * one blocker and never relaunch.
 */
const UNCACHED = 600_000;
const CACHED = 8_400_000;
let isolation: IsolatedProcess;
let world: FastRehearsal;
let sessionId: string;
beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("token-ceiling-session", isolation, import.meta.filename);
  world.start();
  world.expectError(/^Budget exhausted for .* will not be relaunched automatically/);
  world.expectError(/The candidate has no commits or changes beyond its base revision/);
  const { session, launch } = world.untilLaunched(ACTION_1, 3);
  sessionId = session.id;
  const file = sessionLogPath(world.workspace, session.id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ type: "turn.completed", usage: { input_tokens: UNCACHED + CACHED, cached_input_tokens: CACHED, output_tokens: 900 } }));
  world.execute(launch, ACTION_1, "exits-without-completing");
  world.ticks(4);
  world.advanceClock(4 * 3_600_000);
  world.ticks(4);
  world.finish();
}, SCENARIO_TIMEOUT_MS);
afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("a Session over the platform token ceiling with no wall text", () => {
  it("stops at the ceiling: one budget_exhausted blocker, no relaunch", () => {
    expect(world.tmux.launches).toHaveLength(1);
    const escalations = world.escalations();
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({ actionKey: world.actionKey(ACTION_1), kind: "budget_exhausted" });
    expect(escalations[0]?.message).toContain("ceiling of 3000000");
    expect(escalations[0]?.remedy).toContain("/todo");
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
  });

  it("names the ceiling and both token counts on the stop receipt and in the attempt row", () => {
    const receipt = withReadOnlyDatabase(world.workspace, (db) =>
      db.prepare("SELECT reason FROM session_exit_receipts WHERE session_id = ?").get(sessionId)
    ) as { reason: string };
    expect(receipt.reason).toContain("budget_exhausted");
    expect(receipt.reason).toContain(`${UNCACHED} uncached + ${CACHED} cached`);
    expect(receipt.reason).toContain("ceiling of 3000000");
    const rows = withReadOnlyDatabase(world.workspace, (db) => listProductionAttemptTokens(db, world.actionKey(ACTION_1)));
    expect(rows).toEqual([expect.objectContaining({ sessionId, inputTokens: UNCACHED, cachedInputTokens: CACHED })]);
  });
});
