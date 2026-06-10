import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ARTIFACT_STATUSES, QUEUE_LABELS, WORK_CLASSIFICATION_LABELS } from "../domain/constants.js";
import type { ArtifactStatus, QueueName } from "../domain/constants.js";
import type {
  ArtifactSummary,
  ArtifactGroups,
  MissionLogSummary,
  ProjectSummary,
  QueueGroups,
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
  lines.push("## Projects Without Open Next Action");
  lines.push("");
  lines.push(renderProjectsWithoutNextAction(data.projects));
  lines.push("");
  lines.push("## Work By Queue");
  lines.push("");
  lines.push(renderQueueGroups(data.queues));
  lines.push("");
  lines.push("## Work By Classification");
  lines.push("");
  lines.push("### Needs Mark");
  lines.push("");
  lines.push(renderWorkItems(data.needsMarkItems));
  lines.push("");
  lines.push("### Autonomous Work");
  lines.push("");
  lines.push(renderWorkItems(data.autonomousItems));
  lines.push("");
  lines.push("### Codex Work");
  lines.push("");
  lines.push(renderWorkItems(data.codexItems));
  lines.push("");
  lines.push("## Blocked Work");
  lines.push("");
  lines.push(renderBlockedWorkItems(data.blockedItems));
  lines.push("");
  lines.push("## Recently Completed Work");
  lines.push("");
  lines.push(renderWorkItems(data.recentlyCompletedWorkItems));
  lines.push("");
  lines.push("## Recent Mission Logs");
  lines.push("");
  lines.push(renderMissionLogs(data.recentMissionLogs));
  lines.push("");
  lines.push("## Artifacts By Status");
  lines.push("");
  lines.push(renderArtifactGroups(data.artifactsByStatus));
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

function renderProjectsWithoutNextAction(projects: ProjectSummary[]): string {
  const withoutActions = projects.filter((project) => !project.next_action);
  if (withoutActions.length === 0) {
    return "_Every project has an open next action._";
  }

  return withoutActions
    .map((project) => {
      const milestone = project.current_milestone ?? "No active milestone";
      return `- **${project.name}** (${project.status}) - ${milestone}`;
    })
    .join("\n");
}

function renderQueueGroups(queues: QueueGroups): string {
  const orderedQueues: QueueName[] = ["inbox", "work_queue", "needs_mark", "blocked"];
  return orderedQueues
    .map((queue) => [`### ${QUEUE_LABELS[queue]}`, "", renderWorkItems(queues[queue])].join("\n"))
    .join("\n\n");
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

function renderBlockedWorkItems(items: WorkItemSummary[]): string {
  if (items.length === 0) {
    return "_None._";
  }

  return items
    .map((item) => {
      const project = item.project_name ? ` [${item.project_name}]` : "";
      const context = item.raw_input && item.raw_input !== item.title ? ` Context: ${item.raw_input}.` : "";
      return `- **${item.title}**${project} (${WORK_CLASSIFICATION_LABELS[item.work_classification]}, ${item.status}). Next: ${item.next_action}.${context}`;
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
    return "_No artifacts._";
  }

  return artifacts
    .map((artifact) => {
      const project = artifact.project_name ? ` [${artifact.project_name}]` : "";
      const artifactPath = artifact.path ? ` - ${artifact.path}` : "";
      return `- **${artifact.title}**${project} (${artifact.status})${artifactPath}`;
    })
    .join("\n");
}

function renderArtifactGroups(groups: ArtifactGroups): string {
  return ARTIFACT_STATUSES.map((status) => {
    const heading = artifactStatusHeading(status);
    return [`### ${heading}`, "", renderArtifacts(groups[status])].join("\n");
  }).join("\n\n");
}

function artifactStatusHeading(status: ArtifactStatus): string {
  return status
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
