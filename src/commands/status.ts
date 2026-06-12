import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { buildStatusReportData, listReviewItems } from "../db/repositories.js";
import { WORK_CLASSIFICATION_LABELS, type WorkClassification } from "../domain/constants.js";
import { writeStatusReport } from "../markdown/statusReport.js";

export interface StatusCommandData {
  projectCount: number;
  activeProjectCount: number;
  runningWorkCount: number;
  queuedWorkCount: number;
  needsMarkCount: number;
  requiresReviewCount: number;
  autonomousCount: number;
  codexCount: number;
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
  }>;
}

export function runStatusCommand(options: { workspace: string }): CommandSuccess<StatusCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { data, reportPath, reviewItemCount } = withDatabase(workspacePath, (db) => {
    const reportData = buildStatusReportData(db, workspacePath);
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
      needsMarkCount: data.needsMarkItems.length,
      requiresReviewCount: reviewItemCount + data.needsMarkItems.length,
      autonomousCount: data.autonomousItems.length,
      codexCount: data.codexItems.length,
      blockedCount: data.blockedItems.length,
      recentMissionLogCount: data.recentMissionLogs.length,
      recentArtifactCount: data.upcomingArtifacts.length,
      reportPath,
      projects: data.projects.map((project) => ({
        name: project.name,
        status: project.status,
        currentMilestone: project.current_milestone,
        nextAction: project.next_action,
      workClassification: project.work_classification
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
      lines.push(`  Work classification: ${labelWorkClassification(project.workClassification)}`);
    }
  }

  lines.push(`Requires Review: ${response.data.requiresReviewCount}`);
  lines.push(`Autonomous: ${response.data.autonomousCount}`);
  lines.push(`Codex: ${response.data.codexCount}`);
  lines.push(`Blocked: ${response.data.blockedCount}`);
  lines.push(`Recent mission logs: ${response.data.recentMissionLogCount}`);
  lines.push(`Report: ${response.data.reportPath}`);
  return lines;
}

function labelWorkClassification(value: string | null): string {
  if (!value) {
    return "None";
  }

  return WORK_CLASSIFICATION_LABELS[value as WorkClassification] ?? value;
}
