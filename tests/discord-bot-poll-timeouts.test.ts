import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArcadiaCli, buildCliInvocation, resolveCliChoice, type ExecFileLike } from "../apps/discord-bot/src/arcadia/cli.js";
import { loadNotificationSnapshot } from "../apps/discord-bot/src/notifications/poller.js";

interface FakeCall {
  file: string;
  args: string[];
  timeout: number;
}

function okStdout(data: unknown): string {
  return JSON.stringify({ ok: true, data });
}

/** Stand-in for a CLI call that the Node execFile timeout kill produces. */
function timeoutKill(): Error {
  return Object.assign(new Error("Command failed: fake arcadia"), {
    killed: true,
    signal: "SIGTERM",
    code: null,
    stdout: "",
    stderr: ""
  });
}

function clockFrom(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

const emptyListData = {
  requiresReviewCount: 0,
  items: [],
  queues: { blocked: [] },
  runs: [],
  milestones: [],
  tasks: [],
  notifications: []
};

describe("discord poll CLI timeout messaging (Issue #2569 a)", () => {
  it("says a killed call timed out, with signal, exit code and elapsed ms", async () => {
    const exec: ExecFileLike = async () => {
      throw timeoutKill();
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec, clock: clockFrom([1_000, 31_000]) });

    const error = await cli.review().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("timed out after 30s");
    expect(message).toContain("signal=SIGTERM");
    expect(message).toContain("exit code=null");
    expect(message).toContain("elapsed 30000 ms");
    expect(message).toContain("review");
  });

  it("reports the configured timeout, not a hard-coded 30s, for a per-command timeout", async () => {
    const exec: ExecFileLike = async () => {
      throw timeoutKill();
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec, clock: clockFrom([0, 120_000]) });

    const error = await cli.status().catch((caught: unknown) => caught);

    expect((error as Error).message).toContain("timed out after 120s");
    expect((error as Error).message).toContain("elapsed 120000 ms");
  });

  it("keeps exit code and stderr detail for a non-timeout failure", async () => {
    const exec: ExecFileLike = async () => {
      throw Object.assign(new Error("Command failed: fake"), {
        killed: false,
        signal: null,
        code: 1,
        stdout: "",
        stderr: "database locked"
      });
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec, clock: clockFrom([0, 50]) });

    const error = await cli.review().catch((caught: unknown) => caught);

    const message = (error as Error).message;
    expect(message).toContain("database locked");
    expect(message).toContain("exit code=1");
    expect(message).not.toContain("timed out");
  });
});

describe("discord poll per-command timeouts (Issue #2569 c)", () => {
  it("gives status a 120 s timeout while other calls keep the 30 s default", async () => {
    const calls: FakeCall[] = [];
    const exec: ExecFileLike = async (file, args, options) => {
      calls.push({ file, args, timeout: options.timeout });
      return { stdout: okStdout(emptyListData), stderr: "" };
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec });

    await cli.status().catch(() => undefined);
    await cli.review();

    expect(calls[0].timeout).toBe(120_000);
    expect(calls[1].timeout).toBe(30_000);
  });
});

describe("discord notification poll concurrency (Issue #2569 c)", () => {
  it("never runs more than 3 poll CLI calls at once and still completes all 7", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: string[] = [];
    const exec: ExecFileLike = async (_file, args) => {
      calls.push(args[0]);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { stdout: okStdout(emptyListData), stderr: "" };
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec });

    const snapshot = await loadNotificationSnapshot(cli);

    expect(calls).toHaveLength(7);
    expect(maxInFlight).toBe(3);
    expect(snapshot.requiresReviewCount).toBe(0);
  });
});

describe("discord bot CLI invocation choice (Issue #2569 b, revised)", () => {
  const distCli = path.join("dist", "src", "cli.js");
  const sourceCli = path.join("src", "cli.ts");

  it("does not prefer a built dist CLI when ARCADIA_CLI_PATH is unset", () => {
    // dist is gitignored and not rebuilt by the service restart, so it can be stale.
    const invocation = buildCliInvocation(["status", "--json"], null, () => true);

    expect(invocation.command).not.toBe(process.execPath);
    expect(invocation.args[0].endsWith(distCli)).toBe(false);
    expect(invocation.args[0].endsWith(sourceCli)).toBe(true);
    expect(invocation.args.slice(1)).toEqual(["status", "--json"]);
  });

  it("keeps ARCADIA_CLI_PATH winning even when dist and source both exist", () => {
    const invocation = buildCliInvocation(["status", "--json"], "/opt/arcadia", () => true);

    expect(invocation.command).toBe("/opt/arcadia");
    expect(invocation.args).toEqual(["status", "--json"]);
  });

  it("falls back to the source CLI through tsx when ARCADIA_CLI_PATH is unset", () => {
    const invocation = buildCliInvocation(["status", "--json"], null, (candidate) => candidate.endsWith(sourceCli));

    expect(invocation.args[0].endsWith(sourceCli)).toBe(true);
    expect(invocation.args.slice(1)).toEqual(["status", "--json"]);
  });

  it("reports at startup which CLI was chosen and why", () => {
    const envChoice = resolveCliChoice("/opt/arcadia", () => true);
    expect(envChoice.kind).toBe("env");
    expect(envChoice.command).toBe("/opt/arcadia");
    expect(envChoice.reason).toContain("ARCADIA_CLI_PATH is set");

    const tsxChoice = resolveCliChoice(null, (candidate) => candidate.endsWith(sourceCli));
    expect(tsxChoice.kind).toBe("tsx");
    expect(tsxChoice.reason).toContain("ARCADIA_CLI_PATH is unset");
    expect(tsxChoice.kind === "tsx" && tsxChoice.sourceCli.endsWith(sourceCli)).toBe(true);
  });
});

describe("discord poll failure labels never carry free text (Issue #2569 a)", () => {
  it("omits an Ask request body from a timeout message", async () => {
    const exec: ExecFileLike = async () => {
      throw timeoutKill();
    };
    const cli = new ArcadiaCli({ workspace: "/ws", cliPath: "/bin/arcadia", exec, clock: clockFrom([0, 30_000]) });

    const error = await cli.ask("operator private request words", {}).catch((caught: unknown) => caught);

    expect((error as Error).message).toContain("Arcadia CLI ask timed out");
    expect((error as Error).message).not.toContain("private");
  });
});
