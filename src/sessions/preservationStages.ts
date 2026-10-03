import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync, spawnSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { ArcadiaError, normalizeError, preservationGitTimeout } from "../cli/errors.js";

export type PreservationProgress = (stage: string, details?: Record<string, unknown>) => void;
/** A per-call bound, or (for deterministic tests) a bound chosen per call. */
export type PreservationCallTimeout = number | ((call: { command: string; args: readonly string[]; stage: string }) => number);
interface PreservationProgressState {
  report: PreservationProgress; stage: string; details?: Record<string, unknown>; lastReportAt: number; gitTimeoutMs: PreservationCallTimeout;
}
const progress = new AsyncLocalStorage<PreservationProgressState>();

/** The host's idle watchdog kills an attempt whose last stage event is older than this. */
export const PRESERVATION_STAGE_TIMEOUT_MS = 150_000;
/** Default per-call bound for every bounded preservation subprocess. */
export const PRESERVATION_GIT_TIMEOUT_MS = 90_000;
const PRESERVATION_HEARTBEAT_INTERVAL_MS = 5_000;
/** Bound on the index-lock liveness probe; far inside the stage watchdog. */
const LIVENESS_PROBE_TIMEOUT_MS = 10_000;
/** Largest per-call bound. Every bounded call heartbeats as it starts (throttled
 * to the interval above), so the longest idle gap the watchdog can see is one
 * interval plus one call. This 30s margin keeps that below the stage limit, so
 * a hung call always reports its own typed timeout before the watchdog fires. */
export const PRESERVATION_GIT_TIMEOUT_MAX_MS = PRESERVATION_STAGE_TIMEOUT_MS - 30_000;

/** `ARCADIA_PRESERVATION_GIT_TIMEOUT_MS` overrides the per-call bound with a
 * positive integer number of milliseconds, capped at
 * {@link PRESERVATION_GIT_TIMEOUT_MAX_MS}; any other value is ignored. */
export function preservationGitTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.ARCADIA_PRESERVATION_GIT_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, PRESERVATION_GIT_TIMEOUT_MAX_MS) : PRESERVATION_GIT_TIMEOUT_MS;
}

export function withPreservationProgress<T>(report: PreservationProgress, run: () => T, options: { gitTimeoutMs?: PreservationCallTimeout } = {}): T {
  return progress.run({
    report, stage: "host.start", lastReportAt: Date.now(), gitTimeoutMs: options.gitTimeoutMs ?? preservationGitTimeoutMs()
  }, run);
}

function callTimeoutMs(current: PreservationProgressState, command: string, args: readonly string[]): number {
  const bound = typeof current.gitTimeoutMs === "function"
    ? current.gitTimeoutMs({ command, args, stage: current.stage }) : current.gitTimeoutMs;
  return Math.min(bound, PRESERVATION_GIT_TIMEOUT_MAX_MS);
}

export function preservationStage(stage: string, details?: Record<string, unknown>): void {
  const current = progress.getStore();
  if (!current) return;
  current.stage = stage;
  current.details = details;
  current.lastReportAt = Date.now();
  current.report(stage, details);
}

/** Re-report the current stage, throttled. Observational only: a failed report
 * never replaces the error or result of the work it accompanies. */
export function preservationHeartbeat(): void {
  const current = progress.getStore();
  if (!current || Date.now() - current.lastReportAt < PRESERVATION_HEARTBEAT_INTERVAL_MS) return;
  current.lastReportAt = Date.now();
  try { current.report(current.stage, { ...current.details, heartbeat: true }); } catch { /* observational only */ }
}

/** Keep the failure's own stage when a finally block reports cleanup later. */
export function preservationStageFailure(error: unknown) {
  const failure = normalizeError(error);
  failure.details.stage ??= progress.getStore()?.stage;
  return failure;
}

/** Native process bounds also apply while the host's JS thread is blocked.
 * Every bounded call spreads these as it starts, which also restarts the stage
 * idle clock, so a run of slow-but-successful calls never trips the watchdog. */
export function preservationProcessLimits(command: string, args: readonly string[]): { timeout?: number; killSignal?: "SIGKILL" } {
  const current = progress.getStore();
  if (!current) return {};
  preservationHeartbeat();
  return { timeout: callTimeoutMs(current, command, args), killSignal: "SIGKILL" };
}

/** `execFileSync` under the preservation bounds, with a timeout typed as the
 * retryable failure. `displayArgs` replaces arguments too large to report;
 * `remedy` replaces the default retry remedy for a call that is not safe to
 * retry blindly. */
export function boundedExec(command: string, args: string[], options: ExecFileSyncOptions,
  report: { displayArgs?: string[]; remedy?: string } = {}): Buffer | string {
  const displayArgs = report.displayArgs ?? args;
  try {
    return execFileSync(command, args, { ...preservationProcessLimits(command, displayArgs), ...options });
  } catch (error) {
    throw preservationTimeout(error, command, displayArgs, options.cwd?.toString(), report.remedy) ?? error;
  }
}

function gitSubcommand(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-c" || args[index] === "-C") index += 1;
    else if (!args[index].startsWith("-")) return args[index];
  }
  return null;
}

/** Stages that run only once the preservation commit is durable on the branch. */
const POST_COMMIT_STAGES = new Set(["preserve.index-sync", "preserve.receipt", "preserve.push", "preserve.pull-request"]);

function retryRemedy(stage: string | null): string {
  const outcome = stage && POST_COMMIT_STAGES.has(stage)
    ? "The preservation commit is already durable on the branch, but the candidate index may still name the pre-commit tree until a retry finishes. The retry reuses the same request id, recovers that commit by its trailer without creating another, and points the index at the preserved tree."
    : stage === "preserve.commit"
      ? "The candidate's index, status and locks are unchanged; the branch ref may or may not have advanced. The retry reuses the same request id and recovers any commit already made by its trailer without creating another."
      : "Nothing was committed and the candidate's index, status and locks are unchanged. The retry reuses the same request id.";
  return `Retry the same fixed protected launcher unchanged. ${outcome} Timeouts do not consume the identical-refusal budget; ` +
    `a separate identical-timeout limit stops automatic retries. Set ARCADIA_PRESERVATION_GIT_TIMEOUT_MS (at most ${PRESERVATION_GIT_TIMEOUT_MAX_MS}) on the host only if Git is persistently slower than the bound.`;
}

/**
 * The typed, retryable failure for a native subprocess timeout (`ETIMEDOUT`
 * from `execFileSync`'s thrown error or `spawnSync`'s `result.error`), or null
 * for anything else so callers keep their own handling of genuine failures. A
 * timeout must never be read as a negative answer ("not an ancestor", "no
 * preservation commit") or as a refusal of the candidate.
 */
export function preservationTimeout(error: unknown, command: string, args: readonly string[], cwd: string | undefined, remedy?: string): ArcadiaError | null {
  if ((error as { code?: unknown } | null | undefined)?.code !== "ETIMEDOUT") return null;
  const current = progress.getStore();
  const subcommand = command === "git" ? gitSubcommand(args) : null;
  const stage = current?.stage ?? null;
  const timeoutMs = current ? callTimeoutMs(current, command, args) : null;
  return preservationGitTimeout(
    `${subcommand ? `git ${subcommand}` : command} exceeded its ${timeoutMs ?? "configured"} ms preservation budget at stage ${stage ?? "unknown"}; retry the same protected launcher.`,
    { reason: "timeout", command, gitSubcommand: subcommand, args: [...args], cwd: cwd ?? null, timeoutMs, stage, remedy: remedy ?? retryRemedy(stage) }
  );
}

/** Remedy for a blocked post-commit index sync: the commit is durable, and the
 * timeout bound is irrelevant, so it never suggests tuning it. */
function indexLockRemedy(stage: string | null, malformed: boolean): string {
  const durable = stage && POST_COMMIT_STAGES.has(stage)
    ? "The preservation commit is already durable on the branch; only the candidate index still names the pre-commit tree. "
    : "";
  return malformed
    ? `${durable}Arcadia never removes a lock that is not a regular file. Inspect the path, remove it yourself once no Git process is using the candidate, then retry the same fixed protected launcher unchanged; it reuses the same request id and recovers that commit by its trailer.`
    : `${durable}The lock may belong to a running Git process, so it is never removed while one runs in the candidate or while it is fresh. Let that process finish, then retry the same fixed protected launcher unchanged; it reuses the same request id and recovers that commit by its trailer. ` +
      "A long-lived `git fsmonitor--daemon` running in the candidate never finishes on its own: stop it with `git -C <candidate> fsmonitor--daemon stop`, then retry. " +
      "Index-lock refusals have their own identical-attempt limit, separate from timeouts.";
}

/** Whether a Git process may still own an old lock in this worktree. */
export type IndexLockLiveness =
  | { liveness: "fresh" }
  | { liveness: "live"; liveGitPids: number[] }
  | { liveness: "unknown"; livenessError: string };

/** An `index.lock` blocks the post-commit index sync and may belong to a
 * running Git process (it is fresh, a Git process runs in the candidate, or
 * that could not be ruled out), so it is never removed, and the retry is safe. */
export function preservationIndexLocked(lockPath: string, ageMs: number, liveness: IndexLockLiveness = { liveness: "fresh" }): ArcadiaError {
  const stage = progress.getStore()?.stage ?? null;
  return preservationGitTimeout(
    `The candidate index is locked (${lockPath}); a Git process may still be running. Retry the same protected launcher later.`,
    { reason: "index_locked", lockPath, lockAgeMs: ageMs, ...liveness, stage, remedy: indexLockRemedy(stage, false) }
  );
}

/** A lock path that is not a regular file (a directory, a symlink -- dangling
 * or not -- or another node) is never removed or read through. Typed and
 * bounded by the index-lock budget, with its diagnostics, but not retryable
 * until an operator inspects it. */
export function preservationIndexLockMalformed(lockPath: string, lockKind: string, details: Record<string, unknown> = {}): ArcadiaError {
  const stage = progress.getStore()?.stage ?? null;
  return new ArcadiaError(
    "PRESERVATION_GIT_TIMEOUT",
    `The candidate index lock path is not a regular file (${lockKind}: ${lockPath}); preservation will not remove or follow it.`,
    1,
    { ...details, reason: "index_lock_malformed", lockPath, lockKind, stage, retryable: false, remedy: indexLockRemedy(stage, true) }
  );
}

type GitLivenessProbe = { status: "none" } | { status: "live"; pids: number[] } | { status: "unknown"; error: string };

/** The `/proc` reads the Linux scan needs; injectable for tests. */
export interface ProcReader { list(): string[]; comm(pid: string): string; cwd(pid: string): string }
const systemProc: ProcReader = {
  list: () => readdirSync("/proc"),
  comm: (pid) => readFileSync(`/proc/${pid}/comm`, "utf8"),
  cwd: (pid) => readlinkSync(`/proc/${pid}/cwd`)
};
const errnoCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
/** A process that exited between listing and reading is simply gone. */
const EXITED = new Set(["ENOENT", "ESRCH"]);

/** Scan `/proc` for Git processes whose cwd is `within` the worktree. A
 * listing failure, or any unreadable entry other than one that exited
 * (including EACCES/EPERM on a Git process's cwd), is `unknown`. */
export function scanProcForGit(within: (dir: string) => boolean, proc: ProcReader = systemProc): GitLivenessProbe {
  let entries: string[];
  try { entries = proc.list(); } catch (error) { return { status: "unknown", error: `/proc: ${String(error)}` }; }
  const pids: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let dir: string;
    try {
      if (!proc.comm(entry).trim().startsWith("git")) continue;
      dir = proc.cwd(entry);
    } catch (error) {
      if (EXITED.has(errnoCode(error) ?? "")) continue;
      return { status: "unknown", error: `/proc/${entry}: ${String(error)}` };
    }
    if (within(dir)) pids.push(Number(entry));
  }
  return pids.length > 0 ? { status: "live", pids } : { status: "none" };
}

/**
 * Git processes whose working directory is inside `worktree` -- e.g. a
 * `git commit` still waiting on an editor, or a long-lived
 * `git fsmonitor--daemon`, whose lock is old by mtime but live. Linux scans
 * `/proc`; other hosts ask `lsof`. Any failure to look (an unlistable
 * `/proc`, an unreadable Git process, a failed or timed-out `lsof`) is
 * reported as `unknown`, which callers must treat as live: an old lock is
 * removed only on a positive "none".
 */
export function gitProcessesInWorktree(worktree: string): GitLivenessProbe {
  let root: string;
  try { root = realpathSync(worktree); } catch (error) { return { status: "unknown", error: String(error) }; }
  const within = (dir: string) => dir === root || dir.startsWith(root + path.sep);
  preservationHeartbeat();
  if (process.platform === "linux" && existsSync("/proc/self/cwd")) return scanProcForGit(within);
  const result = spawnSync("lsof", ["-a", "-c", "git", "-d", "cwd", "-F", "pn"], {
    encoding: "utf8", timeout: LIVENESS_PROBE_TIMEOUT_MS, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) return { status: "unknown", error: `lsof: ${result.error.message}` };
  // lsof exits 1, silently, when no process matches.
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return { status: "none" };
  if (result.status !== 0) return { status: "unknown", error: `lsof exited ${result.status ?? result.signal}: ${result.stderr.trim().slice(0, 300)}` };
  const pids: number[] = [];
  let pid: number | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== null) {
      let dir = line.slice(1);
      try { dir = realpathSync(dir); } catch { /* keep as reported */ }
      if (within(dir)) pids.push(pid);
    }
  }
  return pids.length > 0 ? { status: "live", pids } : { status: "none" };
}
