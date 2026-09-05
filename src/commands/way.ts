import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { reportWayDrift, type WayDriftReport } from "../projects/wayDrift.js";
import { runWayPropagation, type WayPropagationSummary } from "../projects/wayPropagate.js";

export interface WayStatusCommandData {
  projects: WayDriftReport[];
  totals: {
    projects: number;
    current: number;
    stale: number;
    unknown: number;
  };
}

export function runWayStatusCommand(options: { workspace: string }): CommandSuccess<WayStatusCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const projects = withDatabase(workspacePath, (db) => reportWayDrift(db));

  const totals = {
    projects: projects.length,
    current: projects.filter((project) => project.status === "current").length,
    stale: projects.filter((project) => project.status === "stale").length,
    unknown: projects.filter((project) => project.status === "unknown").length
  };

  return createSuccess({
    command: "way",
    workspace: workspacePath,
    data: { projects, totals }
  });
}

const FILE_LABELS: Record<keyof WayDriftReport["files"], string> = {
  constitution: "CONSTITUTION.md",
  agentsRegion: "AGENTS.md region",
  continuationProtocol: "docs/agent-continuation-protocol.md"
};

export function renderWayStatusSuccess(response: CommandSuccess<WayStatusCommandData>): string[] {
  const { projects, totals } = response.data;

  if (projects.length === 0) {
    return ["No projects yet."];
  }

  const lines: string[] = [
    `Arcadia Way — ${totals.projects} project${totals.projects === 1 ? "" : "s"}` +
      ` (${totals.current} current, ${totals.stale} stale, ${totals.unknown} unknown)`,
    ""
  ];

  for (const project of projects) {
    lines.push(`${project.projectName}  [${project.status}]`);

    if (!project.repoPath) {
      lines.push("  Repository path is not configured.");
      continue;
    }
    if (project.status === "unknown") {
      lines.push(`  Repository path unreachable: ${project.repoPath}`);
      continue;
    }

    lines.push(`  Repo: ${project.repoPath}`);
    if (project.status === "stale") {
      const drifted = (Object.keys(project.files) as Array<keyof WayDriftReport["files"]>)
        .filter((key) => project.files[key] !== "match")
        .map((key) => `${FILE_LABELS[key]} (${project.files[key]})`);
      lines.push(`  Drifted: ${drifted.join(", ")}`);
    }
    lines.push(`  Upgrade policy: ${project.upgradePolicy ?? "none declared"}`);
  }

  return lines;
}

export interface WayPropagateCommandData {
  summary: WayPropagationSummary;
}

export function runWayPropagateCommand(options: {
  workspace: string;
  project?: string;
  dryRun?: boolean;
}): CommandSuccess<WayPropagateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const summary = withDatabase(workspacePath, (db) =>
    runWayPropagation({ db, projectIdentifier: options.project, dryRun: options.dryRun })
  );

  return createSuccess({
    command: "way.propagate",
    workspace: workspacePath,
    data: { summary }
  });
}

export function renderWayPropagateSuccess(response: CommandSuccess<WayPropagateCommandData>): string[] {
  const { summary } = response.data;
  const lines: string[] = [
    `Arcadia Way propagation${summary.dryRun ? " (dry run)" : ""} — ${summary.results.length} project${summary.results.length === 1 ? "" : "s"}`,
    ""
  ];

  for (const result of summary.results) {
    lines.push(`${result.projectName}  [${result.status}]`);
    lines.push(`  ${result.detail}`);
    if (result.pullRequestUrl) lines.push(`  Pull request: ${result.pullRequestUrl}`);
    if (result.filesChanged.length > 0) lines.push(`  Files: ${result.filesChanged.join(", ")}`);
    if (result.unmanageable.length > 0) lines.push(`  Unmanageable: ${result.unmanageable.join(", ")}`);
  }

  return lines;
}
