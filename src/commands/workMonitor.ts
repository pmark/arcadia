import type Database from "better-sqlite3";
import type { CommandSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openReadOnlyDatabase } from "../db/connection.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { sharesRepository } from "../git/worktrees.js";
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

/**
 * Keep only the Project that owns `repositoryPath`. A coding agent's protected
 * broker must not show it other Projects' worktrees, paths and changed files:
 * the zero-prompt rehearsal agent read a leaked Arcadia path and tripped its
 * `external_directory` sandbox rule (#470). No owner is an error, not an empty
 * scan, so a mistyped source cannot pass as "nothing to report".
 *
 * Ownership is repository identity, not path equality: a prepared worktree
 * shares its Project's Git common directory even though its path never equals
 * the registered main checkout, so the protected broker's own preflight works
 * from the worktree it was launched in (#478).
 */
export function scopeToRepository(projects: WorkMonitorProject[], repositoryPath: string): WorkMonitorProject[] {
  const owned = projects.filter((project) => project.repositoryPath && sharesRepository(repositoryPath, project.repositoryPath));
  if (owned.length === 0) {
    throw validationError("No active Project owns the repository this work monitor was scoped to.", { repositoryPath });
  }
  return owned;
}

export function runWorkMonitorCommand(options: {
  workspace: string;
  includePullRequests?: boolean;
  /** Restrict the scan to the Project that owns this repository. */
  repositoryPath?: string;
}): CommandSuccess<WorkMonitorCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openReadOnlyDatabase(workspacePath);
  try {
    const monitored = listMonitoredProjects(db);
    const snapshot = scanProjectWorkingCopies(options.repositoryPath ? scopeToRepository(monitored, options.repositoryPath) : monitored, {
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
