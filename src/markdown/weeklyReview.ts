import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WORK_CLASSIFICATION_LABELS } from "../domain/constants.js";
import type {
  ArtifactSummary,
  MissionLogSummary,
  ProjectSummary,
  SuggestedNextAction,
  WeeklyReviewData,
  WorkItemSummary
} from "../domain/types.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export function getWeeklyReviewReportPath(workspace: string, until: string): string {
  const paths = getWorkspacePaths(workspace);
  return path.join(paths.reports, "weekly", `${until}.md`);
}

export function writeWeeklyReviewReport(workspace: string, data: WeeklyReviewData): string {
  const reportPath = getWeeklyReviewReportPath(workspace, data.window.until);
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, renderWeeklyReviewReport(data), "utf8");
  return reportPath;
}

export function renderWeeklyReviewReport(data: WeeklyReviewData): string {
  const lines: string[] = [
    "# Arcadia Weekly Review",
    "",
    `Generated: ${data.generatedAt}`,
    `Workspace: ${data.workspacePath}`,
    `Review window: ${data.window.since} to ${data.window.until}`,
    "",
    "## Completed Actions",
    "",
    renderWorkItems(data.completedWorkItems),
    "",
    "## Mission Logs Created",
    "",
    renderMissionLogs(data.missionLogs),
    "",
    "## Blocked Actions",
    "",
    renderWorkItems(data.blockedItems, { includeRawInput: true }),
    "",
    "## Requires Review Decisions",
    "",
    renderWorkItems(data.requiresReviewItems),
    "",
    "## Active Codex/Autonomous Actions",
    "",
    "### Codex",
    "",
    renderWorkItems(data.codexItems),
    "",
    "### Autonomous",
    "",
    renderWorkItems(data.autonomousItems),
    "",
    "## Artifact Changes Or Upcoming Artifacts",
    "",
    renderArtifacts(data.artifactItems),
    "",
    "## Projects Without Open Next Actions",
    "",
    renderProjects(data.projectsWithoutOpenNextActions),
    "",
    "## Suggested Next Actions",
    "",
    renderSuggestedNextActions(data.suggestedNextActions)
  ];

  return `${lines.join("\n")}\n`;
}

function renderWorkItems(items: WorkItemSummary[], options: { includeRawInput?: boolean } = {}): string {
  if (items.length === 0) {
    return "_None._";
  }

  return items
    .map((item) => {
      const project = item.project_name ? ` [${item.project_name}]` : "";
      const classification = WORK_CLASSIFICATION_LABELS[item.work_classification];
      const context = options.includeRawInput && item.raw_input && item.raw_input !== item.title
        ? ` Context: ${item.raw_input}.`
        : "";
      return `- **${item.title}**${project} (${classification}, ${item.status}). Next: ${item.next_action}.${context}`;
    })
    .join("\n");
}

function renderMissionLogs(logs: MissionLogSummary[]): string {
  if (logs.length === 0) {
    return "_None._";
  }

  return logs
    .map((log) => {
      const project = log.project_name ? ` [${log.project_name}]` : "";
      const blockers = log.blockers ? ` Blockers: ${log.blockers}.` : "";
      const artifactImpact = log.artifact_impact ? ` Artifact impact: ${log.artifact_impact}.` : "";
      return `- **${log.created_at}**${project}: ${log.result}. Next: ${log.next_action}.${blockers}${artifactImpact} (${log.markdown_path})`;
    })
    .join("\n");
}

function renderArtifacts(artifacts: ArtifactSummary[]): string {
  if (artifacts.length === 0) {
    return "_None._";
  }

  return artifacts
    .map((artifact) => {
      const project = artifact.project_name ? ` [${artifact.project_name}]` : "";
      const artifactPath = artifact.path ? ` Path: ${artifact.path}.` : "";
      return `- **${artifact.title}**${project} (${artifact.status}, ${artifact.artifact_type}).${artifactPath}`;
    })
    .join("\n");
}

function renderProjects(projects: ProjectSummary[]): string {
  if (projects.length === 0) {
    return "_None._";
  }

  return projects
    .map((project) => {
      const milestone = project.current_milestone ?? "No active milestone";
      return `- **${project.name}** (${project.status}) - ${milestone}`;
    })
    .join("\n");
}

function renderSuggestedNextActions(actions: SuggestedNextAction[]): string {
  if (actions.length === 0) {
    return "_None._";
  }

  return actions
    .map((action) => `- **${action.title}** (${action.sourceType}:${action.sourceId}) - ${action.nextAction}`)
    .join("\n");
}
