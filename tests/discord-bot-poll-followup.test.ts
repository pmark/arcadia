import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaCli, CliTimeoutError, type ExecFileLike } from "../apps/discord-bot/src/arcadia/cli.js";
import {
  NOTIFICATION_POLL_CONCURRENCY,
  loadNotificationSnapshot,
  runOperatorPingPollTick
} from "../apps/discord-bot/src/notifications/poller.js";
import { createTimeoutBackoff, runWithTimeoutBackoff } from "../apps/discord-bot/src/notifications/pollBackoff.js";
import { runOrientationPacketComposeCommand } from "../src/commands/orientation.js";
import type { WorkMonitorSnapshot } from "../src/workMonitoring/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type LogEntry = { level: string; obj: Record<string, unknown> };
function logger(): { entries: LogEntry[]; log: (level: never, obj: Record<string, unknown>) => void } {
  const entries: LogEntry[] = [];
  return { entries, log: (level, obj) => void entries.push({ level: String(level), obj }) };
}

function timeoutKill(): Error {
  return Object.assign(new Error("Command failed: fake arcadia"), {
    killed: true,
    signal: "SIGTERM",
    code: null,
    stdout: "",
    stderr: ""
  });
}

describe("orientation compose never runs the network PR scan (Issue #2581 a)", () => {
  it("scans working copies from local Git evidence only, with PR lookup disabled", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-compose-2581-"));
    cleanup.push(workspace);
    initWorkspace(workspace);
    const scanOptions: Array<Record<string, unknown> | undefined> = [];
    const emptySnapshot: WorkMonitorSnapshot = {
      scannedAt: "2026-11-13T00:00:00.000Z",
      repositories: [],
      totals: {
        projects: 0, workingCopies: 0, unsaved: 0, localOnly: 0, pushedWithoutPr: 0,
        pullRequestUnknown: 0, inPr: 0, landed: 0, configurationErrors: 0
      }
    };

    await runOrientationPacketComposeCommand({
      workspace,
      ifDue: true,
      now: new Date("2026-11-13T17:00:00.000Z"),
      workScan: (_projects, options) => {
        scanOptions.push(options as Record<string, unknown> | undefined);
        return emptySnapshot;
      }
    });

    expect(scanOptions).toHaveLength(1);
    expect(scanOptions[0]?.includePullRequests).toBe(false);
  });
});

describe("timeout backoff (Issue #2581 b)", () => {
  it("skips a command for a bounded number of ticks after a timeout, then retries", async () => {
    const backoff = createTimeoutBackoff({ skipTicks: [1, 2, 4] });
    const { entries, log } = logger();
    let launches = 0;
    const doomed = async (): Promise<string> => {
      launches++;
      throw new CliTimeoutError("orientation", 200_000, "killed=true");
    };

    const outcomes: boolean[] = [];
    for (let tick = 0; tick < 4; tick++) {
      const outcome = await runWithTimeoutBackoff(backoff, "orientation compose", log, doomed).catch(() => "threw" as const);
      outcomes.push(outcome === "threw" ? false : (outcome as { skipped: boolean }).skipped);
    }

    // tick 0 launches and times out; tick 1 skipped; tick 2 launches again (times out); ticks 3 skipped
    expect(launches).toBe(2);
    expect(outcomes).toEqual([false, true, false, true]);
    const skipLog = entries.find((entry) => entry.obj.msg === "poll skipped after timeout");
    expect(skipLog?.obj.command).toBe("orientation compose");
    expect(String(skipLog?.obj.reason)).toContain("timed out");
  });

  it("caps the skip at the last bound and clears it after a success", async () => {
    const backoff = createTimeoutBackoff({ skipTicks: [1, 2] });
    const { log } = logger();
    let fail = true;
    let launches = 0;
    const call = async (): Promise<string> => {
      launches++;
      if (fail) throw new CliTimeoutError("review", 90_000, "killed=true");
      return "ok";
    };
    const tick = () => runWithTimeoutBackoff(backoff, "review", log, call).catch(() => "threw");

    for (let i = 0; i < 12; i++) await tick();
    // Never skips more than 2 consecutive ticks, so a launch happens at least every third tick.
    expect(launches).toBeGreaterThanOrEqual(4);

    fail = false;
    // drain any pending skip, then succeed
    for (let i = 0; i < 3; i++) await tick();
    const before = launches;
    await tick();
    await tick();
    expect(launches).toBe(before + 2);
  });

  it("does not back off for a non-timeout failure", async () => {
    const backoff = createTimeoutBackoff({ skipTicks: [3] });
    const { log } = logger();
    let launches = 0;
    const call = async (): Promise<string> => {
      launches++;
      throw new Error("Arcadia CLI failed: database locked");
    };
    await runWithTimeoutBackoff(backoff, "queue", log, call).catch(() => undefined);
    await runWithTimeoutBackoff(backoff, "queue", log, call).catch(() => undefined);
    expect(launches).toBe(2);
  });

  it("ArcadiaCli raises a typed CliTimeoutError that keeps the #2572 message", async () => {
    const exec: ExecFileLike = async () => {
      throw timeoutKill();
    };
    let now = 0;
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec, clock: () => (now += 30_000) });
    const error = await cli.review().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliTimeoutError);
    expect((error as CliTimeoutError).label).toBe("review");
    expect((error as Error).message).toContain("timed out after 90s");
    expect((error as Error).message).toContain("signal=SIGTERM");
  });
});

describe("ping poll is independent of the snapshot fan-out (Issue #2581 c)", () => {
  it("gives `ping pending` a longer timeout than the 30 s default", async () => {
    const timeouts: number[] = [];
    const exec: ExecFileLike = async (_file, _args, options) => {
      timeouts.push(options.timeout);
      return { stdout: JSON.stringify({ ok: true, data: { pings: [] } }), stderr: "" };
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec });
    await cli.operatorPings();
    expect(timeouts[0]).toBeGreaterThan(30_000);
  });

  it("does not count ping calls against the 3-slot snapshot limiter, even while it is saturated", async () => {
    const started: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const empty = { requiresReviewCount: 0, items: [], queues: { blocked: [] }, runs: [], milestones: [], tasks: [], notifications: [], pings: [] };
    const exec: ExecFileLike = async (_file, args) => {
      started.push(args[0] === "ping" ? "ping" : args[0]);
      if (args[0] !== "ping") await gate;
      return { stdout: JSON.stringify({ ok: true, data: empty }), stderr: "" };
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec });

    const snapshot = loadNotificationSnapshot(cli);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started.filter((name) => name !== "ping")).toHaveLength(NOTIFICATION_POLL_CONCURRENCY);

    const { log } = logger();
    const drained = await runOperatorPingPollTick(cli, { discordChannelId: "c", pingChannels: {} }, async () => ({ id: "m" }), log);
    expect(started).toContain("ping");
    expect(drained).toBe(0);

    release();
    await snapshot;
  });

  it("a ping timeout is logged, never throws, and the next tick still launches the ping call", async () => {
    const calls: string[] = [];
    const exec: ExecFileLike = async (_file, args) => {
      calls.push(args[0]);
      if (args[0] === "ping") throw timeoutKill();
      return { stdout: JSON.stringify({ ok: true, data: {} }), stderr: "" };
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec });
    const { entries, log } = logger();

    for (let tick = 0; tick < 3; tick++) {
      await runOperatorPingPollTick(cli, { discordChannelId: "c", pingChannels: {} }, async () => ({ id: "m" }), log);
    }

    // Pages depend on pings: a ping timeout is logged and never throws, and the ping poll never backs off.
    expect(calls.filter((name) => name === "ping")).toHaveLength(3);
    expect(entries.some((entry) => entry.obj.msg === "discord operator ping poll failed")).toBe(true);
  });
});
