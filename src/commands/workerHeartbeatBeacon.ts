import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Runs as its own OS process (forked by `startHeartbeatBeacon`) so the
 * worker's own liveness record keeps advancing while the parent is blocked
 * inside a long synchronous tick step (Issue #617): a `setInterval` on the
 * parent's own event loop cannot fire while that loop is blocked, so
 * recovery could not tell "busy" from "hung" for any single step longer than
 * the freshness window. A genuinely separate process is not blocked by the
 * parent's event loop and can.
 *
 * Deliberately minimal: only `node:fs`/`node:path`, no database or other
 * heavy module load, so this process starts fast and has as little as
 * possible that could itself fail. The pidfile write format is duplicated
 * from `writeWorkerHeartbeat` in `worker.ts` rather than imported from it,
 * for the same reason -- importing that module would pull in its database and
 * execution dependencies into a process whose only job is a tiny fs write.
 *
 * Self-terminates the moment its parent is gone, rather than trusting the
 * parent to kill it on a clean exit: an ungraceful parent death (SIGKILL, a
 * crash) must not leave this beacon keeping a dead worker's heartbeat
 * artificially fresh forever.
 */

interface Identity {
  pid: number;
  owner: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function writeHeartbeat(workspacePath: string, identity: Identity): void {
  const dir = path.join(workspacePath, ".arcadia");
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "worker.pid");
  const temporary = `${target}.${process.pid}.beacon.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...identity, at: Date.now() }), "utf8");
  try {
    renameSync(temporary, target);
  } finally {
    try { unlinkSync(temporary); } catch {}
  }
}

const [workspacePath, identityJson, parentPidRaw, intervalRaw] = process.argv.slice(2);
const identity = JSON.parse(identityJson) as Identity;
const parentPid = Number(parentPidRaw);
const intervalMs = Number(intervalRaw);

try { writeHeartbeat(workspacePath, identity); } catch {}

const timer = setInterval(() => {
  if (!isAlive(parentPid)) {
    clearInterval(timer);
    process.exit(0);
  }
  try { writeHeartbeat(workspacePath, identity); } catch {}
}, intervalMs);
