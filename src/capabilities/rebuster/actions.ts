import type Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CapabilityRuntime } from "../core.js";
import { createCoreCapabilityApi } from "../coreApi.js";
import {
  attachRebusterEventReview,
  listOpenRebusterDecisionEvents,
  listRebusterEvents,
  listRebusterIntegrations,
  parseRebusterEventPayload,
  touchRebusterIntegrationSync,
  upsertRebusterEvent,
  upsertRebusterIntegration,
  type RebusterEventRecord,
  type RebusterEventPayload,
  type RebusterEventSummary,
  type RebusterIntegration
} from "./repository.js";

const execFileAsync = promisify(execFile);

const STRICT_SPEC_SECTIONS = [
  "ANSWER",
  "CONCEPT",
  "SHORT DESCRIPTION",
  "IMAGE PROMPT",
  "CONSTRAINTS",
  "PRIMARY FUSION TYPE",
  "TAGS",
  "GROWTH PREDICTION",
  "QUALITY SCORES",
  "METADATA SNAPSHOT"
] as const;

export interface RebusterConfigureInput {
  projectId: string;
  repoPath?: string | null;
  baseUrl?: string | null;
  dashboardUrl?: string | null;
}

export interface RebusterStatus {
  integration: RebusterIntegration | null;
  integrations: RebusterIntegration[];
  recentEvents: RebusterEventSummary[];
  decisionEvents: RebusterEventSummary[];
}

export interface RebusterIngestResult {
  integration: RebusterIntegration;
  event: RebusterEventSummary;
  reviewItemId: string | null;
  createdDecision: boolean;
}

export interface RebusterCreateRebusInput {
  specText: string;
  force?: boolean;
}

export interface RebusterCreateRebusResult {
  integration: RebusterIntegration;
  transport: "http" | "local_cli";
  record: {
    slug: string;
    answer: string;
    status: string;
    url: string;
  };
  event: RebusterEventSummary;
}

export function createRebusterRuntime(db: Database.Database, workspacePath: string): CapabilityRuntime {
  return {
    db,
    workspacePath,
    core: createCoreCapabilityApi(db)
  };
}

export function configureRebusterBridge(
  runtime: CapabilityRuntime,
  input: RebusterConfigureInput
): RebusterIntegration {
  const context = runtime.core.readProjectContext(input.projectId);
  if (!context) {
    throw new Error("Project is required.");
  }

  const integration = upsertRebusterIntegration(runtime.db, {
    projectId: input.projectId,
    repoPath: input.repoPath,
    baseUrl: input.baseUrl,
    dashboardUrl: input.dashboardUrl,
    statusSummary: "Configured"
  });

  runtime.core.emitEvent({
    eventType: "rebuster.configured",
    sourceModule: "rebuster",
    projectId: integration.project_id,
    payload: {
      integrationId: integration.id,
      repoPath: integration.repo_path,
      baseUrl: integration.base_url,
      dashboardUrl: integration.dashboard_url
    }
  });

  return integration;
}

export function getRebusterStatus(runtime: CapabilityRuntime): RebusterStatus {
  const integrations = listRebusterIntegrations(runtime.db);
  return {
    integration: integrations[0] ?? null,
    integrations,
    recentEvents: listRebusterEvents(runtime.db, 10),
    decisionEvents: listOpenRebusterDecisionEvents(runtime.db)
  };
}

export async function createRebusterRebus(
  runtime: CapabilityRuntime,
  input: RebusterCreateRebusInput
): Promise<RebusterCreateRebusResult> {
  const spec = validateStrictRebusterSpec(input.specText);
  const integration = resolveSingleIntegration(runtime.db);
  const trigger = integration.base_url
    ? await createRebusOverHttp(integration, input.specText, input.force === true)
    : await createRebusWithLocalCli(integration, input.specText, input.force === true);
  const rebusterUrl = rebusterRecordUrl(integration, trigger.slug);
  const event = upsertRebusterEvent(runtime.db, {
    projectId: integration.project_id,
    payload: {
      eventType: "candidate_captured",
      externalId: `rebuster:create:${trigger.slug}`,
      rebusId: trigger.slug,
      answer: trigger.answer || spec.answer,
      status: trigger.status || "prompted",
      summary: `Created Rebuster rebus "${trigger.answer || spec.answer}" via Arcadia.`,
      decisionRequired: false,
      recommendation: null,
      rebusterUrl,
      artifactRefs: [],
      occurredAt: new Date().toISOString()
    }
  });
  const syncedIntegration = touchRebusterIntegrationSync(runtime.db, integration.id) ?? integration;
  runtime.core.emitEvent({
    eventType: "rebuster.candidate_captured",
    sourceModule: "rebuster",
    projectId: integration.project_id,
    payload: {
      externalId: `rebuster:create:${trigger.slug}`,
      rebusId: trigger.slug,
      answer: trigger.answer || spec.answer,
      status: trigger.status || "prompted",
      summary: `Created Rebuster rebus "${trigger.answer || spec.answer}" via Arcadia.`,
      rebusterUrl,
      transport: trigger.transport
    }
  });
  const summary = listRebusterEvents(runtime.db, 50).find((candidate) => candidate.id === event.id) ?? eventSummary(event);

  return {
    integration: syncedIntegration,
    transport: trigger.transport,
    record: {
      slug: trigger.slug,
      answer: trigger.answer || spec.answer,
      status: trigger.status || "prompted",
      url: rebusterUrl
    },
    event: summary
  };
}

export function ingestRebusterEvent(
  runtime: CapabilityRuntime,
  rawPayload: unknown
): RebusterIngestResult {
  const payload = parseRebusterEventPayload(rawPayload);
  const integration = resolveSingleIntegration(runtime.db);
  const firstWrite = upsertRebusterEvent(runtime.db, {
    projectId: integration.project_id,
    payload
  });
  let event = firstWrite;
  let reviewItemId = event.review_item_id;
  let createdDecision = false;

  if (payload.decisionRequired && !reviewItemId) {
    const review = runtime.core.createReviewItem({
      projectId: integration.project_id,
      decisionNeeded: `Resolve Rebuster Decision for "${payload.answer}" in Rebuster Studio.`,
      recommendation: payload.recommendation ?? "Open Rebuster Studio and make the creative workflow decision there.",
      sourceInput: `${payload.eventType}: ${payload.summary}`,
      proposedAction: `Open ${payload.rebusterUrl} and record the selected outcome in Rebuster Studio.`,
      resolvedIntent: "rebuster.decision_required",
      confidenceLabel: "high",
      confidence: 1,
      context: {
        module: "rebuster",
        ownership: "Rebuster owns creative and production state; Arcadia routes the Decision.",
        externalId: payload.externalId,
        rebusId: payload.rebusId,
        answer: payload.answer,
        status: payload.status,
        rebusterUrl: payload.rebusterUrl,
        artifactRefs: payload.artifactRefs
      }
    });
    reviewItemId = review.id;
    event = attachRebusterEventReview(runtime.db, event.id, review.id) ?? event;
    createdDecision = true;
  }

  const syncedIntegration = touchRebusterIntegrationSync(runtime.db, integration.id) ?? integration;
  runtime.core.emitEvent({
    eventType: `rebuster.${payload.eventType}`,
    sourceModule: "rebuster",
    projectId: integration.project_id,
    reviewItemId,
    payload: {
      externalId: payload.externalId,
      rebusId: payload.rebusId,
      answer: payload.answer,
      status: payload.status,
      summary: payload.summary,
      decisionRequired: payload.decisionRequired,
      recommendation: payload.recommendation,
      rebusterUrl: payload.rebusterUrl,
      artifactRefs: payload.artifactRefs
    }
  });

  const summary = listRebusterEvents(runtime.db, 50).find((candidate) => candidate.id === event.id) ?? {
    ...event,
    project_name: null,
    review_slug: null,
    review_status: null
  };

  return {
    integration: syncedIntegration,
    event: summary,
    reviewItemId,
    createdDecision
  };
}

function resolveSingleIntegration(db: Database.Database): RebusterIntegration {
  const integrations = listRebusterIntegrations(db);
  if (integrations.length === 0) {
    throw new Error("Rebuster bridge is not configured.");
  }

  if (integrations.length > 1) {
    throw new Error("Multiple Rebuster bridges are configured; event ingestion requires exactly one.");
  }

  return integrations[0];
}

export function validateStrictRebusterSpec(specText: string): { answer: string } {
  const text = specText.trim();
  if (!text) {
    throw new Error("Rebuster spec text is required.");
  }

  const positions = STRICT_SPEC_SECTIONS.map((section) => ({
    section,
    index: findSectionIndex(text, section)
  }));
  const missing = positions.filter((position) => position.index === -1).map((position) => position.section);
  if (missing.length > 0) {
    throw new Error(`Rebuster spec is missing required sections: ${missing.join(", ")}.`);
  }

  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1];
    const current = positions[index];
    if (previous.index > current.index) {
      throw new Error(`Rebuster spec sections must be in strict order: ${STRICT_SPEC_SECTIONS.join(", ")}.`);
    }
  }

  const answer = extractSectionValue(text, "ANSWER", "CONCEPT");
  if (!answer) {
    throw new Error("Rebuster spec ANSWER section must not be empty.");
  }

  return { answer };
}

async function createRebusOverHttp(
  integration: RebusterIntegration,
  specText: string,
  force: boolean
): Promise<{ transport: "http"; slug: string; answer: string; status: string }> {
  if (!integration.base_url) {
    throw new Error("Rebuster base URL is not configured.");
  }

  const url = `${integration.base_url.replace(/\/+$/, "")}/api/rebuses/add`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: specText, force })
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(`Rebuster API create failed: ${stringField(body, "error") ?? response.statusText}`);
  }

  const record = objectField(body, "record");
  const slug = stringField(record, "slug");
  const answer = stringField(record, "answer");
  const status = stringField(record, "status");
  if (!slug || !answer || !status) {
    throw new Error("Rebuster API create response did not include record.slug, record.answer, and record.status.");
  }

  return { transport: "http", slug, answer, status };
}

async function createRebusWithLocalCli(
  integration: RebusterIntegration,
  specText: string,
  force: boolean
): Promise<{ transport: "local_cli"; slug: string; answer: string; status: string }> {
  if (!integration.repo_path) {
    throw new Error("Rebuster bridge requires either baseUrl or repoPath to create a rebus.");
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "arcadia-rebuster-spec-"));
  const specPath = path.join(tempDir, "rebus-spec.txt");
  try {
    await writeFile(specPath, specText, "utf8");
    const args = ["--dir", integration.repo_path, "exec", "tsx", "src/cli.ts", "add", "--spec", specPath];
    if (force) {
      args.push("--force");
    }
    const result = await execFileAsync("pnpm", args, {
      cwd: integration.repo_path,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024
    });
    const record = parseJsonObject(result.stdout);
    const slug = stringField(record, "slug");
    const answer = stringField(record, "answer");
    const status = stringField(record, "status");
    if (!slug || !answer || !status) {
      throw new Error("Rebuster CLI create output did not include slug, answer, and status.");
    }
    return { transport: "local_cli", slug, answer, status };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Rebuster CLI create failed: ${error.message}`);
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function rebusterRecordUrl(integration: RebusterIntegration, slug: string): string {
  const base = integration.dashboard_url ?? integration.base_url;
  if (!base) {
    return `rebuster:${slug}`;
  }
  return `${base.replace(/\/+$/, "")}/rebuses/${encodeURIComponent(slug)}`;
}

function eventSummary(event: RebusterEventRecord): RebusterEventSummary {
  return {
    ...event,
    project_name: null,
    review_slug: null,
    review_status: null
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("No JSON output received.");
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON output must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function objectField(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === "object" && !Array.isArray(field) ? field as Record<string, unknown> : null;
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function findSectionIndex(text: string, section: string): number {
  const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(section)}\\b`, "i");
  const match = pattern.exec(text);
  return match?.index ?? -1;
}

function extractSectionValue(text: string, section: string, nextSection: string): string {
  const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(section)}\\b\\s*([\\s\\S]*?)(?=\\n\\s*${escapeRegExp(nextSection)}\\b)`, "i");
  return pattern.exec(text)?.[1]?.trim() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { parseRebusterEventPayload, type RebusterEventPayload };
