import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { existingDirectory } from "../git/worktrees.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { assessPrBlastRadius, type AssessPrBlastRadiusResult } from "../stewardship/prBlastRadius.js";

export interface AssessPrBlastRadiusOptions {
  workspace: string;
  repo: string;
  project: string;
  plan: string;
  action: string;
  base: string;
  candidate: string;
  pullRequestUrl?: string;
}

export function runAssessPrBlastRadiusCommand(options: AssessPrBlastRadiusOptions): CommandSuccess<AssessPrBlastRadiusResult> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repoRoot = existingDirectory(options.repo, "repository");
  const result = withDatabase(workspacePath, (db) => assessPrBlastRadius({
    db,
    projectSlug: options.project,
    planSlug: options.plan,
    actionId: options.action,
    repoRoot,
    baseRevision: options.base,
    candidateRevision: options.candidate,
    pullRequestUrl: options.pullRequestUrl ?? null
  }));
  return createSuccess({ command: "pr.assessBlastRadius", workspace: workspacePath, data: result });
}

export function renderAssessPrBlastRadiusSuccess(response: CommandSuccess<AssessPrBlastRadiusResult>): string[] {
  const data = response.data;
  const lines = [
    `Outcome: ${data.outcome}${data.created ? "" : " (already assessed)"}`,
    `Touched paths: ${data.assessment.touchedPaths.length}`,
    ...(data.assessment.matchedSafetyPaths.length
      ? [`Matched safety paths: ${data.assessment.matchedSafetyPaths.join(", ")}`]
      : []),
    `Lines changed: ${data.assessment.linesChanged}`,
    `Review item: ${data.reviewItemId}`
  ];
  if (data.outcome === "escalated") {
    lines.push(`Escalated: Decision opened (request ${data.decisionRequestId}). Do not merge until it is answered.`);
    lines.push(...data.assessment.reasons.map((reason) => `  - ${reason}`));
  } else {
    lines.push("Proceed: no escalation condition matched.");
  }
  return lines;
}
