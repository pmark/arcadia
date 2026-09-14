import type Database from "better-sqlite3";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { buildStatusReportData, listReviewItems } from "../db/repositories.js";
import { buildAgentQueue } from "../dispatch/queue.js";
import { WORK_CLASSIFICATION_LABELS, type WorkClassification } from "../domain/constants.js";
import { writeStatusReport } from "../markdown/statusReport.js";

export interface StatusCommandData {
  projectCount: number;
  activeProjectCount: number;
  runningWorkCount: number;
  queuedWorkCount: number;
  requiresReviewWorkCount: number;
  requiresReviewCount: number;
  autonomousCount: number;
  agentCount: number;
  blockedCount: number;
  recentMissionLogCount: number;
  recentArtifactCount: number;
  reportPath: string;
  projects: Array<{
    name: string;
    status: string;
    currentMilestone: string | null;
    nextAction: string | null;
    workClassification: string | null;
    responsibility: string | null;
  }>;
}

export function runStatusCommand(options: { workspace: string }): CommandSuccess<StatusCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { data, reportPath, reviewItemCount } = withDatabase(workspacePath, (db) => {
    const reportData = buildStatusReportData(db, workspacePath);
    applyDispatchNextActions(db, reportData.projects);
    const reviewItemCount = listReviewItems(db, "open").length + listReviewItems(db, "deferred").length;
    const writtenReportPath = writeStatusReport(workspacePath, reportData);
    return { data: reportData, reportPath: writtenReportPath, reviewItemCount };
  });

  return createSuccess({
    command: "status",
    workspace: workspacePath,
    data: {
      projectCount: data.projects.length,
      activeProjectCount: data.projects.filter((project) => project.status === "active").length,
      runningWorkCount: Object.values(data.queues).flat().filter((item) => item.status === "in_progress").length,
      queuedWorkCount: data.queues.work_queue.length,
      requiresReviewWorkCount: data.requiresReviewItems.length,
      requiresReviewCount: reviewItemCount + data.requiresReviewItems.length,
      autonomousCount: data.autonomousItems.length,
      agentCount: data.agentItems.length,
      blockedCount: data.blockedItems.length,
      recentMissionLogCount: data.recentMissionLogs.length,
      recentArtifactCount: data.upcomingArtifacts.length,
      reportPath,
      projects: data.projects.map((project) => ({
        name: project.name,
        status: project.status,
        currentMilestone: project.current_milestone,
        nextAction: project.next_action,
        workClassification: project.work_classification,
        responsibility: project.responsibility
      }))
    },
    artifacts: [reportPath]
  });
}

export function renderStatusSuccess(response: CommandSuccess<StatusCommandData>): string[] {
  const lines = [
    "Arcadia Status",
    `Workspace: ${response.workspace ?? ""}`,
    `Projects: ${response.data.projectCount}`
  ];

  if (response.data.projects.length === 0) {
    lines.push("- No projects yet.");
  } else {
    for (const project of response.data.projects) {
      lines.push(`- ${project.name} (${project.status})`);
      lines.push(`  Milestone: ${project.currentMilestone ?? "None"}`);
      lines.push(`  Next action: ${project.nextAction ?? "None"}`);
      lines.push(`  Responsibility: ${labelWorkClassification(project.responsibility ?? project.workClassification)}`);
    }
  }

  lines.push(`Requires Review: ${response.data.requiresReviewCount}`);
  lines.push(`Autonomous: ${response.data.autonomousCount}`);
  lines.push(`Agent: ${response.data.agentCount}`);
  lines.push(`Blocked: ${response.data.blockedCount}`);
  lines.push(`Recent mission logs: ${response.data.recentMissionLogCount}`);
  lines.push(`Report: ${response.data.reportPath}`);
  return lines;
}

/**
 * Replace each Project's next Action with the one dispatch would actually pick.
 *
 * `listProjectSummaries` answers this with the most recently *touched* open
 * Action (`ORDER BY wi.updated_at DESC`), which is a different question and
 * routinely a wrong answer: a freshly created Action outranks the governed
 * pointer, and an Action still waiting on its dependency outranks the one that
 * would unblock it. The report then names work that cannot be started, which is
 * worse than naming nothing — this is the report an operator orients from.
 *
 * The agent queue already computes the dependency-aware ready set that `next`
 * and `advance queue` agree on, so reuse it rather than teaching the status
 * report to resolve dependencies a second time. Where nothing is ready, say so
 * and name the blocker instead of falling back to a startable-looking lie.
 *
 * A Project the queue says nothing about keeps its existing value; this
 * corrects what the queue can answer and invents nothing where it cannot.
 */
function applyDispatchNextActions(
  db: Database.Database,
  projects: Array<{ id: string; next_action: string | null }>
): void {
  const queue = buildAgentQueue(db);
  const resolved = new Map<string, string>();

  for (const entry of queue.ready) {
    if (!entry.projectId || resolved.has(entry.projectId)) {
      continue;
    }
    resolved.set(entry.projectId, entry.nextAction || entry.actionTitle || "Ready to start.");
  }

  // Only after every ready Action is claimed, so a Project with real work
  // available is never described by one of its blocked siblings.
  for (const entry of queue.attention) {
    if (!entry.projectId || resolved.has(entry.projectId)) {
      continue;
    }
    const blocker = entry.blockers[0];
    const detail = blocker?.remedy || blocker?.message || entry.reason;
    resolved.set(entry.projectId, detail ? `Nothing ready — ${detail}` : "Nothing ready.");
  }

  for (const project of projects) {
    const next = resolved.get(project.id);
    if (next !== undefined) {
      project.next_action = next;
    }
  }
}

function labelWorkClassification(value: string | null): string {
  if (!value) {
    return "None";
  }

  return WORK_CLASSIFICATION_LABELS[value as WorkClassification] ?? value;
}
