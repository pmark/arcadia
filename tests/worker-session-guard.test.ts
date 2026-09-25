import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findEnclosingManagedSessionTmuxName,
  runWorkerInstallCommand,
  runWorkerStartCommand,
  runWorkerStopCommand
} from "../src/commands/worker.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];
const fixtures: ChildProcess[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const child of fixtures.splice(0)) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function captureStdout(run: () => void): string {
  let captured = "";
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    captured += String(chunk);
    return true;
  });
  try { run(); } finally { write.mockRestore(); }
  return captured;
}

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-worker-session-guard-"));
  temporary.push(root);
  initWorkspace(root);
  return root;
}

/**
 * A real child process with its environment fully cleared and its working
 * directory pointed at the host workspace -- the exact evasion the Ask names
 * (Issue #611). Kept alive with a timer so a `ps` snapshot taken right after
 * spawning it reliably observes the PID.
 */
async function bareChildProcess(cwd: string): Promise<{ pid: number }> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: ["ignore", "ignore", "ignore"],
    env: {},
    cwd
  });
  fixtures.push(child);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  return { pid: child.pid! };
}

describe("findEnclosingManagedSessionTmuxName", () => {
  it("returns null when no tmux panes exist at all", () => {
    expect(findEnclosingManagedSessionTmuxName(process.pid, { listTmuxPanes: () => [] })).toBeNull();
  });

  it("returns null when live panes exist but none are Arcadia-managed", () => {
    expect(findEnclosingManagedSessionTmuxName(1234, {
      listTmuxPanes: () => [{ pid: 999, sessionName: "operators-own-scratch-session" }],
      listProcesses: () => [{ pid: 1234, ppid: 999 }]
    })).toBeNull();
  });

  it("matches when the checked pid is itself the managed pane leader", () => {
    expect(findEnclosingManagedSessionTmuxName(555, {
      listTmuxPanes: () => [{ pid: 555, sessionName: "arcadia-demo-do-thing-20260101t000000z" }],
      listProcesses: () => []
    })).toBe("arcadia-demo-do-thing-20260101t000000z");
  });

  it("matches a multi-hop descendant of a managed pane leader", () => {
    const panes = [{ pid: 100, sessionName: "arcadia-demo-do-thing-20260101t000000z" }];
    // 400 -> 300 -> 200 -> 100 (pane leader) -> 1
    const processes = [
      { pid: 400, ppid: 300 },
      { pid: 300, ppid: 200 },
      { pid: 200, ppid: 100 },
      { pid: 100, ppid: 1 }
    ];
    expect(findEnclosingManagedSessionTmuxName(400, { listTmuxPanes: () => panes, listProcesses: () => processes }))
      .toBe("arcadia-demo-do-thing-20260101t000000z");
  });

  it("returns null for a process whose own ancestry never reaches the managed pane, even though an unrelated managed pane exists elsewhere", () => {
    const panes = [{ pid: 100, sessionName: "arcadia-demo-do-thing-20260101t000000z" }];
    // 900 -> 901 -> 1, entirely separate from the managed pane's tree.
    const processes = [
      { pid: 900, ppid: 901 },
      { pid: 901, ppid: 1 },
      { pid: 100, ppid: 1 }
    ];
    expect(findEnclosingManagedSessionTmuxName(900, { listTmuxPanes: () => panes, listProcesses: () => processes }))
      .toBeNull();
  });

  it("proves the refusal survives a real process whose environment is fully cleared and whose cwd is the host workspace", async () => {
    const root = workspace();
    const child = await bareChildProcess(root);
    const sessionName = "arcadia-realproof-do-thing-20260101t000000z";

    // The fake pane leader is *this test process* (process.pid), not the
    // checked process -- the child's real ppid, read via the real `ps`
    // (listProcesses is left at its default), is process.pid. This actually
    // walks a genuine parent link rather than matching the checked pid
    // against itself, proving the match survives a genuinely empty
    // environment and a genuinely changed working directory on the child --
    // neither of which this check ever consults.
    expect(findEnclosingManagedSessionTmuxName(child.pid, {
      listTmuxPanes: () => [{ pid: process.pid, sessionName }]
    })).toBe(sessionName);
  });
});

describe("worker lifecycle commands refuse a managed-Session caller", () => {
  const insideSession = {
    listTmuxPanes: () => [{ pid: process.pid, sessionName: "arcadia-demo-withhold-20260101t000000z" }]
  };
  const outsideSession = { listTmuxPanes: () => [] };

  it("refuses `worker stop` from inside a managed Session, naming the session", () => {
    const root = workspace();
    expect(() => runWorkerStopCommand({ workspace: root }, insideSession))
      .toThrow(/Refusing to stop the shared host worker.*arcadia-demo-withhold-20260101t000000z/);
  });

  it("refuses `worker start` from inside a managed Session, naming the session, before it ever registers as a daemon", () => {
    const root = workspace();
    // The refusal fires before any signal handler is installed, so no cleanup
    // wrapper is needed here (contrast the success path in worker-tick.test.ts).
    expect(() => runWorkerStartCommand({ workspace: root }, insideSession))
      .toThrow(/Refusing to start the shared host worker.*arcadia-demo-withhold-20260101t000000z/);
  });

  it("refuses `worker install` from inside a managed Session, naming the session", () => {
    const root = workspace();
    expect(() => runWorkerInstallCommand({ workspace: root }, insideSession))
      .toThrow(/Refusing to install the shared host worker.*arcadia-demo-withhold-20260101t000000z/);
  });

  it("fails closed when a managed pane is live but the host process table cannot be read", () => {
    const root = workspace();
    expect(() => runWorkerStopCommand({ workspace: root }, {
      listTmuxPanes: () => [{ pid: 4242, sessionName: "arcadia-demo-withhold-20260101t000000z" }],
      listProcesses: () => []
    })).toThrow(/ancestry could not be verified because the host process table could not be read/);
  });

  it("leaves the operator's own terminal path unaffected: `worker stop` behaves normally with no managed pane in scope", () => {
    const root = workspace();
    const output = captureStdout(() => runWorkerStopCommand({ workspace: root }, outsideSession));
    expect(output).toContain("Worker is not running");
  });

  it("leaves the launchd/operator install path unaffected: `worker install` proceeds with no managed pane in scope", () => {
    const root = workspace();
    // Unlike the refusal test above, this one reaches the real plist-writing
    // path in runWorkerInstallCommand, which writes to
    // `$HOME/Library/LaunchAgents`. Stub HOME to the temp workspace so this
    // never touches the developer's actual launchd plist (Issue #560 is the
    // same footgun in the pre-existing worker-tick.test.ts suite).
    vi.stubEnv("HOME", root);
    const load = vi.fn();
    runWorkerInstallCommand({ workspace: root }, {
      ...outsideSession,
      execFileSync: load,
      waitForRoutes: () => true,
      now: () => 123_456
    });
    expect(load).toHaveBeenCalledWith("launchctl", expect.arrayContaining(["load"]), { stdio: "pipe" });
  });
});
