import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withReadOnlyDatabase } from "../src/db/connection.js";
import { repeatedRefusalSignature } from "../src/production/tick.js";
import { isolateProcess, type IsolatedProcess } from "./fast-rehearsal/helpers/environment.js";
import type { ActionWork, LaunchRecord } from "./fast-rehearsal/helpers/executor.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS, WORK } from "./fast-rehearsal/helpers/world.js";

/**
 * Issue #2927: a resumed Session that ends in the same refusal as the one before it made no progress even when
 * its head moved (each attempt drafts a completion Ask named after the previous head). The repair budget
 * counts it; a different refusal or a completed Action resets it.
 */
describe("repeatedRefusalSignature", () => {
  const reason = (head: string, note: string) =>
    `The Session exited with an unfinished candidate that can be resumed. The Session's drafted complete Ask (.arcadia/asks/agent-ask-complete-x-${head}.yaml) was not settled: ${note}`;
  it("is equal across heads and case, so the moving head does not hide a repeated refusal", () => {
    expect(repeatedRefusalSignature(reason("f9945088beff", 'its note says "Not run"')))
      .toBe(repeatedRefusalSignature(reason("c10543602895", 'its note says "not run"')));
  });
  it("differs when the refusal itself differs", () => {
    expect(repeatedRefusalSignature(reason("f9945088beff", "tests did not pass")))
      .not.toBe(repeatedRefusalSignature(reason("f9945088beff", "the typecheck failed")));
  });
});

let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

const attempts = (world: FastRehearsal) => withReadOnlyDatabase(world.workspace, (db) =>
  (db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?").get(world.actionKey(ACTION_1)) as { attempts: number } | undefined)?.attempts ?? 0);
const more = (name: string): ActionWork => ({ files: { ...(WORK[ACTION_1].files as Record<string, string>), [name]: `${name}\n` }, validation: WORK[ACTION_1].validation });

describe("a resume that moves the head but ends in the same refusal", () => {
  let world: FastRehearsal;
  let afterFirstMoved: number;
  let afterSecondMoved: number;
  beforeAll(() => {
    world = new FastRehearsal("repeated-refusal-budget", isolation, import.meta.filename);
    worlds.push(world);
    world.expectError(/repair budget|exhaust|Red alert/i);
    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    world.execute(first.launch, ACTION_1, "interrupted-after-work-commit");
    const second: LaunchRecord = world.untilLaunched(ACTION_1, 6).launch;
    world.execute(second, ACTION_1, "interrupted-after-work-commit", more("A.md"));
    const third: LaunchRecord = world.untilLaunched(ACTION_1, 6).launch;
    afterFirstMoved = attempts(world);
    world.execute(third, ACTION_1, "interrupted-after-work-commit", more("B.md"));
    world.ticks(1);
    afterSecondMoved = attempts(world);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("spends nothing on the first head-moving resume (it only remembers the refusal)", () => {
    expect(afterFirstMoved).toBe(0);
  });
  it("spends a repair attempt on the next identical refusal even though the head moved again", () => {
    expect(afterSecondMoved).toBe(1);
  });
});
