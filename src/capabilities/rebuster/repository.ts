import type Database from "better-sqlite3";
import { createId } from "../../utils/id.js";
import { nowIso } from "../../utils/time.js";

export const REBUSTER_EVENT_TYPES = [
  "candidate_captured",
  "overlap_ready",
  "decision_required",
  "spec_ready",
  "review_queued",
  "rejected",
  "archived",
  "published"
] as const;

export type RebusterEventType = (typeof REBUSTER_EVENT_TYPES)[number];

export interface RebusterIntegration {
  id: string;
  project_id: string;
  repo_path: string | null;
  base_url: string | null;
  dashboard_url: string | null;
  status_summary: string | null;
  last_health_check_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RebusterArtifactRef {
  type?: string;
  title?: string;
  url?: string;
  storageRef?: string;
  [key: string]: unknown;
}

export interface RebusterEventPayload {
  eventType: RebusterEventType;
  externalId: string;
  rebusId: string;
  answer: string;
  status: string;
  summary: string;
  decisionRequired: boolean;
  recommendation: string | null;
  rebusterUrl: string;
  artifactRefs: RebusterArtifactRef[];
  occurredAt: string;
}

export interface RebusterEventRecord {
  id: string;
  external_id: string;
  project_id: string;
  event_type: RebusterEventType;
  rebus_id: string;
  answer: string;
  status: string;
  summary: string;
  decision_required: 0 | 1;
  recommendation: string | null;
  rebuster_url: string;
  artifact_refs_json: string;
  occurred_at: string;
  review_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RebusterEventSummary extends RebusterEventRecord {
  project_name: string | null;
  review_slug: string | null;
  review_status: string | null;
}

export function parseRebusterEventPayload(raw: unknown): RebusterEventPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Rebuster event payload must be a JSON object.");
  }

  const value = raw as Record<string, unknown>;
  const eventType = parseEventType(requiredString(value.eventType, "eventType"));
  const artifactRefs = parseArtifactRefs(value.artifactRefs);
  const recommendation = value.recommendation === null ? null : requiredString(value.recommendation, "recommendation");
  const decisionRequired = requiredBoolean(value.decisionRequired, "decisionRequired");
  const occurredAt = requiredString(value.occurredAt, "occurredAt");

  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("occurredAt must be an ISO-compatible timestamp.");
  }

  return {
    eventType,
    externalId: requiredString(value.externalId, "externalId"),
    rebusId: requiredString(value.rebusId, "rebusId"),
    answer: requiredString(value.answer, "answer"),
    status: requiredString(value.status, "status"),
    summary: requiredString(value.summary, "summary"),
    decisionRequired,
    recommendation,
    rebusterUrl: requiredString(value.rebusterUrl, "rebusterUrl"),
    artifactRefs,
    occurredAt
  };
}

export function upsertRebusterIntegration(
  db: Database.Database,
  input: {
    projectId: string;
    repoPath?: string | null;
    baseUrl?: string | null;
    dashboardUrl?: string | null;
    statusSummary?: string | null;
    lastHealthCheckAt?: string | null;
    lastSyncAt?: string | null;
  }
): RebusterIntegration {
  const timestamp = nowIso();
  const existing = getRebusterIntegrationByProject(db, input.projectId);
  const integration: RebusterIntegration = {
    id: existing?.id ?? createId("rebusterIntegration"),
    project_id: input.projectId,
    repo_path: nullable(input.repoPath ?? existing?.repo_path),
    base_url: nullable(input.baseUrl ?? existing?.base_url),
    dashboard_url: nullable(input.dashboardUrl ?? existing?.dashboard_url),
    status_summary: nullable(input.statusSummary ?? existing?.status_summary) ?? "Configured",
    last_health_check_at: nullable(input.lastHealthCheckAt ?? existing?.last_health_check_at),
    last_sync_at: nullable(input.lastSyncAt ?? existing?.last_sync_at),
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO rebuster_integrations (
      id, project_id, repo_path, base_url, dashboard_url, status_summary,
      last_health_check_at, last_sync_at, created_at, updated_at
    ) VALUES (
      @id, @project_id, @repo_path, @base_url, @dashboard_url, @status_summary,
      @last_health_check_at, @last_sync_at, @created_at, @updated_at
    )
    ON CONFLICT(project_id) DO UPDATE SET
      repo_path = excluded.repo_path,
      base_url = excluded.base_url,
      dashboard_url = excluded.dashboard_url,
      status_summary = excluded.status_summary,
      last_health_check_at = excluded.last_health_check_at,
      last_sync_at = excluded.last_sync_at,
      updated_at = excluded.updated_at`
  ).run(integration);

  return getRebusterIntegrationByProject(db, input.projectId) as RebusterIntegration;
}

export function listRebusterIntegrations(db: Database.Database): RebusterIntegration[] {
  if (!tableExists(db, "rebuster_integrations")) {
    return [];
  }

  return db
    .prepare("SELECT * FROM rebuster_integrations ORDER BY updated_at DESC")
    .all() as RebusterIntegration[];
}

export function getRebusterIntegrationByProject(
  db: Database.Database,
  projectId: string
): RebusterIntegration | null {
  if (!tableExists(db, "rebuster_integrations")) {
    return null;
  }

  return (
    (db.prepare("SELECT * FROM rebuster_integrations WHERE project_id = ?").get(projectId) as
      | RebusterIntegration
      | undefined) ?? null
  );
}

export function touchRebusterIntegrationSync(db: Database.Database, integrationId: string): RebusterIntegration | null {
  db.prepare("UPDATE rebuster_integrations SET last_sync_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), integrationId);
  return (db.prepare("SELECT * FROM rebuster_integrations WHERE id = ?").get(integrationId) as RebusterIntegration | undefined) ?? null;
}

export function upsertRebusterEvent(
  db: Database.Database,
  input: {
    projectId: string;
    payload: RebusterEventPayload;
    reviewItemId?: string | null;
  }
): RebusterEventRecord {
  const timestamp = nowIso();
  const existing = getRebusterEventByExternalId(db, input.payload.externalId);
  const event: RebusterEventRecord = {
    id: existing?.id ?? createId("rebusterEvent"),
    external_id: input.payload.externalId,
    project_id: input.projectId,
    event_type: input.payload.eventType,
    rebus_id: input.payload.rebusId,
    answer: input.payload.answer,
    status: input.payload.status,
    summary: input.payload.summary,
    decision_required: input.payload.decisionRequired ? 1 : 0,
    recommendation: input.payload.recommendation,
    rebuster_url: input.payload.rebusterUrl,
    artifact_refs_json: JSON.stringify(input.payload.artifactRefs),
    occurred_at: input.payload.occurredAt,
    review_item_id: input.reviewItemId ?? existing?.review_item_id ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO rebuster_events (
      id, external_id, project_id, event_type, rebus_id, answer, status, summary,
      decision_required, recommendation, rebuster_url, artifact_refs_json, occurred_at,
      review_item_id, created_at, updated_at
    ) VALUES (
      @id, @external_id, @project_id, @event_type, @rebus_id, @answer, @status, @summary,
      @decision_required, @recommendation, @rebuster_url, @artifact_refs_json, @occurred_at,
      @review_item_id, @created_at, @updated_at
    )
    ON CONFLICT(external_id) DO UPDATE SET
      project_id = excluded.project_id,
      event_type = excluded.event_type,
      rebus_id = excluded.rebus_id,
      answer = excluded.answer,
      status = excluded.status,
      summary = excluded.summary,
      decision_required = excluded.decision_required,
      recommendation = excluded.recommendation,
      rebuster_url = excluded.rebuster_url,
      artifact_refs_json = excluded.artifact_refs_json,
      occurred_at = excluded.occurred_at,
      review_item_id = COALESCE(rebuster_events.review_item_id, excluded.review_item_id),
      updated_at = excluded.updated_at`
  ).run(event);

  return getRebusterEventByExternalId(db, input.payload.externalId) as RebusterEventRecord;
}

export function attachRebusterEventReview(
  db: Database.Database,
  eventId: string,
  reviewItemId: string
): RebusterEventRecord | null {
  db.prepare("UPDATE rebuster_events SET review_item_id = ?, updated_at = ? WHERE id = ?")
    .run(reviewItemId, nowIso(), eventId);
  return getRebusterEvent(db, eventId);
}

export function getRebusterEvent(db: Database.Database, id: string): RebusterEventRecord | null {
  if (!tableExists(db, "rebuster_events")) {
    return null;
  }

  return (db.prepare("SELECT * FROM rebuster_events WHERE id = ?").get(id) as RebusterEventRecord | undefined) ?? null;
}

export function getRebusterEventByExternalId(
  db: Database.Database,
  externalId: string
): RebusterEventRecord | null {
  if (!tableExists(db, "rebuster_events")) {
    return null;
  }

  return (
    (db.prepare("SELECT * FROM rebuster_events WHERE external_id = ?").get(externalId) as
      | RebusterEventRecord
      | undefined) ?? null
  );
}

export function listRebusterEvents(db: Database.Database, limit = 10): RebusterEventSummary[] {
  if (!tableExists(db, "rebuster_events")) {
    return [];
  }

  return db
    .prepare(
      `SELECT
        re.*,
        p.name AS project_name,
        ri.slug AS review_slug,
        ri.status AS review_status
      FROM rebuster_events re
      LEFT JOIN projects p ON p.id = re.project_id
      LEFT JOIN review_items ri ON ri.id = re.review_item_id
      ORDER BY re.occurred_at DESC, re.updated_at DESC
      LIMIT ?`
    )
    .all(limit) as RebusterEventSummary[];
}

export function listOpenRebusterDecisionEvents(db: Database.Database): RebusterEventSummary[] {
  if (!tableExists(db, "rebuster_events")) {
    return [];
  }

  return db
    .prepare(
      `SELECT
        re.*,
        p.name AS project_name,
        ri.slug AS review_slug,
        ri.status AS review_status
      FROM rebuster_events re
      LEFT JOIN projects p ON p.id = re.project_id
      LEFT JOIN review_items ri ON ri.id = re.review_item_id
      WHERE re.decision_required = 1
        AND re.review_item_id IS NOT NULL
        AND ri.status = 'open'
      ORDER BY re.occurred_at DESC, re.updated_at DESC`
    )
    .all() as RebusterEventSummary[];
}

export function decodeRebusterArtifactRefs(raw: string | null | undefined): RebusterArtifactRef[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseArtifactRefs(parsed);
  } catch {
    return [];
  }
}

function parseEventType(value: string): RebusterEventType {
  const normalized = value.startsWith("rebuster.") ? value.slice("rebuster.".length) : value;
  if (!REBUSTER_EVENT_TYPES.includes(normalized as RebusterEventType)) {
    throw new Error(`eventType must be one of: ${REBUSTER_EVENT_TYPES.join(", ")}.`);
  }
  return normalized as RebusterEventType;
}

function parseArtifactRefs(value: unknown): RebusterArtifactRef[] {
  if (!Array.isArray(value)) {
    throw new Error("artifactRefs must be an array.");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`artifactRefs[${index}] must be an object.`);
    }
    const ref = item as RebusterArtifactRef;
    for (const key of ["type", "title", "url", "storageRef"] as const) {
      if (ref[key] !== undefined && typeof ref[key] !== "string") {
        throw new Error(`artifactRefs[${index}].${key} must be a string when provided.`);
      }
    }
    return ref;
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function nullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}
