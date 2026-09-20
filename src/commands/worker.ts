import { appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveReadyWorkspace } from "../cli/workspace.js";
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

import { agentGoTransportReady, preservationTransportReady, processPreservationRequests, refreshPreservationHeartbeat, transportHeartbeatDiagnostic } from "../sessions/preservationTransport.js";
import { auditArcadiaLaunchAgents, duplicateWorkerWarning } from "../runtime/launchAgents.js";

const POLL_INTERVAL_MS = 2_000;
const WORKER_HEARTBEAT_FRESHNESS_MS = 15_000;

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

function hasFreshWorkerHeartbeat(workspacePath: string, identity: WorkerIdentity, now = Date.now()): boolean {
  const record = readWorkerRecord(workspacePath);
  return record?.pid === identity.pid &&
    record.owner === identity.owner &&
    now - record.at >= 0 &&
    now - record.at < WORKER_HEARTBEAT_FRESHNESS_MS;
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

function readPid(workspacePath: string): number | null {
  const identity = readWorkerIdentity(workspacePath);
  if (identity) return identity.pid;
  return readLegacyPid(workspacePath);
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

  const tick = () => {
    if (!owns()) {
      onOwnershipLost();
      return;
    }
    try {
      try { writeWorkerHeartbeat(options.workspacePath, options.identity ?? { pid: options.pid, owner: "test" }); } catch {}
      const db = openDb(options.workspacePath);
      try {
        runWorkerIteration(db, options.workspacePath, options.pid, options.logfile);
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
  action: "start" | "already-running";
  pid: number | null;
}

/**
 * Whether this process may own the workspace, or a live worker already does.
 *
 * The already-running path is benign, not a failure: it is exactly what a
 * second launch agent for one workspace hits on every run. Reporting it as an
 * error is what made a `KeepAlive` agent respawn forever and write the refusal
 * into `.arcadia/worker.log` (GitHub issue #303). Keeping the decision separate
 * from the exit code lets a test prove the benign path without spawning one.
 */
export function decideWorkerStart(
  existing: WorkerIdentity | null,
  isAlive: (pid: number) => boolean
): WorkerStartDecision {
  // A stale heartbeat means unhealthy, not dead. Replacing a PID that remains
  // live can create two workers; only the service controller may stop it and
  // establish a fresh ownership boundary before another start is attempted.
  if (existing && isAlive(existing.pid)) {
    return { action: "already-running", pid: existing.pid };
  }
  return { action: "start", pid: null };
}

export function runWorkerStartCommand(options: WorkerOptions): never {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const dir = arcadiaDir(workspacePath);
  mkdirSync(dir, { recursive: true });

  const existing = readWorkerIdentity(workspacePath);
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
    isProcessAlive
  );
  if (decision.action === "already-running") {
    // Exit 0, not 1: a non-zero status is what launchd reads as a crash. Paired
    // with KeepAlive SuccessfulExit false below, a clean exit leaves the agent
    // stopped instead of respawning it against a supervisor that already won.
    process.stdout.write(`Worker already running (PID ${decision.pid}); leaving it in place.\n`);
    process.exit(0);
  }

  const logfile = logPath(workspacePath);
  const identity = { pid: process.pid, owner: randomUUID() };
  writeWorkerHeartbeat(workspacePath, identity);
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
  logfile = logPath(workspacePath)
): ReturnType<typeof getExecutionRun> {
  if (!process.env.CODEX_SANDBOX) processPreservationRequests(db, workspacePath);
  recoverOrphanedRuns(db, logfile);
  runManagedProductionIteration(db, workspacePath, logfile);
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
  logfile: string
): void {
  try {
    const registries = loadPhase3Registries(workspacePath);
    if (!registries.providerAdapters) {
      return;
    }
    const result = runManagedProductionTick(db, workspacePath, {
      profiles: registries.codingAgents.profiles,
      adapters: registries.providerAdapters,
      heartbeat: () => refreshPreservationHeartbeat(workspacePath),
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
  const pid = readPid(workspacePath);

  if (!pid) {
    process.stdout.write("Worker: not running (no pidfile)\n");
    return;
  }

  const identity = readWorkerIdentity(workspacePath);
  if (identity && isProcessAlive(pid) && hasFreshWorkerHeartbeat(workspacePath, identity)) {
    process.stdout.write(`Worker: running (PID ${pid})\n`);
  } else if (isProcessAlive(pid)) {
    process.stdout.write(`Worker: unhealthy (PID ${pid} has no fresh matching heartbeat; launchd may restart it)\n`);
  } else {
    process.stdout.write(`Worker: stopped (stale pidfile for PID ${pid})\n`);
  }
}

export function runWorkerStopCommand(options: WorkerOptions): void {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const pid = readPid(workspacePath);

  if (!pid) {
    process.stdout.write("Worker is not running.\n");
    return;
  }

  const identity = readWorkerIdentity(workspacePath);
  if (!identity || !isProcessAlive(pid)) {
    try { unlinkSync(pidfilePath(workspacePath)); } catch {}
    process.stdout.write(`Worker PID ${pid} is not alive or has no ownership record. Removed its pidfile without signalling that PID.\n`);
    return;
  }

  process.kill(pid, "SIGTERM");
  process.stdout.write(`Sent SIGTERM to worker (PID ${pid}).\n`);
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

function waitForWorkerRoutes(workspacePath: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (preservationTransportReady(workspacePath) && agentGoTransportReady(workspacePath)) return true;
    if (Date.now() >= deadline) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
}

export function runWorkerInstallCommand(options: WorkerOptions): void {
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

  try {
    execFileSync("launchctl", ["load", plistPath], { stdio: "pipe" });
  } catch (error) {
    throw validationError(`launchctl load failed for ${plistPath}: ${error instanceof Error ? error.message : String(error)}. The worker was not started.`);
  }
  // `launchctl load` can exit 0 while the job never runs, so success is the
  // worker's own fresh preservation and go heartbeats, not the load call.
  if (!waitForWorkerRoutes(workspacePath, WORKER_READINESS_TIMEOUT_MS)) {
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
