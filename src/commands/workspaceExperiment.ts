import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ArcadiaError, usageError, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { isGuardedOperation, refuseInExperimentWorkspace } from "../workspace/experimentGuard.js";
import {
  compareLeakSnapshots,
  parseLeakSnapshot,
  takeLeakSnapshot,
  type LeakChange,
  type LeakSnapshot
} from "../workspace/leakCheck.js";
import { resolveWorkspace } from "../workspace/resolve.js";

export interface LeakCheckData {
  snapshot: LeakSnapshot;
  recordedTo: string | null;
  baseline: string | null;
  changes: LeakChange[] | null;
}

/**
 * `arcadia workspace leak-check`: take the snapshot, optionally record it,
 * and optionally compare it with an earlier one. Any change against the
 * baseline fails the command, so a script can stop a trial on it.
 */
export function runLeakCheckCommand(options: { record?: string; baseline?: string; live?: string }): CommandSuccess<LeakCheckData> {
  const snapshot = takeLeakSnapshot({ liveWorkspace: options.live });
  let changes: LeakChange[] | null = null;
  if (options.baseline) {
    const baselinePath = path.resolve(options.baseline);
    let raw: string;
    try {
      raw = readFileSync(baselinePath, "utf8");
    } catch (error) {
      throw validationError("Leak-check baseline could not be read.", {
        baseline: baselinePath,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    changes = compareLeakSnapshots(parseLeakSnapshot(raw, baselinePath), snapshot);
  }
  const recordedTo = options.record ? path.resolve(options.record) : null;
  if (recordedTo) {
    mkdirSync(path.dirname(recordedTo), { recursive: true });
    writeFileSync(recordedTo, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
  if (changes && changes.length > 0) {
    throw new ArcadiaError(
      "WORKSPACE_LEAK_DETECTED",
      `Leak check found ${changes.length} change(s) to shared state since the baseline.`,
      1,
      { baseline: path.resolve(options.baseline as string), changes, recordedTo }
    );
  }
  return createSuccess({
    command: "workspace.leak-check",
    data: { snapshot, recordedTo, baseline: options.baseline ? path.resolve(options.baseline) : null, changes }
  });
}

export function renderLeakCheckSuccess(response: CommandSuccess<LeakCheckData>): string[] {
  const { snapshot, recordedTo, baseline, changes } = response.data;
  const live = snapshot.liveWorkspace;
  const lines = [
    `Live workspace: ${live.path ?? "not configured"}${live.error ? ` (${live.error})` : ""}`,
    `Projects: ${live.projectCount ?? "unknown"}  Queue revision: ${live.queueRevision ?? "unknown"}`,
    `User config: ${short(snapshot.hashes.userConfig)}  Codex config: ${short(snapshot.hashes.codexConfig)}`,
    `Claude settings: ${short(snapshot.hashes.claudeSettings)}  Claude trust: ${short(snapshot.hashes.claudeTrust)}`,
    `Arcadia launch agents: ${Object.keys(snapshot.launchAgents).length}`
  ];
  if (recordedTo) lines.push(`Recorded: ${recordedTo}`);
  if (baseline) lines.push(changes && changes.length === 0 ? `No change since ${baseline}.` : `Compared with ${baseline}.`);
  return lines;
}

function short(hash: string | null): string {
  return hash ? hash.slice(0, 12) : "absent";
}

export interface WorkspaceGuardData {
  operation: string;
  workspace: string | null;
  allowed: true;
}

/**
 * `arcadia workspace guard <operation>`: the same guard, for shell callers
 * such as `scripts/services.sh`. Succeeds when the operation may run against
 * the resolved workspace; fails with the named refusal otherwise.
 */
export function runWorkspaceGuardCommand(options: { operation: string; workspace?: string }): CommandSuccess<WorkspaceGuardData> {
  if (!isGuardedOperation(options.operation)) {
    throw usageError("Unknown guarded operation.", { operation: options.operation });
  }
  const workspace = resolveWorkspace({ workspace: options.workspace }).workspacePath;
  refuseInExperimentWorkspace(options.operation, workspace);
  return createSuccess({
    command: "workspace.guard",
    data: { operation: options.operation, workspace, allowed: true }
  });
}

export function renderWorkspaceGuardSuccess(response: CommandSuccess<WorkspaceGuardData>): string[] {
  return [`Allowed: ${response.data.operation} (${response.data.workspace ?? "no workspace resolved"})`];
}
