import { withDatabase } from "../db/connection.js";
import { buildStatusReportData } from "../db/repositories.js";
import { writeStatusReport } from "../markdown/statusReport.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

export function runStatusCommand(options: { workspace: string }): void {
  const workspacePath = resolveWorkspacePath(options.workspace);
  const { data, reportPath } = withDatabase(workspacePath, (db) => {
    const reportData = buildStatusReportData(db, workspacePath);
    const writtenReportPath = writeStatusReport(workspacePath, reportData);
    return { data: reportData, reportPath: writtenReportPath };
  });

  console.log("Arcadia Status");
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Projects: ${data.projects.length}`);

  if (data.projects.length === 0) {
    console.log("- No projects yet.");
  } else {
    for (const project of data.projects) {
      console.log(`- ${project.name} (${project.status})`);
      console.log(`  Milestone: ${project.current_milestone ?? "None"}`);
      console.log(`  Next action: ${project.next_action ?? "None"}`);
      console.log(`  Work classification: ${project.work_classification ?? "None"}`);
    }
  }

  console.log(`Needs Mark: ${data.needsMarkItems.length}`);
  console.log(`Autonomous: ${data.autonomousItems.length}`);
  console.log(`Codex: ${data.codexItems.length}`);
  console.log(`Blocked: ${data.blockedItems.length}`);
  console.log(`Recent mission logs: ${data.recentMissionLogs.length}`);
  console.log(`Report: ${reportPath}`);
}
