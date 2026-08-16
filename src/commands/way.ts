import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { reportWayDrift, type WayDriftReport } from "../projects/wayDrift.js";

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
