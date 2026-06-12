import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { projectNotFound, validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createMissionLog,
  createProjectWithInitialWork,
  getProjectMetadata,
  listProjects,
  listProjectSummaries,
  updateProject,
  upsertProjectMetadata
} from "../db/repositories.js";
import { WORK_CLASSIFICATION_LABELS, type ProjectStatus, type WorkClassification } from "../domain/constants.js";
import type { CreatedProjectBundle, MissionLog, Project, ProjectMetadata, ProjectSummary } from "../domain/types.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";
import { promptForProjectCreate } from "../prompts/index.js";
import { slugify } from "../utils/slug.js";
import { getWorkspacePaths, resolveWorkspacePath, toWorkspaceRelativePath } from "../workspace/paths.js";

const DEFAULT_PROJECT_MISSION = "Mission needs definition.";
const DEFAULT_PROJECT_MILESTONE = "Define the project direction.";
const DEFAULT_PROJECT_NEXT_ACTION = "Clarify the project mission and first concrete next action.";

export interface ProjectCreateCommandData {
  project: CreatedProjectBundle["project"];
  milestone: CreatedProjectBundle["milestone"];
  workItem: CreatedProjectBundle["workItem"];
  missionLog: MissionLog;
  metadata: ProjectMetadata | null;
  projectPath: string;
  templateUsed: string | null;
}

export async function runProjectCreateCommand(options: {
  workspace: string;
  name?: string;
  path?: string;
}): Promise<CommandSuccess<ProjectCreateCommandData>> {
  const workspacePath = resolveWorkspacePath(options.workspace);
  if (options.name) {
    return createProjectWithDefaults({
      workspace: workspacePath,
      name: options.name,
      path: options.path
    });
  }

  const input = await promptForProjectCreate();
  const result = withDatabase(workspacePath, (db) => createProjectWithInitialWork(db, input));

  return createSuccess({
    command: "project.create",
    workspace: workspacePath,
    data: {
      ...result,
      missionLog: createInitialProjectMissionLog(workspacePath, result.project, result.milestone),
      metadata: null,
      projectPath: "",
      templateUsed: null
    }
  });
}

export interface ProjectListCommandData {
  projects: ProjectSummary[];
}

export interface ProjectShowCommandData {
  project: ProjectSummary;
}

export interface ProjectImportCommandData {
  project: CreatedProjectBundle["project"];
  milestone: CreatedProjectBundle["milestone"];
  workItem: CreatedProjectBundle["workItem"];
}

export interface ProjectUpdateCommandData {
  project: Project;
  updated: string[];
}

export interface ProjectMetadataCommandData {
  metadata: ProjectMetadata;
}

export function createProjectWithDefaults(options: {
  workspace: string;
  name: string;
  path?: string;
}): CommandSuccess<ProjectCreateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const name = options.name.trim();
  if (!name) {
    throw validationError("Project name is required.");
  }

  const slug = slugify(name);
  const projectPath = resolveProjectFilesystemPath(workspacePath, slug, options.path);
  const created = withDatabase(workspacePath, (db) => {
    const existing = listProjects(db).find((project) => project.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      throw validationError("Project already exists.", { projectId: existing.id, name: existing.name });
    }

    const bundle = createProjectWithInitialWork(db, {
      name,
      mission: DEFAULT_PROJECT_MISSION,
      status: "incubating",
      currentMilestone: DEFAULT_PROJECT_MILESTONE,
      nextAction: DEFAULT_PROJECT_NEXT_ACTION,
      workClassification: "autonomous"
    });

    const metadata = upsertProjectMetadata(db, {
      projectId: bundle.project.id,
      aliases: [bundle.project.slug],
      repoPath: projectPath,
      statusSummary: "Project created with built-in defaults.",
      validationCommands: []
    });

    return { ...bundle, metadata };
  });

  const templateUsed = materializeProjectFiles({
    workspacePath,
    projectPath,
    project: created.project,
    nextAction: created.workItem.next_action
  });
  const missionLog = createInitialProjectMissionLog(workspacePath, created.project, created.milestone);

  return createSuccess({
    command: "project.create",
    workspace: workspacePath,
    data: {
      project: created.project,
      milestone: created.milestone,
      workItem: created.workItem,
      missionLog,
      metadata: created.metadata,
      projectPath,
      templateUsed
    },
    artifacts: [
      projectPath,
      path.join(workspacePath, missionLog.markdown_path)
    ]
  });
}

export function runProjectListCommand(options: { workspace: string }): CommandSuccess<ProjectListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const projects = withDatabase(workspacePath, listProjectSummaries);

  return createSuccess({
    command: "project.list",
    workspace: workspacePath,
    data: { projects }
  });
}

export function runProjectShowCommand(options: {
  workspace: string;
  projectId: string;
}): CommandSuccess<ProjectShowCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const project = withDatabase(workspacePath, (db) =>
    listProjectSummaries(db).find((candidate) => candidate.id === options.projectId) ?? null
  );

  if (!project) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "project.show",
    workspace: workspacePath,
    data: { project }
  });
}

export function runProjectImportCommand(options: {
  workspace: string;
  name: string;
  mission: string;
  status: string;
  goal?: string;
  milestone: string;
  nextAction: string;
  classification: string;
  expectedArtifact?: string;
}): CommandSuccess<ProjectImportCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const created = withDatabase(workspacePath, (db) => {
    const existing = listProjects(db).find((project) => project.name.toLowerCase() === options.name.trim().toLowerCase());
    if (existing) {
      throw validationError("Project already exists.", { projectId: existing.id, name: existing.name });
    }

    return createProjectWithInitialWork(db, {
      name: options.name,
      mission: options.mission,
      goal: options.goal,
      status: options.status as ProjectStatus,
      currentMilestone: options.milestone,
      nextAction: options.nextAction,
      expectedArtifact: options.expectedArtifact,
      workClassification: options.classification as WorkClassification
    });
  });

  return createSuccess({
    command: "project.import",
    workspace: workspacePath,
    data: {
      project: created.project,
      milestone: created.milestone,
      workItem: created.workItem
    }
  });
}

export function runProjectUpdateCommand(options: {
  workspace: string;
  projectId: string;
  status?: string;
  mission?: string;
  goal?: string;
}): CommandSuccess<ProjectUpdateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const updated: string[] = [];
  if (options.status !== undefined) {
    updated.push("status");
  }
  if (options.mission !== undefined) {
    updated.push("mission");
  }
  if (options.goal !== undefined) {
    updated.push("goal");
  }
  if (updated.length === 0) {
    throw validationError("At least one project field is required.", { fields: ["status", "mission", "goal"] });
  }
  const project = withDatabase(workspacePath, (db) =>
    updateProject(db, options.projectId, {
      status: options.status as ProjectStatus | undefined,
      mission: options.mission,
      goal: options.goal
    })
  );

  if (!project) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "project.update",
    workspace: workspacePath,
    data: { project, updated }
  });
}

export function runProjectMetadataCommand(options: {
  workspace: string;
  projectId: string;
  aliases?: string[];
  repoPath?: string;
  statusSummary?: string;
  validationCommands?: string[];
}): CommandSuccess<ProjectMetadataCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const metadata = withDatabase(workspacePath, (db) => {
    const existing = getProjectMetadata(db, options.projectId);
    const updated = upsertProjectMetadata(db, {
      projectId: options.projectId,
      aliases: options.aliases ?? decodeStringArray(existing?.aliases),
      repoPath: options.repoPath ?? existing?.repo_path ?? null,
      statusSummary: options.statusSummary ?? existing?.status_summary ?? null,
      validationCommands: options.validationCommands ?? decodeStringArray(existing?.validation_commands)
    });

    return updated;
  });

  if (!metadata) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "project.metadata",
    workspace: workspacePath,
    data: { metadata }
  });
}

export function renderProjectListSuccess(response: CommandSuccess<ProjectListCommandData>): string[] {
  if (response.data.projects.length === 0) {
    return ["No projects yet."];
  }

  const lines: string[] = [];
  for (const project of response.data.projects) {
    const classification = project.work_classification
      ? WORK_CLASSIFICATION_LABELS[project.work_classification]
      : "Unclassified";
    lines.push(`${project.name} (${project.status})`);
    lines.push(`  Mission: ${project.mission}`);
    lines.push(`  Goal: ${project.goal ?? "None"}`);
    lines.push(`  Milestone: ${project.current_milestone ?? "None"}`);
    lines.push(`  Next action: ${project.next_action ?? "None"}`);
    lines.push(`  Work classification: ${classification}`);
  }

  return lines;
}

export function renderProjectShowSuccess(response: CommandSuccess<ProjectShowCommandData>): string[] {
  const project = response.data.project;
  const classification = project.work_classification
    ? WORK_CLASSIFICATION_LABELS[project.work_classification]
    : "Unclassified";

  return [
    `Project: ${project.name}`,
    `ID: ${project.id}`,
    `Status: ${project.status}`,
    `Mission: ${project.mission}`,
    `Goal: ${project.goal ?? "None"}`,
    `Current milestone: ${project.current_milestone ?? "None"}`,
    `Next action: ${project.next_action ?? "None"}`,
    `Work classification: ${classification}`,
    `Expected artifact: ${project.expected_artifact ?? "None"}`
  ];
}

export function renderProjectImportSuccess(response: CommandSuccess<ProjectImportCommandData>): string[] {
  return [
    `Created project: ${response.data.project.name}`,
    `Project: ${response.data.project.id}`,
    `Goal: ${response.data.project.goal ?? "None"}`,
    `Milestone: ${response.data.milestone.title}`,
    `Work item: ${response.data.workItem.id}`
  ];
}

export function renderProjectCreateSuccess(response: CommandSuccess<ProjectCreateCommandData>): string[] {
  return [
    `Created project: ${response.data.project.name}`,
    `Project: ${response.data.project.id}`,
    `Slug: ${response.data.project.slug}`,
    `Status: ${response.data.project.status}`,
    `Path: ${response.data.projectPath || "None"}`,
    `Template: ${response.data.templateUsed ?? "Built-in defaults"}`,
    `Mission: ${response.data.project.mission}`,
    `Mission log: ${response.data.missionLog.markdown_path}`,
    `Next action: ${response.data.workItem.next_action}`
  ];
}

export function renderProjectUpdateSuccess(response: CommandSuccess<ProjectUpdateCommandData>): string[] {
  return [
    `Updated project: ${response.data.project.name}`,
    `ID: ${response.data.project.id}`,
    `Mission: ${response.data.project.mission}`,
    `Goal: ${response.data.project.goal ?? "None"}`,
    `Status: ${response.data.project.status}`
  ];
}

export function renderProjectMetadataSuccess(response: CommandSuccess<ProjectMetadataCommandData>): string[] {
  return [
    `Updated project metadata: ${response.data.metadata.project_id}`,
    `Aliases: ${decodeStringArray(response.data.metadata.aliases).join(", ") || "None"}`,
    `Repository: ${response.data.metadata.repo_path ?? "None"}`,
    `Validation: ${decodeStringArray(response.data.metadata.validation_commands).join(", ") || "None"}`
  ];
}

function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : [];
}

function resolveProjectFilesystemPath(workspacePath: string, slug: string, providedPath?: string): string {
  if (providedPath?.trim()) {
    return path.resolve(providedPath);
  }

  return path.join(getWorkspacePaths(workspacePath).projects, slug);
}

function materializeProjectFiles(input: {
  workspacePath: string;
  projectPath: string;
  project: Project;
  nextAction: string;
}): string | null {
  mkdirSync(input.projectPath, { recursive: true });
  const template = findProjectTemplate(input.workspacePath);
  if (template) {
    copyTemplateFiles(template, input.projectPath);
    return toWorkspaceRelativePath(input.workspacePath, template);
  }

  writeFileIfMissing(
    path.join(input.projectPath, "PROJECT.md"),
    [
      `# ${input.project.name}`,
      "",
      `ID: ${input.project.id}`,
      `Slug: ${input.project.slug}`,
      `Status: ${input.project.status}`,
      "",
      "## Mission",
      "",
      input.project.mission,
      "",
      "## Next Action",
      "",
      input.nextAction,
      ""
    ].join("\n")
  );
  writeFileIfMissing(
    path.join(input.projectPath, "MISSION_LOG.md"),
    [
      `# Mission Log: ${input.project.name}`,
      "",
      "- Project created with Arcadia built-in defaults.",
      `- Next action: ${input.nextAction}`,
      ""
    ].join("\n")
  );
  return null;
}

function findProjectTemplate(workspacePath: string): string | null {
  const candidates = [
    path.join(workspacePath, "templates", "project"),
    path.join(workspacePath, "templates", "default-project")
  ];

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory()) ?? null;
}

function copyTemplateFiles(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyTemplateFiles(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile() && !existsSync(destinationPath)) {
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

function writeFileIfMissing(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    return;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function createInitialProjectMissionLog(workspacePath: string, project: Project, milestone: CreatedProjectBundle["milestone"]): MissionLog {
  const missionLog = withDatabase(workspacePath, (db) => {
    const logId = `log_${project.id}_created`;
    return createMissionLog(db, {
      id: logId,
      projectId: project.id,
      milestoneId: milestone.id,
      workPerformed: "Created the project with Arcadia defaults.",
      result: "Project exists in SQLite and has starter project files.",
      nextAction: DEFAULT_PROJECT_NEXT_ACTION,
      artifactImpact: `Created starter project state for ${project.name}.`,
      markdownPath: buildMissionLogRelativePath(workspacePath, project.name, logId)
    });
  });
  writeMissionLogMarkdown(workspacePath, { missionLog, project, milestone });
  return missionLog;
}
