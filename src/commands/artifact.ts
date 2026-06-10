import { artifactNotFound, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { listArtifacts, updateArtifact } from "../db/repositories.js";
import type { ArtifactSummary } from "../domain/types.js";

export interface ArtifactListCommandData {
  artifacts: ArtifactSummary[];
}

export interface ArtifactUpdateCommandData {
  artifact: ArtifactSummary;
  updated: string[];
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

export function renderArtifactListSuccess(response: CommandSuccess<ArtifactListCommandData>): string[] {
  if (response.data.artifacts.length === 0) {
    return ["No artifacts yet."];
  }

  return response.data.artifacts.flatMap((artifact) => renderArtifact(artifact));
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
