import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Whether any process is running with its current directory inside a
 * worktree -- the one host-observable sign that a manual handoff's terminal or
 * agent is still working there, which no database row can record (Issue #884).
 *
 * Unlike `liveProcessCwds` (which `tidy` reads fail-open), this answers
 * fail-closed: a probe that cannot run, errors, or returns unparseable output
 * reports `ok: false`, and the only caller treats that as "cannot tell" and
 * refuses to hand the worktree out.
 *
 * Residual risk, accepted and bounded by the one-shot handout marker: the
 * probe cannot see a session whose current directory is outside the worktree
 * (one editing it by absolute path), nor another user's process it may not
 * inspect.
 */
export type WorktreeLiveness =
  | { ok: true; processes: Array<{ pid: number; command: string | null; cwd: string }> }
  | { ok: false; error: string };

export type WorktreeLivenessProbe = (worktreeRealpath: string) => WorktreeLiveness;

let probeOverride: WorktreeLivenessProbe | null = null;

/** Test-only: replace the host probe; pass null to restore it. */
export function setWorktreeLivenessProbeForTests(probe: WorktreeLivenessProbe | null): void {
  probeOverride = probe;
}

export function probeWorktreeLiveness(worktreePath: string): WorktreeLiveness {
  let root: string;
  try {
    root = realpathSync(worktreePath);
  } catch (error) {
    return { ok: false, error: `The worktree path could not be resolved: ${(error as Error).message}` };
  }
  try {
    return (probeOverride ?? hostProbe)(root);
  } catch (error) {
    return { ok: false, error: `The liveness probe failed: ${(error as Error).message}` };
  }
}

function hostProbe(root: string): WorktreeLiveness {
  return existsSync("/proc/self/cwd") ? procProbe(root) : lsofProbe(root);
}

function inside(cwd: string, root: string): boolean {
  let resolved = cwd;
  try {
    resolved = realpathSync(cwd);
  } catch {
    // A deleted or unreadable directory keeps its reported path.
  }
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/** Linux: every readable `/proc/<pid>/cwd`; a process that exits or is not ours to read is skipped. */
function procProbe(root: string): WorktreeLiveness {
  let entries: string[];
  try {
    entries = readdirSync("/proc").filter((entry) => /^\d+$/.test(entry));
  } catch (error) {
    return { ok: false, error: `/proc could not be listed: ${(error as Error).message}` };
  }
  const processes: Array<{ pid: number; command: string | null; cwd: string }> = [];
  for (const entry of entries) {
    const pid = Number(entry);
    if (pid === process.pid) continue;
    let cwd: string;
    try {
      cwd = readlinkSync(`/proc/${entry}/cwd`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "ENOENT" || code === "ESRCH" || code === "EPERM") continue;
      return { ok: false, error: `/proc/${entry}/cwd could not be read: ${(error as Error).message}` };
    }
    if (!inside(cwd, root)) continue;
    processes.push({ pid, command: procCommand(entry), cwd });
  }
  return { ok: true, processes };
}

function procCommand(pid: string): string | null {
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** macOS and other hosts without /proc: `lsof` field output of every process's cwd. Exported for tests. */
export function lsofProbe(root: string): WorktreeLiveness {
  // lsof escapes non-printable and non-ASCII bytes in names (`\xc3\xa9`), so
  // such a path could never match and would silently read as "nothing here".
  if (/[^\x20-\x7e]/.test(root)) {
    return { ok: false, error: "lsof cannot be matched against a worktree path containing non-ASCII or non-printable characters." };
  }
  const result = spawnSync("lsof", ["-a", "-d", "cwd", "-F", "pcn"], { encoding: "utf8", timeout: 5000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) return { ok: false, error: `lsof could not run: ${result.error.message}` };
  // Status 1 is lsof's ordinary "some processes could not be inspected".
  if (result.status !== 0 && result.status !== 1) return { ok: false, error: `lsof exited with status ${String(result.status)}.` };
  const processes: Array<{ pid: number; command: string | null; cwd: string }> = [];
  let pid: number | null = null;
  let command: string | null = null;
  let sawProcess = false;
  for (const line of (result.stdout ?? "").split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
      command = null;
      sawProcess = Number.isInteger(pid) && pid > 0;
      if (!sawProcess) return { ok: false, error: "lsof output was not parseable." };
    } else if (line.startsWith("c")) {
      command = line.slice(1) || null;
    } else if (line.startsWith("n") && pid !== null && pid !== process.pid) {
      const cwd = line.slice(1);
      if (cwd && inside(cwd, root)) processes.push({ pid, command, cwd });
    }
  }
  if (!sawProcess) return { ok: false, error: "lsof reported no processes at all." };
  return { ok: true, processes };
}
