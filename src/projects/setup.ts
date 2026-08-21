import type Database from "better-sqlite3";
import { PROJECT_STATUSES, assertAllowedValue, type ProjectStatus } from "../domain/constants.js";
import type { Project, ProjectMetadata } from "../domain/types.js";
import { getProject, getProjectMetadata, updateProject, upsertProjectMetadata } from "../db/repositories.js";

export const CODEX_REPO_PATH_REQUIRED_MESSAGE =
  "Codex cannot run for this project until a repository path is configured.";

export interface UpdateProjectSetupInput {
  projectId: string;
  mission?: string;
  status?: string;
  repoPath?: string | null;
  repositoryUrl?: string | null;
  buildAgent?: string | null;
  validationCommands?: string[];
}

export interface ProjectSetupUpdateResult {
  project: Project;
  metadata: ProjectMetadata;
  updated: string[];
}

export function updateProjectSetup(
  db: Database.Database,
  input: UpdateProjectSetupInput
): ProjectSetupUpdateResult | null {
  const existingProject = getProject(db, input.projectId);
  if (!existingProject) {
    return null;
  }

  const updated: string[] = [];
  const projectUpdates: { mission?: string; status?: ProjectStatus } = {};

  if (input.mission !== undefined) {
    projectUpdates.mission = required(input.mission, "Mission");
    updated.push("mission");
  }

  if (input.status !== undefined) {
    assertAllowedValue("Project status", input.status, PROJECT_STATUSES);
    projectUpdates.status = input.status;
    updated.push("status");
  }

  const project =
    updated.some((field) => field === "mission" || field === "status")
      ? updateProject(db, input.projectId, projectUpdates)
      : existingProject;
  if (!project) {
    return null;
  }

  const existingMetadata = getProjectMetadata(db, input.projectId);
  const metadataNeedsUpdate = input.repoPath !== undefined || input.repositoryUrl !== undefined ||
    input.buildAgent !== undefined || input.validationCommands !== undefined;
  const metadata = metadataNeedsUpdate
    ? upsertProjectMetadata(db, {
        projectId: input.projectId,
        aliases: decodeStringArray(existingMetadata?.aliases),
        repoPath: input.repoPath === undefined ? existingMetadata?.repo_path ?? null : nullable(input.repoPath),
        repositoryUrl: input.repositoryUrl === undefined
          ? existingMetadata?.repository_url ?? null
          : validateGitHubRepositoryUrl(input.repositoryUrl),
        buildAgent: input.buildAgent === undefined
          ? existingMetadata?.build_agent ?? null
          : validateBuildAgent(input.buildAgent),
        statusSummary: existingMetadata?.status_summary ?? null,
        validationCommands:
          input.validationCommands === undefined
            ? decodeStringArray(existingMetadata?.validation_commands)
            : normalizedStringArray(input.validationCommands)
      })
    : existingMetadata ??
      upsertProjectMetadata(db, {
        projectId: input.projectId,
        aliases: [],
        repoPath: null,
        repositoryUrl: null,
        buildAgent: null,
        statusSummary: null,
        validationCommands: []
      });

  if (!metadata) {
    return null;
  }

  if (input.repoPath !== undefined) {
    updated.push("repoPath");
  }
  if (input.repositoryUrl !== undefined) {
    updated.push("repositoryUrl");
    db.prepare(
      `UPDATE review_items
       SET missing_fields = ?, updated_at = ?
       WHERE project_id = ? AND resolved_intent = 'ProjectProposalApproval' AND status IN ('open', 'deferred')`
    ).run(
      metadata.repository_url ? "[]" : JSON.stringify(["repository URL"]),
      new Date().toISOString(),
      input.projectId
    );
  }
  if (input.buildAgent !== undefined) {
    updated.push("buildAgent");
  }
  if (input.validationCommands !== undefined) {
    updated.push("validationCommands");
  }

  return { project, metadata, updated };
}

export function validateGitHubRepositoryUrl(value: string | null | undefined): string | null {
  const normalized = nullable(value);
  if (!normalized) return null;
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(normalized) &&
    !/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(normalized)
  ) {
    throw new Error("Repository URL must identify a GitHub repository using HTTPS or SSH.");
  }
  return normalized;
}

function validateBuildAgent(value: string | null | undefined): string | null {
  const normalized = nullable(value);
  if (!normalized) return null;
  if (normalized !== "codex" && normalized !== "claude-code") {
    throw new Error("Build agent must be codex or claude-code.");
  }
  return normalized;
}

export function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizedStringArray(parsed) : [];
  } catch {
    return [];
  }
}

function normalizedStringArray(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function nullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }

  return trimmed;
}
