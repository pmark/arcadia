import { existsSync, statSync } from "node:fs";
import path from "node:path";

import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectBySlug, getProjectMetadata, listProjects } from "../db/repositories.js";
import { loadWorkspaceConfig } from "../workspace/config.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { deriveLivingSystemModel } from "./derive.js";
import {
  applyLivingSystemProjection,
  previewLivingSystemProjection,
  type LivingSystemProjectionResult,
  type LivingSystemProjectionStatus
} from "./project.js";

export type LivingSystemSyncProjectStatus = "projected" | "skipped" | "refused";

export interface LivingSystemSyncProjectResult {
  project: string;
  repositoryPath: string | null;
  status: LivingSystemSyncProjectStatus;
  projection: LivingSystemProjectionResult | null;
  message: string | null;
}

export interface LivingSystemSyncResult {
  applied: boolean;
  vaultPath: string | null;
  projects: LivingSystemSyncProjectResult[];
  counts: Record<LivingSystemProjectionStatus | "skipped", number>;
}

export function runLivingSystemSyncCommand(options: {
  workspace: string;
  project?: string;
  all?: boolean;
  apply?: boolean;
  refreshedAt?: string;
}): CommandSuccess<LivingSystemSyncResult> {
  if ((options.project ? 1 : 0) + (options.all ? 1 : 0) !== 1) {
    throw validationError("Choose exactly one scope: --project <project> or --all.");
  }
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const paths = getWorkspacePaths(workspacePath);
  const config = loadWorkspaceConfig(paths.configFile);
  const configuredVault = config.memory?.enabled ? config.memory.obsidianVaultPath?.trim() : undefined;
  const vaultPath = configuredVault && path.isAbsolute(configuredVault) ? path.resolve(configuredVault) : null;
  const candidates = withReadOnlyDatabase(workspacePath, (db) => {
    if (options.project) {
      const project = getProjectBySlug(db, options.project);
      if (!project) throw validationError(`Project ${JSON.stringify(options.project)} was not found.`);
      return [{ project, metadata: getProjectMetadata(db, project.id) }];
    }
    return listProjects(db)
      .filter((project) => project.status === "active")
      .map((project) => ({ project, metadata: getProjectMetadata(db, project.id) }));
  });
  const refreshedAt = options.refreshedAt ?? new Date().toISOString();
  const projects = candidates.map(({ project, metadata }): LivingSystemSyncProjectResult => {
    const repositoryPath = metadata?.repo_path?.trim() || null;
    if (!config.memory?.enabled) return skipped(project.slug, repositoryPath, "Workspace memory sync is disabled.");
    if (!vaultPath) return skipped(project.slug, repositoryPath, "Configure an absolute memory.obsidianVaultPath.");
    if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
      return skipped(project.slug, repositoryPath, `Obsidian vault does not exist: ${vaultPath}`);
    }
    if (!repositoryPath || !existsSync(repositoryPath) || !statSync(repositoryPath).isDirectory()) {
      return skipped(project.slug, repositoryPath, "Project repository path is missing or invalid.");
    }
    if (!existsSync(path.join(repositoryPath, "docs", "living-system.yaml"))) {
      return skipped(project.slug, repositoryPath, "Project has no docs/living-system.yaml manifest.");
    }
    try {
      const derived = deriveLivingSystemModel({ repoRoot: repositoryPath, projectSlug: project.slug });
      if (!derived.model) {
        return {
          project: project.slug,
          repositoryPath,
          status: "refused",
          projection: null,
          message: derived.errors.map((error) => `${error.field}: ${error.message}`).join("; ")
        };
      }
      const input = { vaultPath, repoRoot: repositoryPath, model: derived.model, refreshedAt };
      const projection = options.apply
        ? applyLivingSystemProjection(input)
        : previewLivingSystemProjection(input);
      return { project: project.slug, repositoryPath, status: "projected", projection, message: null };
    } catch (error) {
      return {
        project: project.slug,
        repositoryPath,
        status: "refused",
        projection: null,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });
  const counts = countResults(projects);
  const result = { applied: Boolean(options.apply), vaultPath, projects, counts };
  return createSuccess({
    command: "memory.system.sync",
    workspace: workspacePath,
    data: result,
    artifacts: options.apply
      ? projects.flatMap((entry) => entry.projection?.entries
        .filter((file) => file.status === "created" || file.status === "updated")
        .map((file) => path.join(vaultPath as string, file.path)) ?? [])
      : [],
    warnings: projects
      .filter((entry) => entry.status !== "projected")
      .map((entry) => `${entry.project}: ${entry.message}`)
  });
}

/** Best-effort refresh for an already-accepted Action transition. */
export function refreshLivingSystemAfterTransition(workspace: string, projectSlug: string): string | null {
  try {
    const { workspacePath } = resolveReadyWorkspace(workspace);
    if (!loadWorkspaceConfig(getWorkspacePaths(workspacePath).configFile).memory?.enabled) return null;
    const response = runLivingSystemSyncCommand({ workspace, project: projectSlug, apply: true });
    const result = response.data.projects[0];
    return result?.status === "projected" ? null : result?.message ?? "Living-system refresh did not run.";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function renderLivingSystemSyncSuccess(response: CommandSuccess<LivingSystemSyncResult>): string[] {
  const { data } = response;
  const lines = [
    `Living-system sync ${data.applied ? "applied" : "preview"}`,
    `Vault: ${data.vaultPath ?? "Not configured"}`,
    `Created: ${data.counts.created}; Updated: ${data.counts.updated}; Unchanged: ${data.counts.unchanged}; Stale: ${data.counts.stale}; Skipped: ${data.counts.skipped}; Refused: ${data.counts.refused}`
  ];
  for (const project of data.projects) {
    lines.push(`- ${project.project}: ${project.status}${project.message ? ` — ${project.message}` : ""}`);
  }
  return lines;
}

function skipped(project: string, repositoryPath: string | null, message: string): LivingSystemSyncProjectResult {
  return { project, repositoryPath, status: "skipped", projection: null, message };
}

function countResults(projects: LivingSystemSyncProjectResult[]): LivingSystemSyncResult["counts"] {
  const counts = { created: 0, updated: 0, unchanged: 0, stale: 0, refused: 0, skipped: 0 };
  for (const project of projects) {
    if (project.status === "skipped") counts.skipped += 1;
    else if (project.status === "refused") counts.refused += 1;
    else if (project.projection) {
      for (const key of ["created", "updated", "unchanged", "stale", "refused"] as const) {
        counts[key] += project.projection.counts[key];
      }
    }
  }
  return counts;
}
