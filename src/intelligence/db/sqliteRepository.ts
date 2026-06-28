import type Database from "better-sqlite3";
import { createId } from "../../utils/id.js";
import { nowIso } from "../../utils/time.js";
import type { IntelligenceJobRepository } from "./repository.js";
import type {
  IntelligenceJob,
  IntelligenceJobStatus,
  IntelligenceRequest,
  IntelligenceUsage,
  ValidationResult,
} from "../types.js";

interface IntelligenceJobRow {
  id: string;
  idempotency_key: string;
  capability: string;
  client_app: string;
  project_id: string | null;
  mission_id: string | null;
  request_json: string;
  status: IntelligenceJobStatus;
  selected_route: string | null;
  result_json: string | null;
  validation_json: string | null;
  usage_json: string | null;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function rowToJob(row: IntelligenceJobRow): IntelligenceJob {
  return {
    id: row.id,
    status: row.status,
    request: JSON.parse(row.request_json) as IntelligenceRequest,
    selectedRoute: row.selected_route ?? undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    validation: row.validation_json
      ? (JSON.parse(row.validation_json) as ValidationResult)
      : undefined,
    usage: row.usage_json ? (JSON.parse(row.usage_json) as IntelligenceUsage) : undefined,
    error:
      row.error_code || row.error_message
        ? { code: row.error_code ?? "UNKNOWN_ERROR", message: row.error_message ?? "" }
        : undefined,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

export function createSqliteIntelligenceJobRepository(
  db: Database.Database,
): IntelligenceJobRepository {
  function findById(jobId: string): Promise<IntelligenceJob | undefined> {
    const row = db
      .prepare("SELECT * FROM intelligence_jobs WHERE id = ?")
      .get(jobId) as IntelligenceJobRow | undefined;
    return Promise.resolve(row ? rowToJob(row) : undefined);
  }

  function findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<IntelligenceJob | undefined> {
    const row = db
      .prepare("SELECT * FROM intelligence_jobs WHERE idempotency_key = ?")
      .get(idempotencyKey) as IntelligenceJobRow | undefined;
    return Promise.resolve(row ? rowToJob(row) : undefined);
  }

  function createQueuedJob(request: IntelligenceRequest): Promise<IntelligenceJob> {
    const timestamp = nowIso();
    const row: IntelligenceJobRow = {
      id: createId("intelligenceJob"),
      idempotency_key: request.idempotencyKey,
      capability: request.capability,
      client_app: request.clientApp,
      project_id: request.projectId ?? null,
      mission_id: request.missionId ?? null,
      request_json: JSON.stringify(request),
      status: "queued",
      selected_route: null,
      result_json: null,
      validation_json: null,
      usage_json: null,
      error_code: null,
      error_message: null,
      retry_count: 0,
      lease_owner: null,
      lease_expires_at: null,
      created_at: timestamp,
      started_at: null,
      completed_at: null,
    };

    db.prepare(
      `INSERT INTO intelligence_jobs (
        id, idempotency_key, capability, client_app, project_id, mission_id, request_json,
        status, selected_route, result_json, validation_json, usage_json, error_code,
        error_message, retry_count, lease_owner, lease_expires_at, created_at, started_at,
        completed_at
      ) VALUES (
        @id, @idempotency_key, @capability, @client_app, @project_id, @mission_id, @request_json,
        @status, @selected_route, @result_json, @validation_json, @usage_json, @error_code,
        @error_message, @retry_count, @lease_owner, @lease_expires_at, @created_at, @started_at,
        @completed_at
      )`,
    ).run(row);

    return Promise.resolve(rowToJob(row));
  }

  function claimNextQueuedJob(
    workerId: string,
    nowIsoValue: string,
    leaseDurationMs: number,
  ): Promise<IntelligenceJob | undefined> {
    const claimed = db.transaction(() => {
      const candidate = db
        .prepare(
          `SELECT id FROM intelligence_jobs
           WHERE status = 'queued'
              OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?))
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .get(nowIsoValue) as { id: string } | undefined;

      if (!candidate) {
        return undefined;
      }

      const leaseExpiresAt = new Date(Date.parse(nowIsoValue) + leaseDurationMs).toISOString();
      db.prepare(
        `UPDATE intelligence_jobs
         SET status = 'running', lease_owner = ?, lease_expires_at = ?,
             started_at = COALESCE(started_at, ?)
         WHERE id = ?`,
      ).run(workerId, leaseExpiresAt, nowIsoValue, candidate.id);

      return db
        .prepare("SELECT * FROM intelligence_jobs WHERE id = ?")
        .get(candidate.id) as IntelligenceJobRow;
    })();

    return Promise.resolve(claimed ? rowToJob(claimed) : undefined);
  }

  function completeJob(
    jobId: string,
    update: Pick<
      IntelligenceJob,
      "result" | "validation" | "usage" | "selectedRoute" | "completedAt"
    >,
  ): Promise<IntelligenceJob> {
    db.prepare(
      `UPDATE intelligence_jobs
       SET status = 'completed', result_json = ?, validation_json = ?, usage_json = ?,
           selected_route = ?, completed_at = ?, lease_owner = NULL, lease_expires_at = NULL
       WHERE id = ?`,
    ).run(
      JSON.stringify(update.result ?? null),
      JSON.stringify(update.validation ?? null),
      JSON.stringify(update.usage ?? null),
      update.selectedRoute ?? null,
      update.completedAt,
      jobId,
    );
    return requireJob(jobId);
  }

  function failJob(
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
  ): Promise<IntelligenceJob> {
    return finalizeWithError("failed", jobId, error, completedAt);
  }

  function blockJob(
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
  ): Promise<IntelligenceJob> {
    return finalizeWithError("blocked", jobId, error, completedAt);
  }

  function finalizeWithError(
    status: "failed" | "blocked",
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
  ): Promise<IntelligenceJob> {
    db.prepare(
      `UPDATE intelligence_jobs
       SET status = ?, error_code = ?, error_message = ?, completed_at = ?,
           lease_owner = NULL, lease_expires_at = NULL
       WHERE id = ?`,
    ).run(status, error.code, error.message, completedAt, jobId);
    return requireJob(jobId);
  }

  function retryJob(jobId: string, _nowIso: string): Promise<IntelligenceJob> {
    db.prepare(
      `UPDATE intelligence_jobs
       SET status = 'queued', retry_count = retry_count + 1, error_code = NULL,
           error_message = NULL, result_json = NULL, validation_json = NULL,
           usage_json = NULL, selected_route = NULL, lease_owner = NULL,
           lease_expires_at = NULL, started_at = NULL, completed_at = NULL
       WHERE id = ?`,
    ).run(jobId);
    return requireJob(jobId);
  }

  function requireJob(jobId: string): Promise<IntelligenceJob> {
    const row = db
      .prepare("SELECT * FROM intelligence_jobs WHERE id = ?")
      .get(jobId) as IntelligenceJobRow | undefined;
    if (!row) {
      throw new Error(`Arcadia Intelligence job not found: ${jobId}`);
    }
    return Promise.resolve(rowToJob(row));
  }

  return {
    findById,
    findByIdempotencyKey,
    createQueuedJob,
    claimNextQueuedJob,
    completeJob,
    failJob,
    blockJob,
    retryJob,
  };
}
