import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import {
  buildDashboardSnapshot,
  type DashboardAttentionItem,
  type DashboardSnapshot
} from "../dashboard/snapshot.js";

export interface DashboardSnapshotCommandData {
  snapshot: DashboardSnapshot;
}

export interface AttentionCommandData {
  generatedAt: string;
  items: DashboardAttentionItem[];
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

export function runAttentionCommand(options: { workspace: string }): CommandSuccess<AttentionCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const snapshot = buildDashboardSnapshot({ workspace: workspacePath });

  return createSuccess({
    command: "attention",
    workspace: workspacePath,
    data: {
      generatedAt: snapshot.generatedAt,
      items: snapshot.attentionItems
    },
    artifacts: snapshot.attentionItems.flatMap((item) => item.relatedArtifactPath ? [item.relatedArtifactPath] : [])
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
    `Attention: ${snapshot.counts.attention}`,
    `Requires Review: ${snapshot.counts.requiresReview}`,
    `Back Burner: ${snapshot.counts.backBurner}`,
    `Active runs: ${snapshot.counts.activeRuns}`,
    `Recent runs: ${snapshot.counts.recentRuns}`,
    `Recent artifacts: ${snapshot.counts.recentArtifacts}`,
    `Activity events: ${snapshot.counts.activityEvents}`
  ];
}

export function renderAttentionSuccess(response: CommandSuccess<AttentionCommandData>): string[] {
  if (response.data.items.length === 0) {
    return ["Arcadia Attention", "No immediate user-facing blockers."];
  }

  return [
    "Arcadia Attention",
    ...response.data.items.flatMap((item, index) => [
      "",
      `${index + 1}. ${item.reason}`,
      `   Project: ${item.projectName ?? "Unassigned"}`,
      `   Work item: ${item.workItemTitle ?? item.workItemId ?? "None"}`,
      `   Artifact: ${item.relatedArtifactPath ?? item.relatedArtifactTitle ?? "None"}`,
      `   Next action: ${item.nextAction}`,
      `   Actions: ${item.primaryActions.map(renderAttentionAction).join(" | ")}`
    ])
  ];
}

function renderAttentionAction(action: DashboardAttentionItem["primaryActions"][number]): string {
  if (action.command) {
    return `${action.label}: ${action.command}`;
  }

  if (action.href) {
    return `${action.label}: ${action.href}`;
  }

  if (action.reviewAction) {
    return action.label;
  }

  return action.label;
}
