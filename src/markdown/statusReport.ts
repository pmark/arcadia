import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUEUE_LABELS, WORK_CLASSIFICATION_LABELS } from "../domain/constants.js";
import type {
  ArtifactSummary,
  MissionLogSummary,
  ProjectSummary,
  StatusReportData,
  WorkItemSummary
} from "../domain/types.js";
import { getWorkspacePaths } from "../workspace/paths.js";

export function renderStatusReport(data: StatusReportData): string {
  const lines: string[] = [
    "# Arcadia Status",
    "",
    `Generated: ${data.generatedAt}`,
    `Workspace: ${data.workspacePath}`,
    "",
    "## Projects",
    ""
  ];

  lines.push(renderProjectList(data.projects));
  lines.push("");
  lines.push("## Current Milestones");
  lines.push("");
  lines.push(renderMilestones(data.projects));
  lines.push("");
  lines.push("## Next Actions");
  lines.push("");
  lines.push(renderNextActions(data.projects));
  lines.push("");
  lines.push("## Needs Mark");
  lines.push("");
  lines.push(renderWorkItems(data.needsMarkItems));
  lines.push("");
  lines.push("## Autonomous Work");
  lines.push("");
  lines.push(renderWorkItems(data.autonomousItems));
  lines.push("");
  lines.push("## Codex Work");
  lines.push("");
  lines.push(renderWorkItems(data.codexItems));
  lines.push("");
  lines.push("## Blocked Work");
  lines.push("");
  lines.push(renderWorkItems(data.blockedItems));
  lines.push("");
  lines.push("## Recent Mission Logs");
  lines.push("");
  lines.push(renderMissionLogs(data.recentMissionLogs));
  lines.push("");
  lines.push("## Upcoming Artifacts");
  lines.push("");
  lines.push(renderArtifacts(data.upcomingArtifacts));
  lines.push("");
  lines.push("## Queue Counts");
  lines.push("");

  for (const [queue, items] of Object.entries(data.queues)) {
    lines.push(`- ${QUEUE_LABELS[queue as keyof typeof QUEUE_LABELS]}: ${items.length}`);
  }

  return `${lines.join("\n")}\n`;
}

export function writeStatusReport(workspace: string, data: StatusReportData): string {
  const paths = getWorkspacePaths(workspace);
  mkdirSync(path.dirname(paths.statusReport), { recursive: true });
  const markdown = renderStatusReport(data);
  writeFileSync(paths.statusReport, markdown, "utf8");
  return paths.statusReport;
}

function renderProjectList(projects: ProjectSummary[]): string {
  if (projects.length === 0) {
    return "_No projects yet._";
  }

  return projects
    .map((project) => {
      const milestone = project.current_milestone ?? "No active milestone";
      const nextAction = project.next_action ?? "No next action recorded";
      const classification = project.work_classification
        ? WORK_CLASSIFICATION_LABELS[project.work_classification]
        : "Unclassified";
      return `- **${project.name}** (${project.status}) - ${milestone}; next: ${nextAction}; work: ${classification}`;
    })
    .join("\n");
}

function renderMilestones(projects: ProjectSummary[]): string {
  const withMilestones = projects.filter((project) => project.current_milestone);
  if (withMilestones.length === 0) {
    return "_No active milestones._";
  }

  return withMilestones.map((project) => `- **${project.name}**: ${project.current_milestone}`).join("\n");
}

function renderNextActions(projects: ProjectSummary[]): string {
  const withActions = projects.filter((project) => project.next_action);
  if (withActions.length === 0) {
    return "_No next actions recorded._";
  }

  return withActions.map((project) => `- **${project.name}**: ${project.next_action}`).join("\n");
}

function renderWorkItems(items: WorkItemSummary[]): string {
  if (items.length === 0) {
    return "_None._";
  }

  return items
    .map((item) => {
      const project = item.project_name ? ` [${item.project_name}]` : "";
      const nextAction = item.next_action ? ` Next: ${item.next_action}.` : "";
      return `- **${item.title}**${project} (${WORK_CLASSIFICATION_LABELS[item.work_classification]}, ${item.status}).${nextAction}`;
    })
    .join("\n");
}

function renderMissionLogs(logs: MissionLogSummary[]): string {
  if (logs.length === 0) {
    return "_No mission logs yet._";
  }

  return logs
    .map((log) => {
      const project = log.project_name ? ` [${log.project_name}]` : "";
      return `- **${log.created_at}**${project}: ${log.result} (${log.markdown_path})`;
    })
    .join("\n");
}

function renderArtifacts(artifacts: ArtifactSummary[]): string {
  if (artifacts.length === 0) {
    return "_No upcoming artifacts._";
  }

  return artifacts
    .map((artifact) => {
      const project = artifact.project_name ? ` [${artifact.project_name}]` : "";
      return `- **${artifact.title}**${project} (${artifact.status})`;
    })
    .join("\n");
}
