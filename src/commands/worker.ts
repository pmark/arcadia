import { appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { requireResolvedWorkspace } from "../workspace/resolve.js";
import { validationError } from "../cli/errors.js";
import { miseLeadingPath, miseNodeArgv, resolveMiseExecutable } from "../runtime/mise.js";
import { openDatabase } from "../db/connection.js";
import {
  attachArtifactToExecutionRun,
  attachMissionLogToExecutionRun,
  claimNextPendingRun,
  createMissionLog,
  getCodexInvocation,
  getExecutionPlan,
  getExecutionRun,
  getMilestone,
  getProject,
  getReviewItem,
  getWorkItem,
  listOrphanedRuns,
  updateExecutionRunStatus,
  updateExecutionRunStep,
  updateWorkItem
} from "../db/repositories.js";
import { executeApprovedReview } from "../execution/reviewExecutor.js";
import { executePlan } from "../execution/runner.js";
import { isPlanningApprovalDecision } from "../execution/planningAuthorization.js";
import { loadPhase3Registries, validatePhase3Registries } from "../intent/registries.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";
import { renderRunSummary } from "../markdown/executionArtifacts.js";
import { deployApprovedProjectProposal } from "../projects/stagingDeployment.js";
import { runManagedProductionTick } from "../production/tick.js";
import { createId } from "../utils/id.js";

import { TRANSPORT_FRESHNESS_MS, processPreservationRequests, refreshPreservationHeartbeat, transportHeartbeatDiagnostic, transportPublishedSince } from "../sessions/preservationTransport.js";
import { MANAGED_SESSION_TMUX_PREFIX } from "../sessions/index.js";
import { auditArcadiaLaunchAgents, duplicateWorkerWarning } from "../runtime/launchAgents.js";

const POLL_INTERVAL_MS = 2_000;

/**
 * How long the worker's own heartbeat may go unrefreshed before the process
 * that wrote it is presumed hung rather than merely busy.
 *
 * This is deliberately the identical number the preservation transport uses to
 * refuse (see `TRANSPORT_FRESHNESS_MS`, exported rather than copied): both
 * answer "has the worker stopped refreshing?", and two constants would let
 * `arcadia worker status` report a process healthy while
 * `arcadia-preserve-broker-*` refuses it on the same evidence.
 */
const WORKER_HEARTBEAT_FRESHNESS_MS = TRANSPORT_FRESHNESS_MS;

/**
 * How long a hung worker is given to honour SIGTERM before it is killed, and
 * how long the kernel is given to reap it afterwards. SIGTERM first is not
 * politeness: a worker that is merely slow gets to finish its tick and clean
 * up its own pidfile.
 */
const WORKER_TERMINATE_GRACE_MS = 5_000;
const WORKER_KILL_GRACE_MS = 2_000;
const WORKER_EXIT_POLL_MS = 100;

/**
 * A transient tick failure should be loud; a persistent one must not become an
 * unbounded log. The first failure of a streak logs in full, then one summary
 * line every this many failures (~60s at the 2s interval), and a recovery line
 * when a tick finally succeeds. `worker.log` is never rotated, so without this
 * a permanently unopenable workspace grew it by roughly 43k lines/day.
 */
const REPEATED_FAILURE_LOG_INTERVAL = 30;

export interface WorkerOptions {
  workspace: string;
}

/**
 * The install command normally talks to launchd and waits for the host worker.
 * Keeping those two effects injectable lets the refusal and readiness contract
 * be covered without depending on a live macOS service.
 */
export interface WorkerInstallDependencies extends ProcessAncestryDependencies {
  execFileSync?: typeof execFileSync;
  waitForRoutes?: typeof waitForWorkerRoutes;
  now?: () => number;
}

/**
 * Overridable so a deterministic test can prove the Session-descendant
 * refusal below without a real tmux server: fabricate a process tree and a
 * pane roster instead of shelling out to `ps`/`tmux`.
 */
export interface ProcessAncestryDependencies {
  /** Every process the host can see, as {pid, ppid} pairs. */
  listProcesses?: () => Array<{ pid: number; ppid: number }>;
  /** Every live tmux pane's leader PID and the name of the session that owns
   * it, across the whole tmux server. Empty when tmux is not installed or not
   * running -- which is also the correct answer for the operator's own
   * terminal and for launchd, neither of which runs under tmux at all. */
  listTmuxPanes?: () => Array<{ pid: number; sessionName: string }>;
}

function defaultListProcesses(): Array<{ pid: number; ppid: number }> {
  try {
    const output = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [pid, ppid] = line.split(/\s+/).map(Number);
        return { pid, ppid };
      })
      .filter((entry) => Number.isInteger(entry.pid) && Number.isInteger(entry.ppid));
  } catch {
    return [];
  }
}

function defaultListTmuxPanes(): Array<{ pid: number; sessionName: string }> {
  try {
    const output = execFileSync("tmux", ["list-panes", "-a", "-F", "#{pane_pid} #{session_name}"], { encoding: "utf8" });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const spaceIndex = line.indexOf(" ");
        return { pid: Number(line.slice(0, spaceIndex)), sessionName: line.slice(spaceIndex + 1) };
      })
      .filter((entry) => Number.isInteger(entry.pid));
  } catch {
    // No tmux server, or tmux is not installed on this host: definitely not
    // inside a managed Session, since every managed Session launches through
    // `tmux new-session` (see `launchPreparedSession`).
    return [];
  }
}

/**
 * The name of the managed-Session tmux session `pid` is running inside, or
 * null when it is not.
 *
 * This walks the host's real process tree instead of trusting an environment
 * variable or the current working directory -- both of which a Session
 * process can clear or change without ever leaving tmux, exactly the forgery
 * this check exists to resist (Issue #611). A managed Session always launches
 * through `tmux new-session`, so its pane leader PID is a genuine ancestor of
 * every process the Session ever spawns, no matter what that process does to
 * its own environment or directory.
 */
export function findEnclosingManagedSessionTmuxName(
  pid: number = process.pid,
  dependencies: ProcessAncestryDependencies = {}
): string | null {
  const panes = (dependencies.listTmuxPanes ?? defaultListTmuxPanes)();
  const managedPanePids = new Map(
    panes
      .filter((pane) => pane.sessionName.startsWith(MANAGED_SESSION_TMUX_PREFIX))
      .map((pane) => [pane.pid, pane.sessionName] as const)
  );
  if (managedPanePids.size === 0) return null;

  const ppidByPid = new Map((dependencies.listProcesses ?? defaultListProcesses)().map((entry) => [entry.pid, entry.ppid]));
  let current = pid;
  for (let hops = 0; hops < 200; hops += 1) {
    const matched = managedPanePids.get(current);
    if (matched) return matched;
    const parent = ppidByPid.get(current);
    if (parent === undefined || parent === current || parent <= 1) return null;
    current = parent;
  }
  return null;
}

/**
 * Refuse a worker lifecycle mutation when the calling process descends from a
 * managed coding-agent Session, so a dispatched Session can never stop,
 * start, or reinstall the shared host worker it is itself running under. The
 * operator's own terminal and the launchd agent are never a tmux descendant
 * of an Arcadia-managed Session, so this is a no-op for both.
 */
function refuseIfManagedSession(operation: string, dependencies: ProcessAncestryDependencies): void {
  const sessionName = findEnclosingManagedSessionTmuxName(process.pid, dependencies);
  if (sessionName === null) return;
  throw validationError(
    `Refusing to ${operation} the shared host worker: this process is running inside managed coding-agent Session tmux session "${sessionName}".`,
    {
      tmuxSessionName: sessionName,
      remedy: "Run this from the operator's own terminal, or let launchd manage the worker. A dispatched Session must not control the lifecycle of the worker it runs under."
    }
  );
}

function arcadiaDir(workspacePath: string): string {
  return path.join(workspacePath, ".arcadia");
}

function pidfilePath(workspacePath: string): string {
  return path.join(arcadiaDir(workspacePath), "worker.pid");
}

function logPath(workspacePath: string): string {
  return path.join(arcadiaDir(workspacePath), "worker.log");
}

interface WorkerIdentity {
  pid: number;
  owner: string;
}

interface WorkerRecord extends WorkerIdentity {
  at: number;
}

function readWorkerRecord(workspacePath: string): WorkerRecord | null {
  try {
    const raw = readFileSync(pidfilePath(workspacePath), "utf8").trim();
    const value = JSON.parse(raw) as { pid?: unknown; owner?: unknown; at?: unknown };
    return typeof value.pid === "number" && value.pid > 0 &&
      typeof value.owner === "string" && value.owner.length > 0 &&
      typeof value.at === "number"
      ? { pid: value.pid, owner: value.owner, at: value.at }
      : null;
  } catch {
    return null;
  }
}

function readWorkerIdentity(workspacePath: string): WorkerIdentity | null {
  const record = readWorkerRecord(workspacePath);
  return record ? { pid: record.pid, owner: record.owner } : null;
}

function writeWorkerHeartbeat(workspacePath: string, identity: WorkerIdentity, at = Date.now()): void {
  // Identity and freshness must be one record. Writing separate pid and
  // heartbeat files let a concurrent start observe a new owner with an old
  // heartbeat and replace a live worker. A sibling rename gives readers either
  // the complete previous record or the complete new record, never a mixture.
  const target = pidfilePath(workspacePath);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...identity, at }), "utf8");
  try { renameSync(temporary, target); } finally { try { unlinkSync(temporary); } catch {} }
}

/**
 * True only when the record is old enough to *prove* its owner stopped
 * refreshing it.
 *
 * The test is "definitely older than the window", not "not fresh", because
 * `arcadia worker start` acts on it destructively. A record stamped in the
 * future is a clock skew, not evidence of a hang, and terminating a healthy
 * worker over one would be worse than waiting for the clock to catch up.
 */
function isStaleWorkerHeartbeat(record: WorkerRecord | null, now = Date.now()): boolean {
  return record !== null && now - record.at >= WORKER_HEARTBEAT_FRESHNESS_MS;
}

/**
 * What the workspace pidfile means right now.
 *
 * `running` is a live PID with a heartbeat inside the freshness window;
 * `unhealthy` is a live PID that stopped refreshing it — hung, not absent;
 * `stopped` is no PID at all, or one that is gone. `status` reports this and
 * `start` branches on it, so the two can never disagree about one pidfile.
 */
export type WorkerHealth = "running" | "unhealthy" | "stopped";

export function classifyWorkerHealth(
  record: WorkerRecord | null,
  legacyPid: number | null,
  isAlive: (pid: number) => boolean,
  now = Date.now()
): { health: WorkerHealth; pid: number | null } {
  const pid = record?.pid ?? legacyPid;
  if (pid === null) return { health: "stopped", pid: null };
  if (!isAlive(pid)) return { health: "stopped", pid };
  return { health: record !== null && !isStaleWorkerHeartbeat(record, now) ? "running" : "unhealthy", pid };
}

function ownsWorker(workspacePath: string, identity: WorkerIdentity): boolean {
  const current = readWorkerIdentity(workspacePath);
  return current?.pid === identity.pid && current.owner === identity.owner;
}

function log(logfile: string, message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try { appendFileSync(logfile, line, "utf8"); } catch {}
  process.stdout.write(line);
}

/**
 * Pre-ownership workers wrote only a decimal PID. A live record is not safe to
 * adopt: it has no owner token to fence, so a new process must leave it alone
 * until launchd stops it during an explicit restart.
 */
function readLegacyPid(workspacePath: string): number | null {
  try {
    const raw = readFileSync(pidfilePath(workspacePath), "utf8").trim();
    return /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}

/**
 * A failed signal probe is not evidence that a process is gone. In particular,
 * an unattended coding-agent sandbox can receive EPERM while the host worker
 * is alive. Only ESRCH permits replacing or deleting a recorded owner.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export interface WorkerTickOptions {
  workspacePath: string;
  pid: number;
  logfile: string;
  identity?: WorkerIdentity;
  /** Overridable so a deterministic test can force a database-open failure. */
  openDb?: (workspacePath: string) => ReturnType<typeof openDatabase>;
  /** Overridable so a deterministic test can drive the loop without timers. */
  schedule?: (callback: () => void, delayMs: number) => void;
  /** Prevent a worker replaced after a blocked tick from resuming shared work. */
  ownsWorker?: () => boolean;
  /** Called exactly when a worker loses its workspace ownership fence. */
  onOwnershipLost?: () => void;
}

/**
 * The worker's tick loop.
 *
 * Opening the workspace database is part of the tick, not a precondition for
 * it. It used to run outside the error boundary — `const db = openDatabase(...)`
 * sat before the `try` — so a transient `SQLITE_BUSY` from shared-writer
 * contention escaped the loop as an uncaught exception and killed the worker
 * without writing anything to `worker.log` (GitHub issue #305). Every
 * synchronous step a tick takes now shares one boundary: a throw is logged as
 * `Worker tick error:` and the next tick is always scheduled.
 *
 * The boundary is deliberately synchronous. A rejected promise or a throw
 * inside some other callback is outside it, and the tick path contains neither:
 * every step it calls is synchronous. Should one ever be added, it needs its
 * own boundary rather than an assumption that this one covers it.
 */
export function createWorkerTick(options: WorkerTickOptions): () => void {
  const openDb = options.openDb ?? openDatabase;
  const schedule = options.schedule
    ?? ((callback: () => void, delayMs: number) => { setTimeout(callback, delayMs); });
  const owns = options.ownsWorker ?? (() => true);
  const onOwnershipLost = options.onOwnershipLost ?? (() => {});

  // Consecutive synchronous failures, so a persistent one is summarized rather
  // than written once per 2s tick.
  let consecutiveFailures = 0;
  const identity = options.identity ?? { pid: options.pid, owner: "test" };

  const tick = () => {
    if (!owns()) {
      onOwnershipLost();
      return;
    }
    try {
      try { writeWorkerHeartbeat(options.workspacePath, identity); } catch {}
      const db = openDb(options.workspacePath);
      try {
        runWorkerIteration(db, options.workspacePath, options.pid, options.logfile, () => {
          // The iteration is synchronous and can block the event loop for
          // minutes, so the 5s timer above cannot fire while it runs. Without
          // this the worker's own record would age past the freshness window
          // during a perfectly healthy tick, and `start` would replace a worker
          // that is merely busy.
          try { writeWorkerHeartbeat(options.workspacePath, identity); } catch {}
        });
      } finally {
        db.close();
      }
      if (consecutiveFailures > 0) {
        log(options.logfile, `Worker tick recovered after ${consecutiveFailures} consecutive failure${consecutiveFailures === 1 ? "" : "s"}.`);
        consecutiveFailures = 0;
      }
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures === 1 || consecutiveFailures % REPEATED_FAILURE_LOG_INTERVAL === 0) {
        const message = error instanceof Error ? error.message : String(error);
        const suffix = consecutiveFailures === 1 ? "" : ` (repeated ${consecutiveFailures} times)`;
        log(options.logfile, `Worker tick error: ${message}${suffix}`);
      }
    } finally {
      if (owns()) schedule(tick, POLL_INTERVAL_MS);
      else onOwnershipLost();
    }
  };

  return tick;
}

export interface WorkerStartDecision {
  action: "start" | "already-running" | "recover";
  pid: number | null;
}

/**
 * Whether this process may own the workspace, a live worker already does, or a
 * live worker has stopped refreshing its heartbeat and must be replaced.
 *
 * The already-running path is benign, not a failure: it is exactly what a
 * second launch agent for one workspace hits on every run. Reporting it as an
 * error is what made a `KeepAlive` agent respawn forever and write the refusal
 * into `.arcadia/worker.log` (GitHub issue #303). Keeping the decision separate
 * from the exit code lets a test prove the benign path without spawning one.
 *
 * `recover` is the case that used to be folded into `already-running`: a
 * process that is alive but whose heartbeat is older than the freshness
 * window. It is not busy — a busy worker still refreshes on its 5s timer and
 * between tick steps — it is hung, and nothing else in an unattended system
 * would ever replace it (GitHub issue #485). The caller still has to prove the
 * PID is really ours before signalling it; see `isWorkspaceWorkerCommand`.
 */
export function decideWorkerStart(
  existing: WorkerRecord | null,
  isAlive: (pid: number) => boolean,
  now = Date.now()
): WorkerStartDecision {
  if (!existing || !isAlive(existing.pid)) {
    return { action: "start", pid: null };
  }
  if (isStaleWorkerHeartbeat(existing, now)) {
    return { action: "recover", pid: existing.pid };
  }
  return { action: "already-running", pid: existing.pid };
}

/**
 * The full command line of a live PID, or null when it cannot be read.
 *
 * `ps` is used rather than `/proc` because the worker's host is macOS, and
 * because a failed probe must be distinguishable from a mismatched one: both
 * refuse, but only the second is evidence.
 */
export function processCommandLine(pid: number): string | null {
  try {
    const output = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Whether a live PID is this workspace's own Arcadia worker rather than a
 * stranger the kernel recycled the PID onto.
 *
 * A pidfile can outlive its owner: a worker killed with SIGKILL never runs its
 * cleanup, so its record survives and the OS is free to hand that PID to
 * anything. Signalling on the record's PID alone would then kill an unrelated
 * process. So the invocation must be an Arcadia CLI `worker start`, bound to
 * *this* workspace by one of the only two claims a command line can support:
 *
 * - it names `--workspace`, which must match exactly; or
 * - it names none, making it a default-workspace invocation, and this workspace
 *   must be the one such an invocation resolves to here.
 *
 * The second case is not a loophole. A worker for a *different* workspace never
 * writes this workspace's pidfile, so a record found here can only have been
 * written by a worker that resolved to this workspace — while refusing the case
 * outright (Issue #492) left every worker started without the flag, including
 * the live one on the operator's host, unrecoverable. `defaultWorkspacePath` is
 * null when the host cannot resolve one, which refuses rather than assumes.
 */
export function isWorkspaceWorkerCommand(
  commandLine: string,
  workspacePath: string,
  defaultWorkspacePath: string | null
): boolean {
  const arcadiaCliInvocation = /cli\.(?:ts|js|mjs)\b/.test(commandLine) || /(?:^|\s)arcadia(?:\s|$)/.test(commandLine);
  const arcadiaWorkerStart = arcadiaCliInvocation &&
    /(?:^|\s)worker(?:\s|$)/.test(commandLine) &&
    /(?:^|\s)start(?:\s|$)/.test(commandLine);
  if (!arcadiaWorkerStart) return false;
  const named = namedWorkspace(commandLine);
  if (named !== null) return named === workspacePath;
  return defaultWorkspacePath !== null && workspacePath === defaultWorkspacePath;
}

/**
 * The workspace a workspace-less invocation resolves to here, or null when this
 * host cannot resolve one. Never throws: an unresolvable default is a refusal
 * on the recovery path, not a crash on it.
 */
function resolvedDefaultWorkspacePath(): string | null {
  try {
    return requireResolvedWorkspace({});
  } catch {
    return null;
  }
}

/** The `--workspace` value an invocation names, quoted or not, or null. */
function namedWorkspace(commandLine: string): string | null {
  const match = /--workspace(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(commandLine);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

/**
 * Overridable so a deterministic test can recover a fixture process instead of
 * a real one, and shorten the signal graces. The same shape as
 * `WorkerInstallDependencies`: production always uses the defaults.
 */
export interface WorkerRecoveryDependencies extends ProcessAncestryDependencies {
  identify?: (pid: number) => string | null;
  signal?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (ms: number) => void;
  terminateGraceMs?: number;
  killGraceMs?: number;
  now?: () => number;
  /** The workspace a workspace-less invocation resolves to here; see
   * `isWorkspaceWorkerCommand`. Overridable so a test can exercise the shape
   * the operator's own launch agent uses (Issue #492). */
  defaultWorkspace?: () => string | null;
}

function defaultSleep(ms: number): void {
  // Synchronous on purpose: recovery runs on the cold path of `worker start`,
  // before the tick loop exists, and must not require an event loop turn.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The one place a termination path signals a PID, so every caller treats a
 * vanishing target the same way.
 *
 * The worker can exit between the liveness probe and the signal — the `ps`
 * identity check alone takes a process spawn — and `process.kill` then throws
 * `ESRCH`. For a termination path that is success, not failure: the process is
 * gone, which is what the caller wanted. Every other errno (`EPERM` above all)
 * is real and must surface rather than be mistaken for a completed kill.
 */
function defaultSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/**
 * True for a PID that still exists but is already dead — a zombie its parent
 * has not reaped. `kill(pid, 0)` succeeds for those, so a plain liveness probe
 * cannot tell them from a running process and a caller that waited through
 * SIGKILL would wrongly conclude the worker survived it.
 *
 * This is reachable for real: `waitForProcessExit` sleeps without turning the
 * event loop, so a worker killed as this process's own child is not reaped
 * until the command returns. A launchd-managed worker is reaped by launchd and
 * never needs this, but a wrapper script that supervises `worker start` does.
 * Only `state` starting with `Z` counts, so no live process is ever mistaken
 * for a dead one.
 */
function isZombieProcess(pid: number): boolean {
  try {
    return execFileSync("ps", ["-o", "state=", "-p", String(pid)], { encoding: "utf8" }).trim().startsWith("Z");
  } catch {
    return false;
  }
}

function waitForProcessExit(pid: number, timeoutMs: number, sleep: (ms: number) => void): boolean {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!isProcessAlive(pid)) return true;
    if (Date.now() >= deadline) return isZombieProcess(pid);
    sleep(WORKER_EXIT_POLL_MS);
  }
}

export interface WorkerTermination {
  /** Which signal actually ended the process. */
  signal: "SIGTERM" | "SIGKILL";
  /** How stale the record was when recovery began, in milliseconds. */
  staleMs: number;
}

/**
 * Refuse unless the live PID a stale or held record names is provably this
 * workspace's own Arcadia worker.
 *
 * This runs before *any* signal, SIGTERM included: a pidfile outlives a worker
 * killed with SIGKILL, the kernel may reuse that PID, and signalling on the
 * record's PID alone would then reach a stranger. `terminateStaleWorker` and
 * `runWorkerStopCommand` both call it, so neither can signal an unverified PID.
 */
function assertWorkspaceWorker(
  workspacePath: string,
  record: WorkerRecord,
  dependencies: WorkerRecoveryDependencies
): void {
  const pid = record.pid;
  const commandLine = (dependencies.identify ?? processCommandLine)(pid);
  if (commandLine !== null && isWorkspaceWorkerCommand(commandLine, workspacePath, (dependencies.defaultWorkspace ?? resolvedDefaultWorkspacePath)())) return;
  const pidfile = pidfilePath(workspacePath);
  throw validationError(
    `Refusing to signal PID ${pid}: the pidfile at ${pidfile} names a process whose command line is not this workspace's Arcadia worker${commandLine === null ? " (its command line could not be read)" : ""}.`,
    {
      pid,
      pidfile,
      commandLine,
      remedy: `Confirm by hand whether PID ${pid} is still the Arcadia worker for ${workspacePath}. If it is not, delete ${pidfile} and run arcadia worker start again.`
    }
  );
}

/**
 * The last resort for a worker that ignored SIGTERM, its grace, and SIGKILL.
 *
 * Shared by `start` and `stop` so there is exactly one place that concludes a
 * process cannot be ended, and exactly one remedy printed when it happens.
 */
function forceKillWorker(
  workspacePath: string,
  record: WorkerRecord,
  staleMs: number,
  dependencies: WorkerRecoveryDependencies
): void {
  const pid = record.pid;
  const sleep = dependencies.sleep ?? defaultSleep;
  const signal = dependencies.signal ?? defaultSignal;
  signal(pid, "SIGKILL");
  if (waitForProcessExit(pid, dependencies.killGraceMs ?? WORKER_KILL_GRACE_MS, sleep)) return;
  throw validationError(
    `Worker PID ${pid} survived SIGTERM and SIGKILL after its heartbeat went stale.`,
    {
      pid,
      pidfile: pidfilePath(workspacePath),
      staleMs,
      remedy: `Inspect PID ${pid} directly (a process stuck in an uninterruptible kernel wait cannot be killed). Once it is gone, run arcadia worker start again.`
    }
  );
}

/**
 * End a process that a stale pidfile names, escalating SIGTERM to SIGKILL.
 *
 * Refuses before signalling anything unless the PID is provably this
 * workspace's worker, and refuses again if the process survives SIGKILL, so a
 * caller either gets a terminated process or an actionable error — never a
 * silent no-op of the kind Issue #485 left the operator to clean up by hand.
 */
export function terminateStaleWorker(
  workspacePath: string,
  record: WorkerRecord,
  dependencies: WorkerRecoveryDependencies = {}
): WorkerTermination {
  const pid = record.pid;
  const sleep = dependencies.sleep ?? defaultSleep;
  const signal = dependencies.signal ?? defaultSignal;
  const staleMs = Math.max(0, (dependencies.now ?? Date.now)() - record.at);
  assertWorkspaceWorker(workspacePath, record, dependencies);

  signal(pid, "SIGTERM");
  if (waitForProcessExit(pid, dependencies.terminateGraceMs ?? WORKER_TERMINATE_GRACE_MS, sleep)) {
    return { signal: "SIGTERM", staleMs };
  }

  forceKillWorker(workspacePath, record, staleMs, dependencies);
  return { signal: "SIGKILL", staleMs };
}

/**
 * The record a `start` that just terminated a hung worker must be replaced
 * with, or the pidfile would point at a dead PID (AC: no orphaned pidfile).
 */
function clearRecordForPid(workspacePath: string, pid: number): void {
  if (readWorkerRecord(workspacePath)?.pid === pid) {
    try { unlinkSync(pidfilePath(workspacePath)); } catch {}
  }
}

export function runWorkerStartCommand(options: WorkerOptions, dependencies: WorkerRecoveryDependencies = {}): never {
  refuseIfManagedSession("start", dependencies);
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const dir = arcadiaDir(workspacePath);
  mkdirSync(dir, { recursive: true });
  const logfile = logPath(workspacePath);

  const existing = readWorkerRecord(workspacePath);
  const legacyPid = existing ? null : readLegacyPid(workspacePath);
  if (legacyPid && isProcessAlive(legacyPid)) {
    // Do not replace a process from before ownership records existed. There is
    // no token with which to prove that it is ours or safely fence it; the
    // service restart that stopped it is the migration boundary.
    process.stdout.write(`Legacy worker still running (PID ${legacyPid}); leaving it in place until restart.\n`);
    process.exit(0);
  }
  const decision = decideWorkerStart(
    existing,
    isProcessAlive,
    (dependencies.now ?? Date.now)()
  );
  if (decision.action === "already-running") {
    // Exit 0, not 1: a non-zero status is what launchd reads as a crash. Paired
    // with KeepAlive SuccessfulExit false below, a clean exit leaves the agent
    // stopped instead of respawning it against a supervisor that already won.
    process.stdout.write(`Worker already running (PID ${decision.pid}); leaving it in place.\n`);
    process.exit(0);
  }
  if (decision.action === "recover" && existing) {
    // A hung worker never exits, so launchd's KeepAlive never fires and no
    // respawn would ever reach this line on its own. Replacing it here is what
    // makes the failure self-healing rather than a human's `kill -9`.
    const termination = terminateStaleWorker(workspacePath, existing, dependencies);
    log(
      logfile,
      `Recovered hung worker: PID ${existing.pid} heartbeat was ${Math.round(termination.staleMs / 1000)}s old (limit ${WORKER_HEARTBEAT_FRESHNESS_MS / 1000}s) and ended with ${termination.signal}.`
    );
  }

  const identity = { pid: process.pid, owner: randomUUID() };
  try {
    writeWorkerHeartbeat(workspacePath, identity);
  } catch (error) {
    // The owner was just terminated, so a record that still names its PID would
    // be an orphaned pidfile pointing at a dead process — the next start would
    // read it as a hung worker and try to signal a recycled PID.
    if (existing) clearRecordForPid(workspacePath, existing.pid);
    throw error;
  }
  let ownershipLost = false;
  const stopWhenOwnershipChanges = () => {
    if (ownershipLost) return;
    ownershipLost = true;
    clearInterval(heartbeatTimer);
    log(logfile, "Worker lost its ownership fence; stopping without touching the replacement worker.");
    process.exit(0);
  };
  const heartbeatTimer = setInterval(() => {
    if (!ownsWorker(workspacePath, identity)) {
      stopWhenOwnershipChanges();
      return;
    }
    try { writeWorkerHeartbeat(workspacePath, identity); } catch {}
    // The preservation transport projection is only published on a tick. A tick
    // can block the event loop for minutes, so this loop — and the per-Project
    // re-stamps inside the tick — keep its freshness window from lapsing.
    try { refreshPreservationHeartbeat(workspacePath); } catch {}
  }, 5_000);
  log(logfile, `Worker started (PID: ${process.pid}, workspace: ${workspacePath})`);

  const cleanup = () => {
    log(logfile, "Worker stopping.");
    clearInterval(heartbeatTimer);
    if (ownsWorker(workspacePath, identity)) {
      try { unlinkSync(pidfilePath(workspacePath)); } catch {}
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const tick = createWorkerTick({
    workspacePath,
    pid: process.pid,
    logfile,
    identity,
    ownsWorker: () => ownsWorker(workspacePath, identity),
    onOwnershipLost: stopWhenOwnershipChanges
  });

  setTimeout(tick, 0);
  process.stdin.resume();

  return undefined as never;
}

export function reduceExecutionOutcome(input: {
  exitStatus: number | null;
  validation: Array<{ exitStatus: number | null }>;
}): "completed" | "requires_review" | "failed" {
  if (input.exitStatus !== 0) {
    return "failed";
  }
  if (input.validation.some((validation) => validation.exitStatus !== 0)) {
    return "requires_review";
  }
  return "completed";
}

export function runWorkerIteration(
  db: ReturnType<typeof openDatabase>,
  workspacePath: string,
  pid = process.pid,
  logfile = logPath(workspacePath),
  /**
   * Re-stamp the worker's own heartbeat. A managed-production tick is
   * synchronous and can block the event loop for minutes, so the timer that
   * normally refreshes this record cannot fire while it runs. Optional because
   * callers that drive one iteration by hand have no worker identity to stamp.
   */
  progress?: () => void
): ReturnType<typeof getExecutionRun> {
  if (!process.env.CODEX_SANDBOX) processPreservationRequests(db, workspacePath);
  recoverOrphanedRuns(db, logfile);
  runManagedProductionIteration(db, workspacePath, logfile, progress);
  const run = claimNextPendingRun(db, pid);
  if (!run?.review_item_id) {
    return run;
  }
  const decision = getReviewItem(db, run.review_item_id);
  if (!decision) {
    finalizeWorkerFailure(db, workspacePath, run.id, "Approving Decision is missing.");
    return getExecutionRun(db, run.id);
  }

  log(logfile, `Executing run ${run.id} (Decision: ${decision.slug ?? decision.id}, executor: ${run.executor_name ?? "codex"})`);
  if (isPlanningApprovalDecision(decision)) {
    try {
      const plan = run.plan_id ? getExecutionPlan(db, run.plan_id) : null;
      const invocation = decision.codex_invocation_id ? getCodexInvocation(db, decision.codex_invocation_id) : null;
      if (!plan || !invocation) {
        throw new Error("Planning Run is missing its plan or packet invocation.");
      }
      const planningStep = plan.steps.find((step) => step.executor_type === "codex_planning");
      if (planningStep) {
        updateExecutionRunStep(db, run.id, planningStep.id, { status: "running" });
      }
      const registries = loadPhase3Registries(workspacePath);
      validatePhase3Registries(registries);
      executePlan(db, workspacePath, plan, {
        allowCodexPlanning: true,
        agentProfile: invocation.agent_profile,
        codingAgentProfiles: registries.codingAgents.profiles,
        runId: run.id,
        decisionId: decision.id,
        invocationId: invocation.id
      });
      const finalized = getExecutionRun(db, run.id);
      log(logfile, `Planning Run ${run.id} finished as ${finalized?.status ?? "unknown"}.`);
      return finalized;
    } catch (error) {
      finalizeWorkerFailure(db, workspacePath, run.id, error instanceof Error ? error.message : String(error));
      return getExecutionRun(db, run.id);
    }
  }

  try {
    const result = executeApprovedReview(db, {
      workspace: workspacePath,
      reviewId: run.review_item_id,
      executorName: run.executor_name ?? undefined,
      runId: run.id
    });
    const status = reduceExecutionOutcome(result);
    attachArtifactToExecutionRun(db, run.id, result.artifact.id);
    let stagingUrl: string | null = null;
    if (decision.resolved_intent === "ProjectProposalApproval" && status === "completed") {
      if (!decision.project_id) {
        throw new Error("Approved Project proposal is missing its Project id.");
      }
      const deployment = deployApprovedProjectProposal(db, {
        projectId: decision.project_id,
        workItemId: result.workItemId,
        repoPath: result.repoPath
      });
      stagingUrl = deployment.url;
      attachArtifactToExecutionRun(db, run.id, deployment.artifact.id);
    }
    const summary = [
      `Executed with ${result.executor}.`,
      `${result.changedFiles.length} file(s) changed.`,
      `Validation: ${status === "completed" ? "passed" : status === "requires_review" ? "failed" : "not run"}.`,
      stagingUrl ? `Live staging URL: ${stagingUrl}.` : `Follow-up Decision: ${result.followUpReview.slug ?? result.followUpReview.id}.`
    ].join(" ");
    finalizeGenericRun(db, workspacePath, run.id, status, summary, result.artifact.path ?? result.metadataPath);
    if (stagingUrl && result.workItemId) {
      updateWorkItem(db, result.workItemId, {
        queue: "work_queue",
        workClassification: "agent",
        status: "done",
        nextAction: `Review the live staging site at ${stagingUrl}.`
      });
    }
    log(logfile, `Run ${run.id} ${status} (exit: ${result.exitStatus})`);
  } catch (error) {
    finalizeWorkerFailure(db, workspacePath, run.id, error instanceof Error ? error.message : String(error));
  }
  return getExecutionRun(db, run.id);
}

/**
 * The continuous half of managed production: reconcile dead Sessions, notice
 * independent base-branch advances, and admit/launch the next eligible Action
 * for every active Project, on every tick this worker already runs. Never
 * throws -- an unconfigured provider-adapters registry or an unreadable
 * production policy just means there is nothing to admit this tick, not a
 * reason to stop babysitting the legacy `execution_runs` path below it.
 */
export function runManagedProductionIteration(
  db: ReturnType<typeof openDatabase>,
  workspacePath: string,
  logfile: string,
  progress?: () => void
): void {
  try {
    const registries = loadPhase3Registries(workspacePath);
    if (!registries.providerAdapters) {
      return;
    }
    const result = runManagedProductionTick(db, workspacePath, {
      profiles: registries.codingAgents.profiles,
      adapters: registries.providerAdapters,
      heartbeat: () => {
        // The worker's own record is stamped here for the same reason the
        // preservation projection is: a tick that re-stamped only the
        // projection would leave a healthy worker's heartbeat stale, which is
        // exactly the evidence `status` and `start` read as a hang.
        progress?.();
        refreshPreservationHeartbeat(workspacePath);
      },
      log: (message) => log(logfile, `[managed-production] ${message}`)
    });
    if (!result.policyActive) return;
    for (const project of result.projects) {
      if (project.launch && project.launch.outcome === "repair_budget_exhausted") {
        log(logfile, `[managed-production] ${project.projectSlug}: ${project.launch.reason}`);
      }
    }
  } catch (error) {
    log(logfile, `[managed-production] Tick error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function finalizeGenericRun(
  db: ReturnType<typeof openDatabase>,
  workspace: string,
  runId: string,
  status: "completed" | "requires_review" | "failed",
  summary: string,
  artifactImpact: string
): void {
  const run = getExecutionRun(db, runId);
  if (!run) {
    return;
  }
  const workItem = run.work_item_id ? getWorkItem(db, run.work_item_id) : null;
  const project = workItem?.project_id ? getProject(db, workItem.project_id) : null;
  const milestone = workItem?.milestone_id ? getMilestone(db, workItem.milestone_id) : null;
  const logId = createId("missionLog");
  const markdownPath = buildMissionLogRelativePath(workspace, project?.name ?? "execution", logId);
  const missionLog = createMissionLog(db, {
    id: logId,
    projectId: workItem?.project_id,
    milestoneId: workItem?.milestone_id,
    workPerformed: renderRunSummary(run),
    result: summary,
    blockers: status === "completed" ? "" : summary,
    nextAction: status === "completed"
      ? "Review the execution evidence and follow-up Decision."
      : status === "requires_review"
        ? "Review failed Validation and decide how to revise."
        : "Inspect diagnostics and request a new attempt.",
    artifactImpact,
    markdownPath
  });
  writeMissionLogMarkdown(workspace, { missionLog, project, milestone });
  attachMissionLogToExecutionRun(db, runId, missionLog.id);
  updateExecutionRunStatus(db, runId, status, { pid: null, summary });
  if (workItem) {
    updateWorkItem(db, workItem.id, status === "failed"
      ? { queue: "blocked", workClassification: "blocked", status: "blocked", nextAction: "Inspect the failed Run and request retry." }
      : status === "requires_review"
        ? { queue: "requires_review", workClassification: "requires_review", status: "in_progress", nextAction: "Review failed Validation." }
        : { queue: "requires_review", workClassification: "requires_review", status: "in_progress", nextAction: "Review the executor result." });
  }
}

function finalizeWorkerFailure(
  db: ReturnType<typeof openDatabase>,
  workspace: string,
  runId: string,
  message: string
): void {
  finalizeGenericRun(db, workspace, runId, "failed", `Execution failed: ${message}`, "Diagnostic evidence retained.");
}

export function runWorkerStatusCommand(options: WorkerOptions): void {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const record = readWorkerRecord(workspacePath);
  const { health, pid } = classifyWorkerHealth(
    record,
    record ? null : readLegacyPid(workspacePath),
    isProcessAlive
  );

  if (health === "running") {
    process.stdout.write(`Worker: running (PID ${pid})\n`);
    return;
  }
  if (health === "unhealthy") {
    const heartbeat = record
      ? `its heartbeat is ${Math.max(0, Math.round((Date.now() - record.at) / 1000))}s old against a ${WORKER_HEARTBEAT_FRESHNESS_MS / 1000}s limit`
      : "it has no ownership record";
    process.stdout.write(`Worker: unhealthy (PID ${pid} is alive but ${heartbeat}; arcadia worker start will replace it)\n`);
    return;
  }
  if (pid === null) {
    process.stdout.write("Worker: not running (no pidfile)\n");
    return;
  }
  process.stdout.write(`Worker: stopped (stale pidfile for PID ${pid})\n`);
}

/**
 * Stop the worker, escalating to SIGKILL for a process that proves it is hung.
 *
 * SIGTERM alone is what Issue #485 left the operator with: the hung daemon
 * ignored it, `stop` reported success anyway, and only a hand-typed `kill -9`
 * recovered the workspace. Escalation is bounded and conditional — a worker
 * whose heartbeat is still fresh may simply be mid-tick, so it keeps the
 * ordinary SIGTERM and is reported as not yet exited rather than killed.
 */
export function runWorkerStopCommand(options: WorkerOptions, dependencies: WorkerRecoveryDependencies = {}): void {
  refuseIfManagedSession("stop", dependencies);
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const record = readWorkerRecord(workspacePath);
  const pid = record?.pid ?? readLegacyPid(workspacePath);

  if (!pid) {
    process.stdout.write("Worker is not running.\n");
    return;
  }

  if (!record || !isProcessAlive(pid)) {
    try { unlinkSync(pidfilePath(workspacePath)); } catch {}
    process.stdout.write(`Worker PID ${pid} is not alive or has no ownership record. Removed its pidfile without signalling that PID.\n`);
    return;
  }

  const sleep = dependencies.sleep ?? defaultSleep;
  const signal = dependencies.signal ?? defaultSignal;
  // Verify before the first signal, not only before the escalation: a recycled
  // PID must not receive a SIGTERM either.
  assertWorkspaceWorker(workspacePath, record, dependencies);
  signal(pid, "SIGTERM");
  if (waitForProcessExit(pid, dependencies.terminateGraceMs ?? WORKER_TERMINATE_GRACE_MS, sleep)) {
    process.stdout.write(`Sent SIGTERM to worker (PID ${pid}); it exited.\n`);
    return;
  }

  // Re-read rather than trusting the record that triggered the SIGTERM: the
  // grace period is five seconds, and a worker that was merely slow can refresh
  // its heartbeat, or hand the workspace to a successor, inside it. Escalating
  // on the pre-SIGTERM record would SIGKILL a worker that has since proved it
  // is alive.
  const now = (dependencies.now ?? Date.now)();
  const current = readWorkerRecord(workspacePath);
  if (!current || current.pid !== record.pid || current.owner !== record.owner) {
    process.stdout.write(`Sent SIGTERM to worker (PID ${pid}); it no longer owns the workspace pidfile, so it is stopping or was already replaced. Not escalating.\n`);
    return;
  }
  if (!isStaleWorkerHeartbeat(current, now)) {
    process.stdout.write(`Sent SIGTERM to worker (PID ${pid}); it has not exited yet but refreshed its heartbeat during the grace period, so it is probably mid-tick. Run arcadia worker status before escalating.\n`);
    return;
  }

  // A worker killed with SIGKILL never runs its own cleanup, so nothing else
  // will clear this record and it would outlive its owner.
  forceKillWorker(workspacePath, current, Math.max(0, now - current.at), dependencies);
  clearRecordForPid(workspacePath, pid);
  process.stdout.write(`Hung worker (PID ${pid}) ignored SIGTERM and was ended with SIGKILL; run arcadia worker start to bring it back.\n`);
}

export interface WorkerPlistInput {
  workspacePath: string;
  repositoryRoot: string;
  miseBin: string;
  logPath: string;
  home: string;
}

export const WORKER_PLIST_LABEL = "com.arcadia.worker";

/**
 * The worker's launch agent, always routed through mise.
 *
 * Separate from the install command so a test can assert what gets written
 * without installing anything. This previously baked `process.execPath` and the
 * installer's own `PATH` into the plist, which meant the worker ran forever
 * under whichever Node happened to be active the day someone typed
 * `arcadia worker install`.
 *
 * `KeepAlive` is a dictionary with `SuccessfulExit: false`, not a bare `true`:
 * launchd restarts the job only when it exits non-zero. A bare `true` respawns
 * on a clean exit too, so a second agent on a workspace whose pidfile is
 * already held looped forever writing the refusal into `worker.log`
 * (GitHub issue #303).
 */
export function buildWorkerPlist(input: WorkerPlistInput): string {
  const { workspacePath, repositoryRoot, miseBin, logPath: logFile } = input;
  // tsx's own entrypoint, not node_modules/.bin/tsx: the bin shim re-execs
  // whatever `node` its shebang finds, which is exactly the resolution this
  // plist exists to take out of the picture.
  const tsxBin = path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const cliPath = path.join(repositoryRoot, "src", "cli.ts");
  const plistLabel = WORKER_PLIST_LABEL;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistLabel}</string>
  <key>ProgramArguments</key>
  <array>
${[...miseNodeArgv(miseBin, repositoryRoot), tsxBin, cliPath, "worker", "start", "--workspace", workspacePath]
  .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
  .join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repositoryRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(miseLeadingPath(miseBin, input.home))}</string>
    <key>HOME</key>
    <string>${xmlEscape(input.home)}</string>
    <key>NODE_PATH</key>
    <string>${xmlEscape(path.join(repositoryRoot, "node_modules"))}</string>
  </dict>
</dict>
</plist>`;
}

const WORKER_READINESS_TIMEOUT_MS = 30_000;

export function waitForWorkerRoutes(workspacePath: string, timeoutMs: number, notBefore: number): boolean {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (transportPublishedSince(workspacePath, notBefore)) return true;
    if (Date.now() >= deadline) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
}

export function runWorkerInstallCommand(options: WorkerOptions, dependencies: WorkerInstallDependencies = {}): void {
  refuseIfManagedSession("install", dependencies);
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const home = process.env["HOME"] ?? "/tmp";
  const plistPath = path.join(home, "Library", "LaunchAgents", `${WORKER_PLIST_LABEL}.plist`);
  const plist = buildWorkerPlist({
    workspacePath,
    repositoryRoot,
    miseBin: resolveMiseExecutable(),
    logPath: logPath(workspacePath),
    home
  });

  const agentsDir = path.dirname(plistPath);
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(plistPath, plist, "utf8");

  const notBefore = (dependencies.now ?? Date.now)();
  try {
    (dependencies.execFileSync ?? execFileSync)("launchctl", ["load", plistPath], { stdio: "pipe" });
  } catch (error) {
    throw validationError(`launchctl load failed for ${plistPath}: ${error instanceof Error ? error.message : String(error)}. The worker was not started.`);
  }
  // `launchctl load` can exit 0 while the job never runs, so success is the
  // worker's own fresh preservation and go heartbeats, not the load call.
  if (!(dependencies.waitForRoutes ?? waitForWorkerRoutes)(workspacePath, WORKER_READINESS_TIMEOUT_MS, notBefore)) {
    throw validationError(`Worker was loaded via launchd but did not publish fresh heartbeats. ${transportHeartbeatDiagnostic(workspacePath, "go")}`);
  }
  process.stdout.write(`Worker installed and started via launchd; preservation and go heartbeats are fresh.\nPlist: ${plistPath}\n`);

  warnOnDuplicateWorkers(workspacePath);
}

/**
 * Installing a worker cannot replace an agent carrying a different label, so a
 * machine that already has one gets a second worker beside it rather than a
 * repaired one. Say so, once, at the moment it happens.
 */
function warnOnDuplicateWorkers(workspacePath: string): void {
  try {
    const warning = duplicateWorkerWarning(auditArcadiaLaunchAgents().agents, workspacePath);
    if (warning) process.stdout.write(`${warning}\n`);
  } catch {
    // An unreadable plist or a missing LaunchAgents directory must not fail an
    // install that already succeeded.
  }
}

export function runWorkerUninstallCommand(_options: WorkerOptions): void {
  const plistLabel = "com.arcadia.worker";
  const plistPath = path.join(
    process.env["HOME"] ?? "/tmp",
    "Library",
    "LaunchAgents",
    `${plistLabel}.plist`
  );

  try {
    execFileSync("launchctl", ["unload", plistPath]);
    process.stdout.write("Worker unloaded from launchd.\n");
  } catch {
    process.stdout.write("launchctl unload failed (may not have been loaded).\n");
  }

  try {
    unlinkSync(plistPath);
    process.stdout.write(`Plist removed: ${plistPath}\n`);
  } catch {
    process.stdout.write(`Plist not found at ${plistPath}\n`);
  }
}

export function recoverOrphanedRuns(db: ReturnType<typeof openDatabase>, logfile: string): void {
  const orphans = listOrphanedRuns(db);
  const workspace = path.dirname(path.dirname(logfile));
  for (const { id, pid } of orphans) {
    if (!isProcessAlive(pid)) {
      const run = getExecutionRun(db, id);
      const decision = run?.review_item_id ? getReviewItem(db, run.review_item_id) : null;
      const invocation = decision?.codex_invocation_id ? getCodexInvocation(db, decision.codex_invocation_id) : null;
      if (decision && isPlanningApprovalDecision(decision) && invocation?.status === "running") {
        finalizeWorkerFailure(db, workspace, id, "orphaned_execution_state: provider state is uncertain; request an immutable retry.");
        log(logfile, `Failed orphaned planning Run ${id}; invocation was already running.`);
        continue;
      }
      updateExecutionRunStatus(db, id, "pending_execution", { pid: null });
      log(logfile, `Recovered orphaned run ${id} (PID ${pid} is gone)`);
    }
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
