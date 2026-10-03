import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
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

/**
 * Whether any process holds `file` open -- e.g. a Git process still writing
 * its `index.lock` -- answered fail-closed for the same reason as the worktree
 * probe above: only `none` is a positive "nobody holds it"; a probe that cannot
 * run, errors, times out or returns unparseable output is `unknown`, which the
 * caller must treat as held. An `unknown` from `lsof` carries any stderr
 * warning as `warning`, so the operator can see why it could not tell.
 *
 * Scope: this sees only a process holding the file open right now -- Git's
 * own brief lock write, or a non-Git holder. A `git commit` waiting on an
 * editor has already closed its lock descriptor; only the caller's separate
 * Git-cwd probe protects that lock, never this probe or the lock's age.
 *
 * Residual risk, accepted as in the worktree probe: on Linux another user's
 * process whose descriptors we may not inspect is skipped.
 */
export type FileHolders = { status: "none" } | { status: "held"; pids: number[] } | { status: "unknown"; error: string; warning?: string };
export type FileHolderProbe = (fileRealpath: string) => FileHolders;

/** Bound on the `lsof` file-holder probe; far inside the preservation stage watchdog. */
const FILE_HOLDER_PROBE_TIMEOUT_MS = 10_000;
/** Bound on an `lsof` stderr warning carried into a typed refusal. */
const LSOF_WARNING_LIMIT = 2000;
let fileHolderOverride: FileHolderProbe | null = null;

/** Test-only: replace the host file-holder probe; pass null to restore it. */
export function setFileHolderProbeForTests(probe: FileHolderProbe | null): void {
  fileHolderOverride = probe;
}

export function fileIsHeldOpen(file: string): FileHolders {
  let target: string;
  try {
    target = realpathSync(file);
  } catch (error) {
    return { status: "unknown", error: `The file path could not be resolved: ${(error as Error).message}` };
  }
  try {
    const probe = fileHolderOverride ?? (existsSync("/proc/self/fd") ? (resolved: string) => procFdHolders(resolved) : (resolved: string) => lsofFileHolders(resolved));
    return probe(target);
  } catch (error) {
    return { status: "unknown", error: `The file-holder probe failed: ${(error as Error).message}` };
  }
}

/** A file's identity: the device and inode a descriptor or path resolves to. */
export interface FileIdentity { dev: bigint; ino: bigint }

/** The `/proc` reads the Linux descriptor scan needs; injectable for tests.
 * `stat` follows `/proc/<pid>/fd/<fd>` to the open file itself; `statFile`
 * stats the file being asked about. */
export interface ProcFdReader { list(): string[]; fds(pid: string): string[]; stat(pid: string, fd: string): FileIdentity; statFile(file: string): FileIdentity }
const identity = (file: string): FileIdentity => {
  const stats = statSync(file, { bigint: true });
  return { dev: stats.dev, ino: stats.ino };
};
const systemProcFd: ProcFdReader = {
  list: () => readdirSync("/proc"),
  fds: (pid) => readdirSync(`/proc/${pid}/fd`),
  stat: (pid, fd) => identity(`/proc/${pid}/fd/${fd}`),
  statFile: identity
};
/** A process that exited mid-scan, or one that is not ours to inspect, is skipped. */
const SKIPPED_PROC_ERRORS = new Set(["EACCES", "EPERM", "ENOENT", "ESRCH"]);

/**
 * Linux: every readable `/proc/<pid>/fd/*` whose open file has `target`'s
 * device and inode. Matching by identity, not by the link's path string,
 * keeps a holder visible through a bind mount or another mount namespace,
 * where its link names a different path for the same file. Exported for tests.
 */
export function procFdHolders(target: string, proc: ProcFdReader = systemProcFd): FileHolders {
  let wanted: FileIdentity;
  try {
    wanted = proc.statFile(target);
  } catch (error) {
    return { status: "unknown", error: `${target} could not be stat'ed: ${(error as Error).message}` };
  }
  let entries: string[];
  try {
    entries = proc.list();
  } catch (error) {
    return { status: "unknown", error: `/proc could not be listed: ${(error as Error).message}` };
  }
  const pids: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let fds: string[];
    try {
      fds = proc.fds(entry);
    } catch (error) {
      if (SKIPPED_PROC_ERRORS.has((error as NodeJS.ErrnoException).code ?? "")) continue;
      return { status: "unknown", error: `/proc/${entry}/fd could not be read: ${(error as Error).message}` };
    }
    for (const fd of fds) {
      let open: FileIdentity;
      try {
        open = proc.stat(entry, fd);
      } catch (error) {
        if (SKIPPED_PROC_ERRORS.has((error as NodeJS.ErrnoException).code ?? "")) continue;
        return { status: "unknown", error: `/proc/${entry}/fd/${fd} could not be stat'ed: ${(error as Error).message}` };
      }
      if (open.dev === wanted.dev && open.ino === wanted.ino) { pids.push(Number(entry)); break; }
    }
  }
  return pids.length > 0 ? { status: "held", pids } : { status: "none" };
}

/** macOS and other hosts without /proc: `lsof -F p -- <file>`. `run` is injectable for tests. */
export function lsofFileHolders(
  target: string,
  run: (args: string[]) => { error?: Error; status: number | null; stdout: string; stderr: string } = (args) =>
    spawnSync("lsof", args, { encoding: "utf8", timeout: FILE_HOLDER_PROBE_TIMEOUT_MS, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"] })
): FileHolders {
  // lsof escapes non-printable and non-ASCII bytes in names, so such a path
  // cannot be trusted to match.
  if (/[^\x20-\x7e]/.test(target)) {
    return { status: "unknown", error: "lsof cannot be trusted for a file path containing non-ASCII or non-printable characters." };
  }
  const result = run(["-F", "p", "--", target]);
  const stderr = (result.stderr ?? "").trim();
  // Any stderr (an lsof "WARNING: can't stat()" on macOS) still means "cannot
  // tell"; it rides along so the refusal shows why.
  const unknown = (error: string): FileHolders =>
    stderr ? { status: "unknown", error, warning: stderr.slice(0, LSOF_WARNING_LIMIT) } : { status: "unknown", error };
  if (result.error) return unknown(`lsof could not run: ${result.error.message}`);
  const stdout = result.stdout ?? "";
  // lsof exits 1, silently, when no process has the file open.
  if (result.status === 1 && !stdout.trim() && !stderr) return { status: "none" };
  if (result.status !== 0) return unknown(`lsof exited with status ${String(result.status)}: ${stderr.slice(0, 300)}`);
  const pids: number[] = [];
  for (const line of stdout.split("\n")) {
    if (!line || line.startsWith("f")) continue;
    const pid = line.startsWith("p") ? Number(line.slice(1)) : Number.NaN;
    if (!Number.isInteger(pid) || pid <= 0) return unknown("lsof output was not parseable.");
    pids.push(pid);
  }
  return pids.length > 0 ? { status: "held", pids } : unknown("lsof exited 0 without naming a process.");
}
