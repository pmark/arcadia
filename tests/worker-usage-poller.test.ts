import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerTick, runUsagePollLoop, startWorkerUsagePoller, type WorkerUsagePoller } from "../src/commands/worker.js";

// Issue #3122: START's sign-in lead wait needs a usage beat younger than 8 s
// within 16 s. The beat used to be written only as the tick's first step, so a
// tick whose synchronous body ran ~10-25 s left a healthy worker looking dead.

const roots: string[] = [];
const pollers: WorkerUsagePoller[] = [];
afterEach(() => {
  for (const poller of pollers.splice(0)) poller.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-usage-poller-")));
  roots.push(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  const identity = { pid: process.pid, owner: "usage-poller-test" };
  writeFileSync(path.join(root, ".arcadia", "worker.pid"), JSON.stringify({ ...identity, at: Date.now() }));
  return { root, identity, logfile: path.join(root, ".arcadia", "worker.log") };
}
const beatAt = (root: string) => (JSON.parse(readFileSync(path.join(root, ".arcadia", "worker-claude-usage-heartbeat.json"), "utf8")) as { at: number }).at;
/** Block this thread's event loop the way a synchronous tick step does. */
const blockSynchronously = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

describe("worker usage poller (Issue #3122)", () => {
  it("keeps the usage heartbeat under 4 s old while a synchronous tick body blocks the main event loop", async () => {
    const { root, identity, logfile } = workspace();
    const poller = startWorkerUsagePoller(root, identity, logfile, { intervalMs: 250, binding: null, env: { ...process.env, CODEX_SANDBOX: "" } });
    pollers.push(poller);
    // The thread loads this module under tsx; wait for its first beat.
    await vi.waitFor(() => expect(() => beatAt(root)).not.toThrow(), { timeout: 60_000, interval: 100 });

    let ageAtEndOfBlock: number | undefined;
    const tick = createWorkerTick({
      workspacePath: root, pid: process.pid, logfile, identity, schedule: () => {},
      envelope: run => poller.envelope(run),
      loopProgress: () => poller.markLoopProgress(),
      openDb: () => {
        blockSynchronously(6_000);
        ageAtEndOfBlock = Date.now() - beatAt(root);
        throw new Error("fixture database unavailable");
      }
    });
    tick();
    await vi.waitFor(() => expect(ageAtEndOfBlock).toBeTypeOf("number"), { timeout: 20_000 });
    expect(ageAtEndOfBlock).toBeLessThan(4_000);
  }, 90_000);

  it("stops the beat when the main event loop stamps no progress, so a wedged tick still refuses START before any claim", async () => {
    const { root, identity, logfile } = workspace();
    const poller = startWorkerUsagePoller(root, identity, logfile, { intervalMs: 250, binding: null, mainLoopStaleMs: 1_000, env: { ...process.env, CODEX_SANDBOX: "" } });
    pollers.push(poller);
    await vi.waitFor(() => expect(() => beatAt(root)).not.toThrow(), { timeout: 60_000, interval: 100 });
    poller.markLoopProgress();
    // No loopProgress hook: this tick body is wedged as far as the poller can tell.
    let ageAtEndOfBlock: number | undefined;
    const tick = createWorkerTick({
      workspacePath: root, pid: process.pid, logfile, identity, schedule: () => {},
      envelope: run => poller.envelope(run),
      openDb: () => {
        blockSynchronously(5_000);
        ageAtEndOfBlock = Date.now() - beatAt(root);
        throw new Error("fixture database unavailable");
      }
    });
    tick();
    await vi.waitFor(() => expect(ageAtEndOfBlock).toBeTypeOf("number"), { timeout: 20_000 });
    expect(ageAtEndOfBlock).toBeGreaterThan(3_000);
  }, 90_000);

  it("never overlaps itself: the next poll is scheduled only after the previous one settles", async () => {
    let open!: () => void;
    let active = 0;
    let maxActive = 0;
    const poll = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>(resolve => { open = resolve; });
      active -= 1;
    });
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const loop = runUsagePollLoop({ poll, logfile: path.join(workspace().root, "loop.log"), intervalMs: 2_000, schedule: (callback, delayMs) => { scheduled.push({ callback, delayMs }); } });
    // While one poll is still awaiting, however long, nothing is scheduled.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(poll).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(0);
    open();
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));
    expect(scheduled[0].delayMs).toBe(2_000);
    scheduled[0].callback();
    expect(poll).toHaveBeenCalledTimes(2);
    loop.stop();
    open();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(scheduled).toHaveLength(1);
    expect(maxActive).toBe(1);
  });
});
