import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { projectNotFound, validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createProjectWithInitialWork,
  getProjectMetadata,
  listProjects,
  listProjectSummaries,
  updateProjectStatus,
  upsertProjectMetadata
} from "../db/repositories.js";
import { WORK_CLASSIFICATION_LABELS, type ProjectStatus, type WorkClassification } from "../domain/constants.js";
import type { CreatedProjectBundle, Project, ProjectMetadata, ProjectSummary } from "../domain/types.js";
import { promptForProjectCreate } from "../prompts/index.js";
import { resolveWorkspacePath } from "../workspace/paths.js";

export async function runProjectCreateCommand(options: { workspace: string }): Promise<void> {
  const workspacePath = resolveWorkspacePath(options.workspace);
  const input = await promptForProjectCreate();
  const result = withDatabase(workspacePath, (db) => createProjectWithInitialWork(db, input));

  console.log(`Created project: ${result.project.name}`);
  console.log(`Milestone: ${result.milestone.title}`);
  console.log(`Next action: ${result.workItem.next_action}`);
}

export interface ProjectListCommandData {
  projects: ProjectSummary[];
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

export function runProjectListCommand(options: { workspace: string }): CommandSuccess<ProjectListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const projects = withDatabase(workspacePath, listProjectSummaries);

  return createSuccess({
    command: "project.list",
    workspace: workspacePath,
    data: { projects }
  });
}

export function runProjectImportCommand(options: {
  workspace: string;
  name: string;
  mission: string;
  status: string;
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
  status: string;
}): CommandSuccess<ProjectUpdateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const project = withDatabase(workspacePath, (db) => updateProjectStatus(db, options.projectId, options.status));

  if (!project) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "project.update",
    workspace: workspacePath,
    data: { project, updated: ["status"] }
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
    lines.push(`  Milestone: ${project.current_milestone ?? "None"}`);
    lines.push(`  Next action: ${project.next_action ?? "None"}`);
    lines.push(`  Work classification: ${classification}`);
  }

  return lines;
}

export function renderProjectImportSuccess(response: CommandSuccess<ProjectImportCommandData>): string[] {
  return [
    `Created project: ${response.data.project.name}`,
    `Project: ${response.data.project.id}`,
    `Milestone: ${response.data.milestone.title}`,
    `Work item: ${response.data.workItem.id}`
  ];
}

export function renderProjectUpdateSuccess(response: CommandSuccess<ProjectUpdateCommandData>): string[] {
  return [
    `Updated project: ${response.data.project.name}`,
    `ID: ${response.data.project.id}`,
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
