import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[][] = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFile = Object.assign(() => undefined, {
    [promisify.custom]: (_command: string, args: string[]) => {
      calls.push(args);
      return Promise.resolve({
        stdout: JSON.stringify({ ok: true, command: "session.launch", data: { reused: false, session: { id: "session_1" } } }),
        stderr: ""
      });
    }
  });
  return { ...actual, execFile };
});

import { launchGuardedSession } from "./arcadia-cli";

beforeEach(() => { calls.length = 0; });

describe("launchGuardedSession's CLI arguments", () => {
  it("passes the dashboard confirmation flag only for a confirmed operator Launch", async () => {
    await launchGuardedSession("/repo", "req-1", "abc", { operatorLaunch: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.arrayContaining([
      "session", "launch", "--repo", "/repo", "--request-id", "req-1", "--preview-fingerprint", "abc", "--operator-launch-dashboard", "--json"
    ]));
  });

  it("passes no authorization flag otherwise", async () => {
    await launchGuardedSession("/repo", "req-1", "abc");
    await launchGuardedSession("/repo", "req-2", "def", { operatorLaunch: false });
    expect(calls).toHaveLength(2);
    for (const args of calls) {
      expect(args.some((arg) => arg.startsWith("--operator-launch"))).toBe(false);
    }
  });
});
