import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import {
  fetchProject,
  refreshProject,
  restartProject,
  serviceStatus,
  type FetchResult,
  type RefreshResult,
  type RestartOnlyResult
} from "./refresh.js";
import { freshnessSummary, loadQaTargetsFile, repoFreshness, serviceScriptPath } from "./targets.js";
import { verdictForProject, type ProjectVerdictResult } from "./verdict.js";

export interface QaRefreshCommandData {
  result: RefreshResult;
}

export interface QaFetchCommandData {
  result: FetchResult;
}

export interface QaRestartCommandData {
  result: RestartOnlyResult;
}

export interface QaVerdictCommandData {
  verdict: ProjectVerdictResult;
}

/**
 * One project's checkout and services, as facts rather than as a sentence.
 *
 * `freshness` is the human summary and stays. The discrete fields beside it
 * exist so a UI can drive its own state machine without parsing English back
 * out of a string that was written for a person to read.
 */
export interface QaStatusRow {
  project: string;
  freshness: string;
  baseBranch: string;
  /** The branch HEAD is on, so the counts here are never read out of context. */
  branch: string | null;
  onBaseBranch: boolean;
  head: string | null;
  behind: number | null;
  ahead: number | null;
  dirty: boolean;
  fetchedAt: string | null;
  error: string | null;
  controllable: boolean;
  verdict: ProjectVerdictResult | null;
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

/** Fetches origin's refs for one project. Writes refs, never the working tree. */
export function runQaFetchCommand(options: {
  workspace: string;
  project: string;
}): CommandSuccess<QaFetchCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({
    command: "qa.fetch",
    workspace: workspacePath,
    data: { result: fetchProject(options.project, { workspacePath }) }
  });
}

/** Restarts one project's services. Touches git not at all. */
export function runQaRestartCommand(options: {
  workspace: string;
  project: string;
}): CommandSuccess<QaRestartCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({
    command: "qa.restart",
    workspace: workspacePath,
    data: { result: restartProject(options.project, { workspacePath }) }
  });
}

/** Read-only: whether the commits waiting at origin need a restart. */
export function runQaVerdictCommand(options: {
  workspace: string;
  project: string;
}): CommandSuccess<QaVerdictCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const file = loadQaTargetsFile(workspacePath);
  const project = file.projects[options.project];
  if (!project) {
    throw validationError("Project was not found in the QA target configuration.", { project: options.project });
  }
  return createSuccess({
    command: "qa.verdict",
    workspace: workspacePath,
    data: { verdict: verdictForProject(options.project, project) }
  });
}

/** Read-only: what every configured project's checkout and services look like. */
export function runQaStatusCommand(options: { workspace: string }): CommandSuccess<QaStatusCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const file = loadQaTargetsFile(workspacePath);

  const projects = Object.entries(file.projects).map(([slug, project]): QaStatusRow => {
    const script = serviceScriptPath(project);
    const status = script ? serviceStatus(slug, workspacePath) : null;
    const freshness = repoFreshness(project);
    return {
      project: slug,
      freshness: freshnessSummary(freshness),
      baseBranch: freshness.baseBranch,
      branch: freshness.branch,
      onBaseBranch: freshness.onBaseBranch,
      head: freshness.head,
      behind: freshness.behind,
      ahead: freshness.ahead,
      dirty: freshness.dirty,
      fetchedAt: freshness.fetchedAt,
      error: freshness.error,
      controllable: script !== null,
      verdict: (freshness.behind ?? 0) > 0 ? verdictForProject(slug, project) : null,
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

export function renderQaFetchSuccess(response: CommandSuccess<QaFetchCommandData>): string[] {
  const { result } = response.data;
  const lines = [`${result.project}: ${result.message}`];
  if (result.refused) lines.push(`Refused: ${result.refused}`);
  if (result.verdict) lines.push(...verdictLines(result.verdict));
  return lines;
}

export function renderQaRestartSuccess(response: CommandSuccess<QaRestartCommandData>): string[] {
  const { result } = response.data;
  const lines = [`${result.project}: ${result.message}`];
  if (result.output?.trim()) {
    lines.push("");
    lines.push(...result.output.trim().split("\n").map((line) => `  ${line}`));
  }
  return lines;
}

export function renderQaVerdictSuccess(response: CommandSuccess<QaVerdictCommandData>): string[] {
  const { verdict } = response.data;
  return [`${verdict.project} (${verdict.range}): ${verdict.headline}`, ...verdictLines(verdict)];
}

/** The evidence, always. A verdict without its files is a rumour. */
function verdictLines(verdict: ProjectVerdictResult): string[] {
  const lines: string[] = [];
  for (const reason of verdict.reasons) {
    lines.push(`  ${reason.verdict} — ${reason.label}`);
    lines.push(...reason.paths.map((filePath) => `    ${filePath}`));
  }
  if (verdict.apps.length > 0) lines.push(`  apps touched: ${verdict.apps.join(", ")}`);
  return lines;
}

export function renderQaStatusSuccess(response: CommandSuccess<QaStatusCommandData>): string[] {
  const lines: string[] = [];
  for (const row of response.data.projects) {
    lines.push(`${row.project} — ${row.freshness}`);
    if (row.verdict) lines.push(`  ${row.verdict.headline}`);
    if (!row.controllable) {
      lines.push("  no scripts/services.sh — services cannot be restarted from here");
    } else if (row.services) {
      lines.push(...row.services.split("\n").map((line) => `  ${line}`));
    }
    lines.push("");
  }
  return lines;
}
