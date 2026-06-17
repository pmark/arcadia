import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import {
  claimNextPendingRun,
  listOrphanedRuns,
  updateExecutionRunStatus
} from "../db/repositories.js";
import { executeApprovedReview } from "../execution/reviewExecutor.js";

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
  log(logfile, `Worker started (PID: ${process.pid}, workspace: ${workspacePath})`);

  const cleanup = () => {
    log(logfile, "Worker stopping.");
    try { unlinkSync(pidfilePath(workspacePath)); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const tick = () => {
    const db = openDatabase(workspacePath);
    try {
      recoverOrphanedRuns(db, logfile);
      const run = claimNextPendingRun(db, process.pid);
      if (run?.review_item_id) {
        log(logfile, `Executing run ${run.id} (review: ${run.review_item_id}, executor: ${run.executor_name ?? "codex"})`);
        try {
          const result = executeApprovedReview(db, {
            workspace: workspacePath,
            reviewId: run.review_item_id,
            executorName: run.executor_name ?? undefined
          });
          const validationPassed = result.validation.every((v) => v.exitStatus === 0);
          const summary = [
            `Executed with ${result.executor}.`,
            `${result.changedFiles.length} file(s) changed.`,
            `Validation: ${validationPassed ? "passed" : "failed"}.`,
            `Follow-up review: ${result.followUpReview.slug ?? result.followUpReview.id}.`
          ].join(" ");
          updateExecutionRunStatus(db, run.id, "completed", { pid: null, summary });
          log(logfile, `Run ${run.id} completed (exit: ${result.exitStatus})`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          updateExecutionRunStatus(db, run.id, "failed", { pid: null, summary: `Execution failed: ${message}` });
          log(logfile, `Run ${run.id} failed: ${message}`);
        }
      }
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

function recoverOrphanedRuns(db: ReturnType<typeof openDatabase>, logfile: string): void {
  const orphans = listOrphanedRuns(db);
  for (const { id, pid } of orphans) {
    if (!isProcessAlive(pid)) {
      updateExecutionRunStatus(db, id, "pending_execution", { pid: null });
      log(logfile, `Recovered orphaned run ${id} (PID ${pid} is gone)`);
    }
  }
}
