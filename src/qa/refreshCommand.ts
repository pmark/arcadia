import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { refreshProject, serviceStatus, type RefreshResult } from "./refresh.js";
import { freshnessSummary, loadQaTargetsFile, repoFreshness, serviceScriptPath } from "./targets.js";

export interface QaRefreshCommandData {
  result: RefreshResult;
}

export interface QaStatusRow {
  project: string;
  freshness: string;
  controllable: boolean;
  services: string | null;
}

export interface QaStatusCommandData {
  projects: QaStatusRow[];
}

export function runQaRefreshCommand(options: {
  workspace: string;
  project: string;
  skipRestart?: boolean;
}): CommandSuccess<QaRefreshCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const result = refreshProject(options.project, {
    workspacePath,
    skipRestart: options.skipRestart
  });
  return { ...createSuccess({ command: "qa.refresh", workspace: workspacePath, data: { result } }) };
}

/** Read-only: what every configured project's checkout and services look like. */
export function runQaStatusCommand(options: { workspace: string }): CommandSuccess<QaStatusCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const file = loadQaTargetsFile(workspacePath);

  const projects = Object.entries(file.projects).map(([slug, project]): QaStatusRow => {
    const script = serviceScriptPath(project);
    const status = script ? serviceStatus(slug, workspacePath) : null;
    return {
      project: slug,
      freshness: freshnessSummary(repoFreshness(project)),
      controllable: script !== null,
      services: status ? status.output.trim() || "(no output)" : null
    };
  });

  return createSuccess({ command: "qa.status", workspace: workspacePath, data: { projects } });
}

export function renderQaRefreshSuccess(response: CommandSuccess<QaRefreshCommandData>): string[] {
  const { result } = response.data;
  const lines = [`${result.project}: ${result.message}`];
  if (result.refused) lines.push(`Refused: ${result.refused}`);
  if (result.output?.trim()) {
    lines.push("");
    lines.push(...result.output.trim().split("\n").map((line) => `  ${line}`));
  }
  return lines;
}

export function renderQaStatusSuccess(response: CommandSuccess<QaStatusCommandData>): string[] {
  const lines: string[] = [];
  for (const row of response.data.projects) {
    lines.push(`${row.project} — ${row.freshness}`);
    if (!row.controllable) {
      lines.push("  no scripts/services.sh — services cannot be restarted from here");
    } else if (row.services) {
      lines.push(...row.services.split("\n").map((line) => `  ${line}`));
    }
    lines.push("");
  }
  return lines;
}
