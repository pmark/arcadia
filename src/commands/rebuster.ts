import { readFileSync } from "node:fs";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import {
  configureRebusterBridge,
  createRebusterRebus,
  createRebusterRuntime,
  getRebusterStatus,
  ingestRebusterEvent,
  type RebusterCreateRebusResult,
  type RebusterIngestResult,
  type RebusterStatus
} from "../capabilities/rebuster/actions.js";
import type { RebusterIntegration } from "../capabilities/rebuster/repository.js";
import { openDatabase, withDatabase } from "../db/connection.js";
import { listProjects } from "../db/repositories.js";
import type { Project } from "../domain/types.js";

export interface RebusterConfigureCommandData {
  integration: RebusterIntegration;
}

export interface RebusterStatusCommandData extends RebusterStatus {}

export interface RebusterCreateRebusCommandData extends RebusterCreateRebusResult {}

export interface RebusterIngestEventCommandData extends RebusterIngestResult {}

export function runRebusterConfigureCommand(options: {
  workspace: string;
  project: string;
  repoPath?: string;
  baseUrl?: string;
  dashboardUrl?: string;
}): CommandSuccess<RebusterConfigureCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const integration = withDatabase(workspacePath, (db) => {
    const project = resolveProject(db, options.project);
    return configureRebusterBridge(createRebusterRuntime(db, workspacePath), {
      projectId: project.id,
      repoPath: options.repoPath,
      baseUrl: options.baseUrl,
      dashboardUrl: options.dashboardUrl
    });
  });

  return createSuccess({
    command: "rebuster.configure",
    workspace: workspacePath,
    data: { integration }
  });
}

export function runRebusterStatusCommand(options: {
  workspace: string;
}): CommandSuccess<RebusterStatusCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const status = withDatabase(workspacePath, (db) => getRebusterStatus(createRebusterRuntime(db, workspacePath)));

  return createSuccess({
    command: "rebuster.status",
    workspace: workspacePath,
    data: status
  });
}

export async function runRebusterCreateRebusCommand(options: {
  workspace: string;
  spec?: string;
  specText?: string;
  force?: boolean;
}): Promise<CommandSuccess<RebusterCreateRebusCommandData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const specText = readSpecText(options);
  const db = openDatabase(workspacePath);
  try {
    const data = await createRebusterRebus(createRebusterRuntime(db, workspacePath), {
      specText,
      force: options.force
    });

    return createSuccess({
      command: "rebuster.create-rebus",
      workspace: workspacePath,
      data
    });
  } finally {
    db.close();
  }
}

export function runRebusterIngestEventCommand(options: {
  workspace: string;
  jsonFile: string;
}): CommandSuccess<RebusterIngestEventCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const payload = readJsonFile(options.jsonFile);
  const data = withDatabase(workspacePath, (db) =>
    ingestRebusterEvent(createRebusterRuntime(db, workspacePath), payload)
  );

  return createSuccess({
    command: "rebuster.ingest-event",
    workspace: workspacePath,
    data
  });
}

export function renderRebusterConfigureSuccess(response: CommandSuccess<RebusterConfigureCommandData>): string[] {
  const { integration } = response.data;
  return [
    "Configured Rebuster bridge",
    `Project: ${integration.project_id}`,
    `Repository: ${integration.repo_path ?? "Not configured"}`,
    `Base URL: ${integration.base_url ?? "Not configured"}`,
    `Dashboard URL: ${integration.dashboard_url ?? "Not configured"}`
  ];
}

export function renderRebusterStatusSuccess(response: CommandSuccess<RebusterStatusCommandData>): string[] {
  const { integration, recentEvents, decisionEvents } = response.data;
  if (!integration) {
    return ["Rebuster bridge is not configured."];
  }

  return [
    "Rebuster bridge",
    `Project: ${integration.project_id}`,
    `Repository: ${integration.repo_path ?? "Not configured"}`,
    `Base URL: ${integration.base_url ?? "Not configured"}`,
    `Dashboard URL: ${integration.dashboard_url ?? "Not configured"}`,
    `Last sync: ${integration.last_sync_at ?? "Never"}`,
    `Open Decisions: ${decisionEvents.length}`,
    `Recent events: ${recentEvents.length}`
  ];
}

export function renderRebusterCreateRebusSuccess(response: CommandSuccess<RebusterCreateRebusCommandData>): string[] {
  const { record, transport, event } = response.data;
  return [
    `Created Rebuster rebus: ${record.answer}`,
    `Slug: ${record.slug}`,
    `Status: ${record.status}`,
    `Transport: ${transport}`,
    `Event: ${event.external_id}`,
    `Rebuster URL: ${record.url}`
  ];
}

export function renderRebusterIngestEventSuccess(
  response: CommandSuccess<RebusterIngestEventCommandData>
): string[] {
  const { event, reviewItemId, createdDecision } = response.data;
  return [
    `Ingested Rebuster event: ${event.answer}`,
    `Event: ${event.external_id}`,
    `Status: ${event.status}`,
    `Decision: ${reviewItemId ?? "None"}${createdDecision ? " (created)" : ""}`,
    `Rebuster URL: ${event.rebuster_url}`
  ];
}

function readSpecText(options: { spec?: string; specText?: string }): string {
  const sources = [options.spec, options.specText].filter((value) => value !== undefined);
  if (sources.length !== 1) {
    throw validationError("Provide exactly one of --spec or --spec-text.");
  }

  if (options.specText !== undefined) {
    return options.specText;
  }

  try {
    return readFileSync(options.spec ?? "", "utf8");
  } catch (error) {
    throw validationError("Could not read Rebuster spec file.", {
      filePath: options.spec,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw validationError("Could not read Rebuster event JSON.", {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function resolveProject(db: Parameters<typeof listProjects>[0], reference: string): Project {
  const normalized = normalize(reference);
  const matches = listProjects(db).filter((project) =>
    project.id === reference || project.slug === normalized || normalize(project.name) === normalized
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw validationError("Project reference is ambiguous.", {
      reference,
      matches: matches.map((project) => ({ id: project.id, name: project.name }))
    });
  }

  throw validationError("Project not found.", { reference });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
