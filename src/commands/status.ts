import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { buildStatusReportData } from "../db/repositories.js";
import { writeStatusReport } from "../markdown/statusReport.js";

export interface StatusCommandData {
  projectCount: number;
  needsMarkCount: number;
  autonomousCount: number;
  codexCount: number;
  blockedCount: number;
  recentMissionLogCount: number;
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
  const { data, reportPath } = withDatabase(workspacePath, (db) => {
    const reportData = buildStatusReportData(db, workspacePath);
    const writtenReportPath = writeStatusReport(workspacePath, reportData);
    return { data: reportData, reportPath: writtenReportPath };
  });

  return createSuccess({
    command: "status",
    workspace: workspacePath,
    data: {
      projectCount: data.projects.length,
      needsMarkCount: data.needsMarkItems.length,
      autonomousCount: data.autonomousItems.length,
      codexCount: data.codexItems.length,
      blockedCount: data.blockedItems.length,
      recentMissionLogCount: data.recentMissionLogs.length,
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
      lines.push(`  Work classification: ${project.workClassification ?? "None"}`);
    }
  }

  lines.push(`Needs Mark: ${response.data.needsMarkCount}`);
  lines.push(`Autonomous: ${response.data.autonomousCount}`);
  lines.push(`Codex: ${response.data.codexCount}`);
  lines.push(`Blocked: ${response.data.blockedCount}`);
  lines.push(`Recent mission logs: ${response.data.recentMissionLogCount}`);
  lines.push(`Report: ${response.data.reportPath}`);
  return lines;
}
