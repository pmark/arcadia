import type Database from "better-sqlite3";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import { listMonitoredProjects } from "./workMonitor.js";
import {
  listOutstandingPullRequests,
  type OutstandingPullRequestsSnapshot
} from "../workMonitoring/pullRequests.js";

export interface WorkPullRequestsCommandData {
  snapshot: OutstandingPullRequestsSnapshot;
}

export function runWorkPullRequestsCommand(options: {
  workspace: string;
}): CommandSuccess<WorkPullRequestsCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const snapshot = listOutstandingPullRequests(listMonitoredProjects(db, { includeInactive: true }));
    return createSuccess({
      command: "work.pull-requests",
      workspace: workspacePath,
      data: { snapshot }
    });
  } finally {
    db.close();
  }
}

export function renderWorkPullRequestsSuccess(response: CommandSuccess<WorkPullRequestsCommandData>): string[] {
  const { snapshot } = response.data;
  const lines = [
    "Outstanding pull requests",
    `Projects scanned: ${snapshot.projectsScanned}`,
    `Open PRs: ${snapshot.counts.total}`,
    `MERGE-READY: ${snapshot.counts.mergeReady}`,
    `READY FOR REVIEW: ${snapshot.counts.ready}`,
    `DRAFT: ${snapshot.counts.drafts}`,
    `BLOCKED / CHECKS: ${snapshot.counts.blocked + snapshot.counts.checksFailing + snapshot.counts.checksPending}`
  ];
  if (snapshot.errors.length > 0) {
    lines.push("Project exceptions:");
    lines.push(...snapshot.errors.map((error) => `- ${error.projectName}: ${error.message}`));
  }
  if (snapshot.pullRequests.length === 0) {
    lines.push("No open pull requests found.");
  } else {
    lines.push("Pull requests:");
    lines.push(...snapshot.pullRequests.map((pullRequest) =>
      `- ${pullRequest.projectName} / #${pullRequest.number} ${pullRequest.title} — ${pullRequest.readinessLabel}; ${pullRequest.headBranch} → ${pullRequest.baseBranch} (${pullRequest.url})`
    ));
  }
  return lines;
}
