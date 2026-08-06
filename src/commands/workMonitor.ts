import type Database from "better-sqlite3";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { formatWorkingCopySafetyLines, scanProjectWorkingCopies } from "../workMonitoring/scanner.js";
import type { WorkMonitorProject, WorkMonitorSnapshot } from "../workMonitoring/types.js";

export interface WorkMonitorCommandData {
  snapshot: WorkMonitorSnapshot;
  attentionLines: string[];
}

export function listMonitoredProjects(
  db: Database.Database,
  options: { includeInactive?: boolean } = {}
): WorkMonitorProject[] {
  return listProjects(db)
    .filter((project) => options.includeInactive || project.status === "active")
    .map((project) => ({
      id: project.id,
      name: project.name,
      repositoryPath: getProjectMetadata(db, project.id)?.repo_path ?? null
    }));
}

export function runWorkMonitorCommand(options: {
  workspace: string;
  includePullRequests?: boolean;
}): CommandSuccess<WorkMonitorCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const snapshot = scanProjectWorkingCopies(listMonitoredProjects(db), {
      includePullRequests: options.includePullRequests !== false
    });
    return createSuccess({
      command: "work.monitor",
      workspace: workspacePath,
      data: { snapshot, attentionLines: formatWorkingCopySafetyLines(snapshot) }
    });
  } finally {
    db.close();
  }
}

export function renderWorkMonitorSuccess(response: CommandSuccess<WorkMonitorCommandData>): string[] {
  const { snapshot, attentionLines } = response.data;
  const lines = [
    "Working-copy safety",
    `Projects scanned: ${snapshot.totals.projects}`,
    `Working copies and unmerged branches: ${snapshot.totals.workingCopies}`,
    `UNSAVED: ${snapshot.totals.unsaved}`,
    `LOCAL ONLY: ${snapshot.totals.localOnly}`,
    `PUSHED: ${snapshot.totals.pushedWithoutPr}${snapshot.totals.pullRequestUnknown ? ` (${snapshot.totals.pullRequestUnknown} with PR state unknown)` : ""}`
  ];
  if (attentionLines.length === 0) {
    lines.push("No working-copy preservation exceptions found.");
  } else {
    lines.push("Requires attention:");
    lines.push(...attentionLines.map((line) => `- ${line}`));
  }
  const protectedWork = snapshot.repositories
    .flatMap((repository) => repository.workingCopies)
    .filter((copy) => copy.preservation === "in_pr" && copy.delivery !== "blocked")
    .slice(0, 8);
  if (protectedWork.length > 0) {
    lines.push("Protected active work:");
    lines.push(...protectedWork.map((copy) => {
      const identity = copy.branch ?? "detached HEAD";
      const areas = copy.changes.areas.length > 0 ? ` (${copy.changes.areas.join(", ")})` : "";
      return `- ${copy.projectName} / ${identity}: ${copy.summary}${areas}`;
    }));
  }
  return lines;
}
