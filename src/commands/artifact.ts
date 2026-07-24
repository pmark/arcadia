import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { artifactNotFound, projectNotFound, validationError, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { createArtifactRecord, getArtifact, getProject, getWorkItem, listArtifacts, updateArtifact } from "../db/repositories.js";
import type { ArtifactSummary } from "../domain/types.js";
import {
  validatePlanningArtifact,
  type PlanningArtifactValidationResult
} from "../stewardship/artifactValidator.js";

export interface ArtifactListCommandData {
  artifacts: ArtifactSummary[];
}

export interface ArtifactUpdateCommandData {
  artifact: ArtifactSummary;
  updated: string[];
}

export interface ArtifactCreateCommandData {
  artifact: ArtifactSummary;
}

export interface ArtifactValidatePlanningCommandData {
  packetPath: string;
  artifactPath: string;
  validation: PlanningArtifactValidationResult;
}

export function runArtifactListCommand(options: { workspace: string }): CommandSuccess<ArtifactListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const artifacts = withDatabase(workspacePath, listArtifacts);

  return createSuccess({
    command: "artifact.list",
    workspace: workspacePath,
    data: { artifacts }
  });
}

export function runArtifactCreateCommand(options: {
  workspace: string;
  projectId?: string;
  workItemId?: string;
  title: string;
  artifactType: string;
  status?: string;
  path?: string;
}): CommandSuccess<ArtifactCreateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  const artifact = withDatabase(workspacePath, (db) => {
    if (options.projectId && !getProject(db, options.projectId)) {
      throw projectNotFound(options.projectId);
    }
    if (options.workItemId && !getWorkItem(db, options.workItemId)) {
      throw workItemNotFound(options.workItemId);
    }

    const created = createArtifactRecord(db, {
      projectId: options.projectId,
      workItemId: options.workItemId,
      title: options.title,
      artifactType: options.artifactType,
      status: options.status as ArtifactSummary["status"] | undefined,
      path: options.path
    });

    return getArtifact(db, created.id) as ArtifactSummary;
  });

  return createSuccess({
    command: "artifact.create",
    workspace: workspacePath,
    data: { artifact }
  });
}

export function runArtifactUpdateCommand(options: {
  workspace: string;
  artifactId: string;
  status?: string;
  path?: string;
}): CommandSuccess<ArtifactUpdateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const updated = updatedFields(options);

  if (updated.length === 0) {
    throw validationError("At least one artifact field is required.", { fields: updateableFields });
  }

  const artifact = withDatabase(workspacePath, (db) =>
    updateArtifact(db, options.artifactId, {
      status: options.status,
      path: options.path
    })
  );

  if (!artifact) {
    throw artifactNotFound(options.artifactId);
  }

  return createSuccess({
    command: "artifact.update",
    workspace: workspacePath,
    data: { artifact, updated }
  });
}

export function runArtifactValidatePlanningCommand(options: {
  workspace: string;
  packetPath: string;
  artifactPath: string;
}): CommandSuccess<ArtifactValidatePlanningCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const packetPath = resolveArtifactInputPath(workspacePath, options.packetPath);
  const artifactPath = resolveArtifactInputPath(workspacePath, options.artifactPath);
  const packetText = readExistingUtf8File(packetPath, "Packet");
  const artifactText = readExistingUtf8File(artifactPath, "Planning artifact");
  const validation = validatePlanningArtifact({ packetText, artifactText });

  return createSuccess({
    command: "artifact.validate-planning",
    workspace: workspacePath,
    data: {
      packetPath,
      artifactPath,
      validation
    },
    warnings: validation.warnings.map((warning) => `${warning.code}: ${warning.message}`)
  });
}

export function renderArtifactListSuccess(response: CommandSuccess<ArtifactListCommandData>): string[] {
  if (response.data.artifacts.length === 0) {
    return ["No artifacts yet."];
  }

  return response.data.artifacts.flatMap((artifact) => renderArtifact(artifact));
}

export function renderArtifactCreateSuccess(response: CommandSuccess<ArtifactCreateCommandData>): string[] {
  return renderArtifact(response.data.artifact);
}

export function renderArtifactUpdateSuccess(response: CommandSuccess<ArtifactUpdateCommandData>): string[] {
  return [
    `Updated artifact: ${response.data.artifact.title}`,
    `ID: ${response.data.artifact.id}`,
    `Updated fields: ${response.data.updated.join(", ")}`,
    `Status: ${response.data.artifact.status}`,
    `Path: ${response.data.artifact.path ?? "None"}`
  ];
}

export function renderArtifactValidatePlanningSuccess(
  response: CommandSuccess<ArtifactValidatePlanningCommandData>
): string[] {
  const result = response.data.validation;
  const lines = [
    "Planning artifact validation",
    `Result: ${result.passed ? "PASS" : "FAIL"}`,
    `Score: ${result.score}`,
    `Packet: ${response.data.packetPath}`,
    `Artifact: ${response.data.artifactPath}`,
    `Failures: ${result.failures.length}`,
    `Warnings: ${result.warnings.length}`
  ];

  for (const failure of result.failures) {
    lines.push(`- FAIL ${failure.code}: ${failure.message}`);
  }
  for (const warning of result.warnings) {
    lines.push(`- WARN ${warning.code}: ${warning.message}`);
  }

  return lines;
}

const updateableFields = ["status", "path"] as const;

function updatedFields(options: { status?: string; path?: string }): string[] {
  const fields: string[] = [];

  if (options.status !== undefined) {
    fields.push("status");
  }

  if (options.path !== undefined) {
    fields.push("path");
  }

  return fields;
}

function renderArtifact(artifact: ArtifactSummary): string[] {
  const project = artifact.project_name ? ` [${artifact.project_name}]` : "";
  const workItem = artifact.work_item_title ? ` (${artifact.work_item_title})` : "";

  return [
    `${artifact.title}${project}${workItem}`,
    `  ID: ${artifact.id}`,
    `  Type: ${artifact.artifact_type}`,
    `  Status: ${artifact.status}`,
    `  Path: ${artifact.path ?? "None"}`
  ];
}

function resolveArtifactInputPath(workspacePath: string, inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.join(workspacePath, inputPath);
}

function readExistingUtf8File(filePath: string, label: string): string {
  if (!existsSync(filePath)) {
    throw validationError(`${label} file does not exist.`, { path: filePath });
  }

  return readFileSync(filePath, "utf8");
}
