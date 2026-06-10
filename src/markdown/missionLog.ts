import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Milestone, MissionLog, Project } from "../domain/types.js";
import { slugify } from "../utils/slug.js";
import { localDateParts, localDateStamp } from "../utils/time.js";
import { getWorkspacePaths, toWorkspaceRelativePath } from "../workspace/paths.js";

export interface MissionLogMarkdownInput {
  missionLog: MissionLog;
  project: Project | null;
  milestone: Milestone | null;
}

export function buildMissionLogRelativePath(workspace: string, projectName: string, logId: string, date = new Date()): string {
  const paths = getWorkspacePaths(workspace);
  const { year, month } = localDateParts(date);
  const dateStamp = localDateStamp(date);
  const directory = path.join(paths.missionLogs, year, month);
  const baseName = `${dateStamp}-${slugify(projectName)}.md`;
  const basePath = path.join(directory, baseName);

  if (!existsSync(basePath)) {
    return toWorkspaceRelativePath(workspace, basePath);
  }

  const suffix = logId.replace(/^log_/, "").slice(0, 8);
  return toWorkspaceRelativePath(workspace, path.join(directory, `${dateStamp}-${slugify(projectName)}-${suffix}.md`));
}

export function renderMissionLogMarkdown(input: MissionLogMarkdownInput): string {
  const { missionLog, project, milestone } = input;
  const lines = [
    `# Mission Log: ${project?.name ?? "Unassigned"}`,
    "",
    `Date: ${missionLog.created_at}`,
    `Project: ${project?.name ?? "Unassigned"}`,
    `Milestone: ${milestone?.title ?? "None"}`,
    "",
    "## Work Performed",
    "",
    missionLog.work_performed,
    "",
    "## Result",
    "",
    missionLog.result,
    "",
    "## Blockers",
    "",
    missionLog.blockers ?? "None",
    "",
    "## Next Action",
    "",
    missionLog.next_action,
    "",
    "## Artifact Impact",
    "",
    missionLog.artifact_impact ?? "None",
    ""
  ];

  return `${lines.join("\n")}\n`;
}

export function writeMissionLogMarkdown(workspace: string, input: MissionLogMarkdownInput): string {
  const paths = getWorkspacePaths(workspace);
  const absolutePath = path.join(paths.root, input.missionLog.markdown_path);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, renderMissionLogMarkdown(input), "utf8");
  return absolutePath;
}
