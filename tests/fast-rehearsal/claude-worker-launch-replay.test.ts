import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemTmux } from "../../src/sessions/index.js";
import { sessionLogPath } from "../../src/sessions/sessionRecording.js";
import { withReadOnlyDatabase } from "../../src/db/connection.js";
import { PROVIDER } from "../helpers/rehearsalHarness.js";
import { isolateProcess, shellQuote, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult, LaunchRecord } from "./helpers/executor.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS, WORK } from "./helpers/world.js";

/**
 * Action `claude-worker-launch-replay`: one production tick launch on the
 * `claude-code-cli` provider, through the REAL tmux launch path.
 *
 * Every other fast-rehearsal scenario records the launch in `FakeTmux`. Here
 * the worker tick's tmux adapter is `systemTmux` itself, so the tick runs the
 * real `tmux new-session` subprocess with the real recording wrapper
 * (`wrapRecordedLaunch`, `scripts/record-session-exit.mjs`) on a real tmux
 * server. Two things are still stand-ins, both external:
 *
 * - the tmux server's socket: a `tmux` first on PATH execs the real binary
 *   with `-S <scenario socket>` (systemTmux strips `TMUX`/`TMUX_TMPDIR`, so a
 *   socket flag is the only way to keep the replay off the host's server);
 * - the `claude` binary (a paid model): a stub that records the argv and
 *   working directory tmux handed it, prints one stream-json line, and stays
 *   alive until the scenario releases it. The scripted executor then does the
 *   agent's work from that same argv, and GitHub is the shared fake.
 *
 * The Session is asserted `running` while its pane is live (and across a
 * tick that sees it live), its exit code is recorded by the wrapper, and the
 * terminal tick preserves it as a draft PR. This is also the replay of the
 * 2026-10-11 launch failure (155 failures, "tmux could not start", cause
 * discarded): if the real launch path still failed, `untilLaunched` would
 * throw with the retained cause (`formatLaunchFailure`, PR #1416).
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
let socketDir = "";
let socket = "";
let stubLog = "";
let release = "";
let launch: LaunchRecord;
let sessionId = "";
let statusAtLaunch = "";
let statusWhileLive = "";
let liveTickReconciled = -1;
let paneWhileLive: string | null = null;
let stubCall: { argv: string[]; cwd: string } | null = null;
let executed: ExecutorResult;
let exitStatus: number | null = null;
let sessionLog = "";
let statusAfterExit = "";

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitFor(what: string, done: () => boolean, ms = 30_000): void {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    sleep(50);
  }
}

function sessionRow(id: string): { status: string; exit_status: number | null } {
  return withReadOnlyDatabase(world.workspace, (db) => db.prepare("SELECT status, exit_status FROM agent_sessions WHERE id = ?").get(id) as {
    status: string; exit_status: number | null;
  });
}

const tmuxBinary = (() => {
  try { return execFileSync("/bin/sh", ["-c", "command -v tmux"], { encoding: "utf8" }).trim(); } catch { return ""; }
})();

describe.skipIf(!tmuxBinary)("claude-worker-launch-replay: a production tick launch on claude-code-cli through real tmux", () => {
  beforeAll(() => {
    isolation = isolateProcess();
    world = new FastRehearsal("claude-worker-launch-replay", isolation, import.meta.filename);
    const bin = path.join(isolation.root, "replay-bin");
    mkdirSync(bin, { recursive: true });
    // A short directory: a Unix socket path is limited to 104 bytes on macOS,
    // which a socket under the isolated `$TMPDIR` root can exceed.
    socketDir = mkdtempSync("/tmp/arcadia-replay-tmux-");
    socket = path.join(socketDir, "s");
    stubLog = path.join(isolation.root, "claude-stub-calls.jsonl");
    release = path.join(isolation.root, "claude-stub-release");
    // The real tmux, on the scenario's own server socket. It replaces the
    // harness's PATH tmux fake, so the queue's own `systemTmux` reads see the
    // same live server as the tick.
    writeFileSync(path.join(bin, "tmux"), `#!/bin/sh\nexec ${shellQuote(tmuxBinary)} -S ${shellQuote(socket)} "$@"\n`);
    // The provider stand-in. Only the headless launch blocks; any other call
    // (a preflight probe) answers and is recorded.
    writeFileSync(path.join(bin, "claude"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(stubLog)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
if (!process.argv.includes("--print")) process.exit(0);
console.log(JSON.stringify({ type: "system", subtype: "init", note: "claude stub (fast-rehearsal replay)" }));
const wait = () => fs.existsSync(${JSON.stringify(release)}) ? process.exit(0) : setTimeout(wait, 50);
wait();
setTimeout(() => process.exit(3), 120000);
`);
    chmodSync(path.join(bin, "tmux"), 0o755);
    chmodSync(path.join(bin, "claude"), 0o755);
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
    // The tick's injected adapter is the production one; launches are still
    // recorded so `untilLaunched` can hand the exact argv to the executor.
    world.tmux.available = () => systemTmux.available();
    world.tmux.hasSession = (name) => systemTmux.hasSession(name);
    world.tmux.capturePane = (name) => systemTmux.capturePane!(name);
    world.tmux.launch = (input) => {
      systemTmux.launch(input);
      world.tmux.launches.push({ name: input.name, cwd: input.cwd, command: input.command, args: input.args });
    };

    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    launch = first.launch;
    sessionId = first.session.id;
    statusAtLaunch = sessionRow(sessionId).status;
    waitFor("the claude stub to start in the tmux pane", () => existsSync(stubLog) && readFileSync(stubLog, "utf8").includes("--print"));
    stubCall = readFileSync(stubLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { argv: string[]; cwd: string })
      .find((call) => call.argv.includes("--print")) ?? null;
    waitFor("the pane to show the provider's output", () => (systemTmux.capturePane!(launch.name) ?? "").includes("claude stub"));
    paneWhileLive = systemTmux.capturePane!(launch.name);
    // A tick while the agent works: the Session is live, nothing reconciles.
    liveTickReconciled = world.tick().reconciled.length;
    statusWhileLive = sessionRow(sessionId).status;

    executed = world.executor.run(launch, WORK[ACTION_1], "clean");
    writeFileSync(release, "");
    waitFor("the pane to end", () => !systemTmux.hasSession(launch.name));
    const row = sessionRow(sessionId);
    exitStatus = row.exit_status;
    const log = sessionLogPath(world.workspace, sessionId);
    sessionLog = existsSync(log) ? readFileSync(log, "utf8") : "";
    world.tickUntil((r) => r.handoff?.preservation.kind === "preserved", 3);
    statusAfterExit = sessionRow(sessionId).status;
    world.finish();
  }, SCENARIO_TIMEOUT_MS);

  afterAll(() => {
    try { if (socket) execFileSync(tmuxBinary, ["-S", socket, "kill-server"], { stdio: "ignore" }); } catch { /* no server left */ }
    if (socketDir) rmSync(socketDir, { recursive: true, force: true });
    isolation?.restore();
  });

  it("launches on the claude-code-cli provider through the real tmux adapter (the 2026-10-11 launch failure does not reproduce)", () => {
    expect(world.provider).toBe(PROVIDER);
    expect(PROVIDER).toBe("claude-code-cli");
    const session = world.sessions().find((entry) => entry.id === sessionId);
    expect(session?.provider).toBe("claude-code-cli");
    expect(session?.provider_profile).toBe("claude_build");
    expect(launch.args).toContain("claude");
    expect(world.redAlerts()).toEqual([]);
    expect(world.recorder.errors.filter((error) => !error.expected)).toEqual([]);
  });

  it("hands the provider the exact argv and worktree tmux was asked to run", () => {
    expect(stubCall).not.toBeNull();
    expect(stubCall!.cwd).toBe(path.resolve(launch.cwd));
    expect(launch.args).toEqual(expect.arrayContaining(["--print", "--output-format", "stream-json"]));
    // The brief, the last argument, crosses tmux and the recording wrapper intact.
    expect(stubCall!.argv.at(-1)).toBe(launch.args.at(-1));
    expect(paneWhileLive).toContain("claude stub");
  });

  it("keeps the Session running while its pane is live", () => {
    expect(statusAtLaunch).toBe("running");
    expect(liveTickReconciled).toBe(0);
    expect(statusWhileLive).toBe("running");
  });

  it("records the provider's exit through the recording wrapper and reconciles it", () => {
    expect(exitStatus).toBe(0);
    expect(sessionLog).toContain("claude stub (fast-rehearsal replay)");
    expect(sessionLog).toContain("arcadia: provider exited with status 0");
    expect(statusAfterExit).toBe("completed");
    expect(executed.settlementCommit).toBeTruthy();
  });

  it("records a draft PR for the preserved candidate", () => {
    const pr = world.pullRequestFor(ACTION_1);
    expect(pr).not.toBeNull();
    expect(pr!.isDraft).toBe(true);
    const receipt = world.preservationReceipt(ACTION_1);
    expect(receipt).not.toBeNull();
    expect(JSON.stringify(receipt)).toContain(pr!.url);
  });

  it("runs no guarded binary", () => {
    expect(isolation.guardCalls()).toEqual([]);
  });
});
