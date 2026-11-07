import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";

/**
 * The relay's single-writer lock (design section c, step 1): an exclusive
 * create of `<role>/relay.lock` holding the pid and that process's start time.
 * A stale lock is broken only when no live process has that pid with that
 * start time, so a reused pid cannot keep holding it. Every writer of a
 * role's handoff state (a tick, `renew`, `hold`, `note`, `subscribe`,
 * `accept`, the claim) goes through it, so they cannot collide.
 */
export interface RelayLockDeps {
  pid?: number;
  /** The process start time for a pid, or null when no such process is live. */
  processStartTime?: (pid: number) => string | null;
  /** How long to wait for a live holder before refusing (default 5 s). */
  waitMs?: number;
}

export interface RelayLockHandle {
  file: string;
  pid: number;
  startTime: string;
}

interface LockRecord { pid: number; startTime: string; acquiredAt: string }

/**
 * Returned when the process exists but its start time cannot be read (`ps`
 * missing or failing under load). The holder is then treated as live, never
 * as stale: failing to observe a process must not break its lock.
 */
export const ALIVE_START_UNKNOWN = "alive:start-time-unreadable";

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function systemProcessStartTime(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
    if (out !== "") return out;
  } catch {
    // Fall through: a failed `ps` is not proof the process is gone.
  }
  return processExists(pid) ? ALIVE_START_UNKNOWN : null;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readRecord(file: string): LockRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LockRecord>;
    return typeof parsed.pid === "number" && typeof parsed.startTime === "string" ? parsed as LockRecord : null;
  } catch {
    return null;
  }
}

function sameRecord(left: LockRecord | null, right: LockRecord | null): boolean {
  if (left === null || right === null) return left === right;
  return left.pid === right.pid && left.startTime === right.startTime && left.acquiredAt === right.acquiredAt;
}

/**
 * Breaks a stale lock without ever deleting a fresh one: the file is first
 * renamed aside atomically, then compared with the stale record observed. If
 * another breaker re-acquired in between, the renamed file is that holder's
 * live lock, so it is linked back (which fails rather than overwrites if a
 * third writer already holds the path).
 */
function breakStaleLock(file: string, stale: LockRecord | null): void {
  const aside = `${file}.breaking-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    renameSync(file, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!sameRecord(readRecord(aside), stale)) {
    try { linkSync(aside, file); } catch { /* a third writer holds it; theirs stands */ }
  }
  try { unlinkSync(aside); } catch { /* already gone */ }
}

export function acquireRelayLock(directory: string, deps: RelayLockDeps = {}): RelayLockHandle {
  const startTimeOf = deps.processStartTime ?? systemProcessStartTime;
  const pid = deps.pid ?? process.pid;
  const startTime = startTimeOf(pid) ?? "unknown";
  const file = path.join(directory, "relay.lock");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + (deps.waitMs ?? 5_000);
  for (;;) {
    try {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeSync(fd, `${JSON.stringify({ pid, startTime, acquiredAt: new Date().toISOString() })}\n`);
      } finally {
        closeSync(fd);
      }
      return { file, pid, startTime };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = readRecord(file);
    // A half-written lock (no parseable record) is treated as held until the
    // wait runs out, then as stale: its writer died between create and write.
    const observed = holder === null ? null : startTimeOf(holder.pid);
    const live = holder !== null && observed !== null && (
      observed === ALIVE_START_UNKNOWN || holder.startTime === "unknown" || holder.startTime === ALIVE_START_UNKNOWN || observed === holder.startTime
    );
    if (!live && (holder !== null || Date.now() >= deadline)) {
      breakStaleLock(file, holder);
      continue;
    }
    if (Date.now() >= deadline) {
      throw validationError(`The coordinator relay lock ${file} is held by live process ${holder?.pid ?? "unknown"}; nothing was written. Retry after it finishes.`, { reason: "relay_lock_held" });
    }
    sleepSync(50);
  }
}

/** Removes the lock only when it is still this holder's own record. */
export function releaseRelayLock(handle: RelayLockHandle): void {
  const holder = readRecord(handle.file);
  if (holder && holder.pid === handle.pid && holder.startTime === handle.startTime) {
    try { unlinkSync(handle.file); } catch { /* already gone */ }
  }
}

export function withRelayLock<T>(directory: string, callback: () => T, deps: RelayLockDeps = {}): T {
  const handle = acquireRelayLock(directory, deps);
  try {
    return callback();
  } finally {
    releaseRelayLock(handle);
  }
}
