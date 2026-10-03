import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LINE_A, LINE_B, LINE_C, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * The opt-in three-Action variant of the hermetic rehearsal: the real worker
 * tick, real Git, real settlement and integration, with only tmux, the agent's
 * edits and provider capacity/sign-in simulated (see the harness). It proves
 * serial dependency selection across three Actions, that Off between two
 * Actions fences the next launch, and that after re-activation the following
 * ticks launch the next Action exactly once. Later ticks open fresh
 * database connections and registries but share this process, so they are
 * not a full worker-process restart.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const CRITERIA_B = [
  "MARKER.md contains both lines, action A's line before action B's line.",
  'tests/marker.test.mjs exists and "node --test" passes, asserting both lines appear in order.'
];
const CRITERIA_C = ["MARKER.md contains the A, B and C lines in that order."];
const MARKER_TEST = `import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
test("marker lines are in order", () => {
  assert.ok(readFileSync("MARKER.md", "utf8").startsWith(${JSON.stringify(`${LINE_A}\n${LINE_B}\n`)}));
});
`;

describe("three-Action rehearsal: serial selection, between-Action Off, later ticks", () => {
  it("launches only the next dependency-ready Action, fences Off between B and C, and launches C exactly once after On across later ticks", () => {
    const rehearsal = new Rehearsal({ thirdAction: true });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate();

    // A is the only dependency-ready Action; B and C wait on it.
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
    const a = rehearsal.lease()!;
    expect(a.action_id).toBe("write-marker-a");
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);

    // After A integrates, B -- never C -- is selected next.
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionB, 4);
    const b = rehearsal.lease()!;
    expect(b.action_id).toBe("write-marker-b");
    expect(rehearsal.sessions().map((s) => s.action_id)).toEqual(["write-marker-a", "write-marker-b"]);

    rehearsal.agentEdit(b, "MARKER.md", `${LINE_A}\n${LINE_B}\n`);
    rehearsal.agentEdit(b, "tests/marker.test.mjs", MARKER_TEST);
    rehearsal.agentFinish(b, CRITERIA_B);
    rehearsal.tmux.exit(b.tmux_session_name);
    const integrated = rehearsal.tick();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-b")).toBe("done");
    expect(rehearsal.pointer()).toBe("write-marker-c");
    // C needs its own packet; it has not launched in the integrating tick.
    expect(integrated.launch?.outcome).not.toBe("launched");
    const launchesBetween = rehearsal.tmux.launches.length;

    // Off between B and C: nothing launches, however many ticks pass.
    rehearsal.deactivate("turn-off-between-b-and-c");
    const fenced = [rehearsal.tick(), rehearsal.tick(), rehearsal.tick()];
    expect(fenced.every((r) => r.launch === null || r.launch.outcome !== "launched")).toBe(true);
    expect(rehearsal.tmux.launches).toHaveLength(launchesBetween);
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.status().liveAdmissions).toBe(0);

    // A fresh On grant: C (the only dependency-ready Action) launches once.
    rehearsal.activate("reactivate-for-c-20260926T233000Z");
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionC, 4);
    const c = rehearsal.lease()!;
    expect(c.action_id).toBe("write-marker-c");
    expect(readFileSync(path.join(c.worktree_path, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n`);

    // Later ticks (fresh connections and registries, same process) never duplicate C.
    const later = [rehearsal.tick(), rehearsal.tick()];
    expect(later.every((r) => r.launch?.outcome !== "launched")).toBe(true);
    expect(rehearsal.lease()?.id).toBe(c.id);
    expect(rehearsal.sessions().filter((s) => s.action_id === "write-marker-c")).toHaveLength(1);

    rehearsal.agentEdit(c, "MARKER.md", `${LINE_A}\n${LINE_B}\n${LINE_C}\n`);
    rehearsal.agentFinish(c, CRITERIA_C);
    rehearsal.tmux.exit(c.tmux_session_name);
    const finished = rehearsal.tick();
    expect(finished.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-c")).toBe("done");
    expect(readFileSync(path.join(rehearsal.repo, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n${LINE_C}\n`);
    const after = [rehearsal.tick(), rehearsal.tick()];
    expect(after.every((r) => r.launch?.outcome !== "launched")).toBe(true);
    expect(rehearsal.sessions().map((s) => s.action_id)).toEqual(["write-marker-a", "write-marker-b", "write-marker-c"]);
    expect(rehearsal.status().liveAdmissions).toBe(0);
  });
});
