import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { buildDashboardSnapshot, type DashboardSnapshot } from "../dashboard/snapshot.js";

export interface DashboardSnapshotCommandData {
  snapshot: DashboardSnapshot;
}

export function runDashboardSnapshotCommand(options: { workspace: string }): CommandSuccess<DashboardSnapshotCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const snapshot = buildDashboardSnapshot({ workspace: workspacePath });

  return createSuccess({
    command: "dashboard.snapshot",
    workspace: workspacePath,
    data: { snapshot }
  });
}

export function renderDashboardSnapshotSuccess(response: CommandSuccess<DashboardSnapshotCommandData>): string[] {
  const { snapshot } = response.data;

  return [
    "Arcadia Dashboard Snapshot",
    `Workspace: ${snapshot.workspace}`,
    `Active projects: ${snapshot.counts.activeProjects}`,
    `Paused projects: ${snapshot.counts.pausedProjects}`,
    `Incubating projects: ${snapshot.counts.incubatingProjects}`,
    `Requires Review: ${snapshot.counts.requiresReview}`,
    `Recent runs: ${snapshot.counts.recentRuns}`,
    `Recent artifacts: ${snapshot.counts.recentArtifacts}`
  ];
}
