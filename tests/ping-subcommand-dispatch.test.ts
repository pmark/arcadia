import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/cli.js";
import { runPingPendingCommand } from "../src/commands/ping.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

// Drives the real `arcadia ping` command tree. Every run passes an explicit temp
// --workspace, so nothing is queued in the live workspace or sent to Discord.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-ping-dispatch-"));
  roots.push(root);
  const workspacePath = path.join(root, "workspace");
  initWorkspace(workspacePath);
  return workspacePath;
}

// --workspace goes straight after `send` (before any `--`), or at the end of an implicit send.
async function runPing(ws: string, args: string[]): Promise<void> {
  const tail = args[0] === "send" ? ["send", "--workspace", ws, ...args.slice(1)] : [...args, "--workspace", ws];
  await buildProgram().parseAsync(["node", "arcadia", "ping", ...tail]);
}

function queuedMessages(ws: string): string[] {
  return runPingPendingCommand({ workspace: ws }).data.pings.map((ping) => ping.message);
}

describe("ping subcommand dispatch", () => {
  let savedExitCode: typeof process.exitCode;
  beforeEach(() => {
    savedExitCode = process.exitCode;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
  });

  it.each(["list", "ls", "status", "show", "List"])("refuses a lone %s with usage instead of queueing it", async (word) => {
    const ws = workspace();
    await runPing(ws, [word]);
    expect(process.exitCode).toBe(2);
    expect(queuedMessages(ws)).toEqual([]);
  });

  it("still sends an explicit send with a lone word", async () => {
    const ws = workspace();
    await runPing(ws, ["send", "list"]);
    expect(queuedMessages(ws)).toEqual(["list"]);
  });

  it("keeps the -- form for messages starting with pending or sent", async () => {
    const ws = workspace();
    await runPing(ws, ["send", "--", "pending", "review", "the", "queue"]);
    await runPing(ws, ["send", "--", "sent"]);
    expect(queuedMessages(ws)).toEqual(["pending review the queue", "sent"]);
  });

  it("keeps implicit multi-word messages queueing as before", async () => {
    const ws = workspace();
    await runPing(ws, ["Look", "at", "Actions"]);
    expect(queuedMessages(ws)).toEqual(["Look at Actions"]);
  });
});
