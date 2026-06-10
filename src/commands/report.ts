import { withDatabase } from "../db/connection.js";
import { buildStatusReportData } from "../db/repositories.js";
import { writeStatusReport } from "../markdown/statusReport.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

export function runReportStatusCommand(options: { workspace: string }): void {
  const workspacePath = resolveWorkspacePath(options.workspace);
  const reportPath = withDatabase(workspacePath, (db) => {
    const data = buildStatusReportData(db, workspacePath);
    return writeStatusReport(workspacePath, data);
  });

  console.log(`Status report written: ${reportPath}`);
}
