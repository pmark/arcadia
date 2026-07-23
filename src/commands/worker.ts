import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveReadyWorkspace } from "../cli/workspace.js";
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
import { createId } from "../utils/id.js";

const POLL_INTERVAL_MS = 2_000;

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

function heartbeatPath(workspacePath: string): string {
  return path.join(arcadiaDir(workspacePath), "worker.heartbeat");
}

function log(logfile: string, message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try { appendFileSync(logfile, line, "utf8"); } catch {}
  process.stdout.write(line);
}

function readPid(workspacePath: string): number | null {
  try {
    const raw = readFileSync(pidfilePath(workspacePath), "utf8").trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runWorkerStartCommand(options: WorkerOptions): never {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const dir = arcadiaDir(workspacePath);
  mkdirSync(dir, { recursive: true });

  const existing = readPid(workspacePath);
  if (existing && isProcessAlive(existing)) {
    process.stderr.write(`Worker already running (PID ${existing}).\n`);
    process.exit(1);
  }

  const logfile = logPath(workspacePath);
  writeFileSync(pidfilePath(workspacePath), String(process.pid), "utf8");
  writeFileSync(heartbeatPath(workspacePath), new Date().toISOString(), "utf8");
  const heartbeatTimer = setInterval(() => {
    try { writeFileSync(heartbeatPath(workspacePath), new Date().toISOString(), "utf8"); } catch {}
  }, 5_000);
  log(logfile, `Worker started (PID: ${process.pid}, workspace: ${workspacePath})`);

  const cleanup = () => {
    log(logfile, "Worker stopping.");
    clearInterval(heartbeatTimer);
    try { unlinkSync(pidfilePath(workspacePath)); } catch {}
    try { unlinkSync(heartbeatPath(workspacePath)); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const tick = () => {
    try { writeFileSync(heartbeatPath(workspacePath), new Date().toISOString(), "utf8"); } catch {}
    const db = openDatabase(workspacePath);
    try {
      runWorkerIteration(db, workspacePath, process.pid, logfile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(logfile, `Worker tick error: ${message}`);
    } finally {
      db.close();
    }

    setTimeout(tick, POLL_INTERVAL_MS);
  };

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
  recoverOrphanedRuns(db, logfile);
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
    const summary = [
      `Executed with ${result.executor}.`,
      `${result.changedFiles.length} file(s) changed.`,
      `Validation: ${status === "completed" ? "passed" : status === "requires_review" ? "failed" : "not run"}.`,
      `Follow-up Decision: ${result.followUpReview.slug ?? result.followUpReview.id}.`
    ].join(" ");
    finalizeGenericRun(db, workspacePath, run.id, status, summary, result.artifact.path ?? result.metadataPath);
    log(logfile, `Run ${run.id} ${status} (exit: ${result.exitStatus})`);
  } catch (error) {
    finalizeWorkerFailure(db, workspacePath, run.id, error instanceof Error ? error.message : String(error));
  }
  return getExecutionRun(db, run.id);
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

  if (isProcessAlive(pid)) {
    process.stdout.write(`Worker: running (PID ${pid})\n`);
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

  if (!isProcessAlive(pid)) {
    try { unlinkSync(pidfilePath(workspacePath)); } catch {}
    process.stdout.write(`Worker PID ${pid} is not alive. Removed stale pidfile.\n`);
    return;
  }

  process.kill(pid, "SIGTERM");
  process.stdout.write(`Sent SIGTERM to worker (PID ${pid}).\n`);
}

export function runWorkerInstallCommand(options: WorkerOptions): void {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const nodeBin = process.execPath;
  const cliPath = path.resolve(import.meta.dirname, "../../src/cli.ts");
  const tsxBin = path.resolve(import.meta.dirname, "../../node_modules/.bin/tsx");

  const plistLabel = "com.arcadia.worker";
  const plistPath = path.join(
    process.env["HOME"] ?? "/tmp",
    "Library",
    "LaunchAgents",
    `${plistLabel}.plist`
  );

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${tsxBin}</string>
    <string>${cliPath}</string>
    <string>worker</string>
    <string>start</string>
    <string>--workspace</string>
    <string>${workspacePath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath(workspacePath)}</string>
  <key>StandardErrorPath</key>
  <string>${logPath(workspacePath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}</string>
    <key>HOME</key>
    <string>${process.env["HOME"] ?? ""}</string>
    <key>NODE_PATH</key>
    <string>${path.resolve(import.meta.dirname, "../../node_modules")}</string>
  </dict>
</dict>
</plist>`;

  const agentsDir = path.dirname(plistPath);
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(plistPath, plist, "utf8");

  try {
    execFileSync("launchctl", ["load", plistPath]);
    process.stdout.write(`Worker installed and started via launchd.\nPlist: ${plistPath}\n`);
  } catch {
    process.stdout.write(`Plist written to ${plistPath}. Run: launchctl load "${plistPath}"\n`);
  }
}

export function runWorkerUninstallCommand(options: WorkerOptions): void {
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
