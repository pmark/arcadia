import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ArcadiaError, usageError, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { isGuardedOperation, refuseInExperimentWorkspace } from "../workspace/experimentGuard.js";
import {
  compareAttributedFields,
  compareLeakSnapshots,
  parseLeakSnapshot,
  takeLeakSnapshot,
  unverifiableReason,
  type AttributedChange,
  type LeakChange,
  type LeakSnapshot
} from "../workspace/leakCheck.js";
import { resolveWorkspace } from "../workspace/resolve.js";

export interface LeakCheckData {
  snapshot: LeakSnapshot;
  recordedTo: string | null;
  baseline: string | null;
  changes: LeakChange[] | null;
  /**
   * Changes in the attributed fields (live activity rows, live repository
   * refs) since the baseline. Never a leak by themselves: attribute each one.
   */
  attributed: AttributedChange[] | null;
}

export const ATTRIBUTION_NOTE =
  "Attributed fields, not a leak by themselves: other agents and the operator settling, pushing or running commands against the live workspace change them; attribute each change before calling it a leak.";

/**
 * `arcadia workspace leak-check`: take the snapshot, optionally record it,
 * and optionally compare it with an earlier one. Any change against the
 * baseline fails the command, so a script can stop a trial on it.
 */
export function runLeakCheckCommand(options: { record?: string; baseline?: string; live?: string; liveRepo?: string }): CommandSuccess<LeakCheckData> {
  const snapshot = takeLeakSnapshot({ liveWorkspace: options.live, liveRepo: options.liveRepo });
  let changes: LeakChange[] | null = null;
  let attributed: AttributedChange[] | null = null;
  let baselineSnapshot: LeakSnapshot | null = null;
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
    baselineSnapshot = parseLeakSnapshot(raw, baselinePath);
    changes = compareLeakSnapshots(baselineSnapshot, snapshot);
    attributed = compareAttributedFields(baselineSnapshot, snapshot);
  }
  const recordedTo = options.record ? path.resolve(options.record) : null;
  if (recordedTo) {
    mkdirSync(path.dirname(recordedTo), { recursive: true });
    writeFileSync(recordedTo, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
  // A snapshot that could not read the live workspace proves nothing, and two
  // identical failures would otherwise compare as "no change".
  const unverifiable = unverifiableReason(snapshot, ...(baselineSnapshot ? [baselineSnapshot] : []));
  if (unverifiable) {
    throw new ArcadiaError(
      "LEAK_CHECK_UNVERIFIABLE",
      `Leak check could not verify the live workspace: ${unverifiable}.`,
      1,
      {
        unverifiable: true,
        reason: unverifiable,
        recordedTo,
        changes,
        attributed,
        remedy: "Run it where the live workspace database is readable (for example outside the agent sandbox), or name it with --live."
      }
    );
  }
  if (changes && changes.length > 0) {
    throw new ArcadiaError(
      "WORKSPACE_LEAK_DETECTED",
      `Leak check found ${changes.length} change(s) to shared state since the baseline.`,
      1,
      { baseline: path.resolve(options.baseline as string), changes, attributed, attributionNote: ATTRIBUTION_NOTE, recordedTo }
    );
  }
  return createSuccess({
    command: "workspace.leak-check",
    data: { snapshot, recordedTo, baseline: options.baseline ? path.resolve(options.baseline) : null, changes, attributed }
  });
}

export function renderLeakCheckSuccess(response: CommandSuccess<LeakCheckData>): string[] {
  const { snapshot, recordedTo, baseline, changes, attributed } = response.data;
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
  lines.push("", ...renderAttributed(snapshot, attributed));
  return lines;
}

function renderAttributed(snapshot: LeakSnapshot, attributed: AttributedChange[] | null): string[] {
  const activity = snapshot.liveActivity;
  const refs = snapshot.liveRefs;
  const lines = [
    activity && !activity.error
      ? `Live activity rows: ${activity.rowCount}  newest rowid ${activity.newestRowid ?? "none"}${activity.newestCommand ? ` (${activity.newestCommand} at ${activity.newestOccurredAt})` : ""}`
      : `Live activity rows: unknown${activity?.error ? ` (${activity.error})` : ""}`,
    refs && !refs.error && refs.counts
      ? `Live repository refs: ${refs.repo}  heads ${refs.counts.heads}, remotes ${refs.counts.remotes}, tags ${refs.counts.tags}, refs/codex ${refs.counts.codex}  (${short(refs.hash)})`
      : `Live repository refs: unknown${refs?.error ? ` (${refs.error})` : ""}`,
    ATTRIBUTION_NOTE
  ];
  if (attributed) {
    lines.push(attributed.length === 0
      ? "No attributed change since the baseline."
      : `Attributed changes since the baseline (${attributed.length}):`);
    for (const change of attributed) lines.push(`  ${change.field}: ${change.before ?? "none"} -> ${change.after ?? "none"}`);
  }
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
