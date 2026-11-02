import { fork, type ChildProcess } from "node:child_process";
import type { WorkerIdentity } from "./worker.js";

export interface HeartbeatBeaconExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export interface HeartbeatBeacon {
  stop(): void;
  /** Fires at most once, only if the beacon exits or errors *without* a prior
   * `stop()` call — the caller's cue to log the loss and restart it, since a
   * dead beacon silently reopens the false-positive-kill window this exists
   * to close. Never fires after `stop()`. */
  onUnexpectedExit(callback: (detail: HeartbeatBeaconExit) => void): void;
}

/** How often the beacon re-stamps the worker's own liveness record. */
const BEACON_INTERVAL_MS = 5_000;

/**
 * Starts the out-of-process heartbeat beacon (see `workerHeartbeatBeacon.ts`)
 * as a real child process, so it keeps refreshing the worker's own liveness
 * record even while this process is blocked inside a long synchronous tick
 * step. Overridable so a deterministic test can supply a fake beacon instead
 * of spawning a real OS process.
 *
 * Follows the same fork pattern as `goRequestExecutor.ts`: the `.ts`/`.js`
 * extension is resolved from this module's own URL so the forked process
 * loads the matching sibling file under source (`tsx`) or the compiled dist.
 *
 * `intervalMs` and `parentPid` default to production values and exist only so
 * a deterministic test can prove the beacon's own behavior (refresh cadence,
 * self-termination when its watched parent dies) in milliseconds rather than
 * the real freshness window.
 */
export function startHeartbeatBeacon(
  workspacePath: string,
  identity: WorkerIdentity,
  options: { intervalMs?: number; parentPid?: number } = {}
): HeartbeatBeacon {
  const intervalMs = options.intervalMs ?? BEACON_INTERVAL_MS;
  const parentPid = options.parentPid ?? process.pid;
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const child: ChildProcess = fork(
    new URL(`./workerHeartbeatBeacon.${extension}`, import.meta.url),
    [workspacePath, JSON.stringify(identity), String(parentPid), String(intervalMs)],
    {
      execArgv: extension === "ts" ? ["--import", import.meta.resolve("tsx")] : [],
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    }
  );
  child.unref();

  let stopped = false;
  let listener: ((detail: HeartbeatBeaconExit) => void) | null = null;
  const notifyUnexpectedExit = (detail: HeartbeatBeaconExit) => {
    if (stopped) return;
    stopped = true;
    listener?.(detail);
  };
  child.on("error", (error) => notifyUnexpectedExit({ code: null, signal: null, error }));
  child.on("exit", (code, signal) => notifyUnexpectedExit({ code, signal }));

  return {
    stop: () => {
      stopped = true;
      try { child.kill(); } catch {}
    },
    onUnexpectedExit: (callback) => { listener = callback; }
  };
}
