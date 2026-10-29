import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionLogPath } from "../../src/sessions/sessionRecording.js";
import { issueSessionProbe } from "../../src/sessions/sessionProbeCommand.js";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * The in-Session probe (the Session's first step) fails: its sandbox cannot
 * write the workspace database. The Session stops at once (a tiny token spend),
 * and the lifecycle must end the attempt with exactly one `environment_wall`
 * blocker that carries the probe JSON, with no second launch.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("session-probe-wall", isolation, import.meta.filename);
  world.start();
  world.expectError(/The candidate has no commits or changes beyond its base revision/);
  const { session, launch } = world.untilLaunched(ACTION_1, 3);
  const issued = issueSessionProbe({ workspace: world.workspace, sessionId: session.id, packetId: session.packet_id,
    packetSha256: session.packet_sha256, worktreePath: session.worktree_path, directWorkspaceWrite: "required" });
  const probe = {
    probe: "session-capability/v2", contract: issued.contractDigest, ok: false, ms: 31,
    checks: [
      { name: "workspace_write", ok: false, required: true, error: "EROFS: read-only file system, open 'database/.probe'" },
      { name: "host_validation", ok: true },
      { name: "preservation", ok: true }
    ]
  };
  const file = sessionLogPath(world.workspace, session.id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "probe", name: "Bash", input: { command: issued.command } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "probe", content: `${JSON.stringify(probe)}\n` }] } }),
    JSON.stringify({ type: "result", usage: { input_tokens: 1800, output_tokens: 90 } })
  ].join("\n"));
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

describe("a failed in-Session probe", () => {
  it("ends in exactly one environment_wall blocker with the probe JSON, without a second launch", () => {
    expect(world.tmux.launches).toHaveLength(1);
    const escalations = world.escalations();
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({ actionKey: world.actionKey(ACTION_1), kind: "environment_wall" });
    expect(escalations[0]?.message).toContain("session probe");
    expect(escalations[0]?.message).toContain("session-capability/v2");
    expect(escalations[0]?.message).toContain("workspace_write");
    expect(escalations[0]?.remedy).toContain("reset this Action's repair budget");
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
    expect(git(world.repo, ["rev-parse", "--verify", "refs/heads/main"]).trim()).not.toBe("");
  });
});
