import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { buildStatusReportData } from "../db/repositories.js";
import { writeStatusReport } from "../markdown/statusReport.js";

export interface ReportStatusCommandData {
  reportPath: string;
}

export function runReportStatusCommand(options: { workspace: string }): CommandSuccess<ReportStatusCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const reportPath = withDatabase(workspacePath, (db) => {
    const data = buildStatusReportData(db, workspacePath);
    return writeStatusReport(workspacePath, data);
  });

  return createSuccess({
    command: "report.status",
    workspace: workspacePath,
    data: { reportPath },
    artifacts: [reportPath]
  });
}

export function renderReportStatusSuccess(response: CommandSuccess<ReportStatusCommandData>): string[] {
  return [`Status report written: ${response.data.reportPath}`];
}
