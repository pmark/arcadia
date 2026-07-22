import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createId } from "../../utils/id.js";
import { nowIso } from "../../utils/time.js";
import {
  IntelligenceJobLeaseLostError,
  type ClaimedIntelligenceJob,
  type IntelligenceJobLease,
  type IntelligenceJobRepository,
  type IntelligenceOperationalSummary,
} from "./repository.js";
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
  operation_id: string;
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
  lease_token: string | null;
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
      operation_id: request.operationId,
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
      lease_token: null,
      lease_expires_at: null,
      created_at: timestamp,
      started_at: null,
      completed_at: null,
    };

    db.prepare(
      `INSERT INTO intelligence_jobs (
        id, idempotency_key, operation_id, client_app, project_id, mission_id, request_json,
        status, selected_route, result_json, validation_json, usage_json, error_code,
        error_message, retry_count, lease_owner, lease_token, lease_expires_at, created_at, started_at,
        completed_at
      ) VALUES (
        @id, @idempotency_key, @operation_id, @client_app, @project_id, @mission_id, @request_json,
        @status, @selected_route, @result_json, @validation_json, @usage_json, @error_code,
        @error_message, @retry_count, @lease_owner, @lease_token, @lease_expires_at, @created_at, @started_at,
        @completed_at
      )`,
    ).run(row);

    return Promise.resolve(rowToJob(row));
  }

  function claimNextQueuedJob(
    workerId: string,
    nowIsoValue: string,
    leaseDurationMs: number,
  ): Promise<ClaimedIntelligenceJob | undefined> {
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

      return claimCandidate(candidate.id, workerId, nowIsoValue, leaseDurationMs);
    })();

    return Promise.resolve(claimed);
  }

  function listClaimableJobs(nowIsoValue: string, limit: number): Promise<IntelligenceJob[]> {
    const rows = db.prepare(
      `SELECT * FROM intelligence_jobs
       WHERE status = 'queued'
          OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?))
       ORDER BY created_at ASC, rowid ASC
       LIMIT ?`,
    ).all(nowIsoValue, Math.max(1, Math.floor(limit))) as IntelligenceJobRow[];
    return Promise.resolve(rows.map(rowToJob));
  }

  function claimJob(
    jobId: string,
    workerId: string,
    nowIsoValue: string,
    leaseDurationMs: number,
  ): Promise<ClaimedIntelligenceJob | undefined> {
    const claimed = db.transaction(() =>
      claimCandidate(jobId, workerId, nowIsoValue, leaseDurationMs)
    )();
    return Promise.resolve(claimed);
  }

  function claimCandidate(
    jobId: string,
    workerId: string,
    nowIsoValue: string,
    leaseDurationMs: number,
  ): ClaimedIntelligenceJob | undefined {
    const lease: IntelligenceJobLease = { workerId, token: randomUUID() };
    const leaseExpiresAt = new Date(Date.parse(nowIsoValue) + leaseDurationMs).toISOString();
    const result = db.prepare(
      `UPDATE intelligence_jobs
       SET status = 'running', lease_owner = ?, lease_token = ?, lease_expires_at = ?,
           started_at = COALESCE(started_at, ?)
       WHERE id = ?
         AND (status = 'queued'
           OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)))`,
    ).run(workerId, lease.token, leaseExpiresAt, nowIsoValue, jobId, nowIsoValue);
    if (result.changes !== 1) {
      return undefined;
    }
    const row = db.prepare("SELECT * FROM intelligence_jobs WHERE id = ?").get(jobId) as IntelligenceJobRow;
    return { job: rowToJob(row), lease };
  }

  function renewJobLease(
    jobId: string,
    lease: IntelligenceJobLease,
    nowIsoValue: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    const leaseExpiresAt = new Date(Date.parse(nowIsoValue) + leaseDurationMs).toISOString();
    const result = db.prepare(
      `UPDATE intelligence_jobs SET lease_expires_at = ?
       WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_token = ?`,
    ).run(leaseExpiresAt, jobId, lease.workerId, lease.token);
    return Promise.resolve(result.changes === 1);
  }

  async function completeJob(
    jobId: string,
    update: Pick<
      IntelligenceJob,
      "result" | "validation" | "usage" | "selectedRoute" | "completedAt"
    >,
    lease: IntelligenceJobLease,
  ): Promise<IntelligenceJob> {
    const result = db.prepare(
      `UPDATE intelligence_jobs
       SET status = 'completed', result_json = ?, validation_json = ?, usage_json = ?,
           selected_route = ?, completed_at = ?, lease_owner = NULL, lease_token = NULL,
           lease_expires_at = NULL
       WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_token = ?`,
    ).run(
      JSON.stringify(update.result ?? null),
      JSON.stringify(update.validation ?? null),
      JSON.stringify(update.usage ?? null),
      update.selectedRoute ?? null,
      update.completedAt,
      jobId,
      lease.workerId,
      lease.token,
    );
    assertLeaseHeld(jobId, result.changes);
    return requireJob(jobId);
  }

  function failJob(
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
    lease: IntelligenceJobLease,
  ): Promise<IntelligenceJob> {
    return finalizeWithError("failed", jobId, error, completedAt, lease);
  }

  function blockJob(
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
    lease: IntelligenceJobLease,
  ): Promise<IntelligenceJob> {
    return finalizeWithError("blocked", jobId, error, completedAt, lease);
  }

  async function finalizeWithError(
    status: "failed" | "blocked",
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
    lease: IntelligenceJobLease,
  ): Promise<IntelligenceJob> {
    const result = db.prepare(
      `UPDATE intelligence_jobs
       SET status = ?, error_code = ?, error_message = ?, completed_at = ?,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
       WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_token = ?`,
    ).run(status, error.code, error.message, completedAt, jobId, lease.workerId, lease.token);
    assertLeaseHeld(jobId, result.changes);
    return requireJob(jobId);
  }

  function assertLeaseHeld(
    jobId: string,
    changes: number,
  ): void {
    if (changes !== 1) {
      throw new IntelligenceJobLeaseLostError(jobId);
    }
  }

  function retryJob(jobId: string, _nowIso: string): Promise<IntelligenceJob> {
    db.prepare(
      `UPDATE intelligence_jobs
       SET status = 'queued', retry_count = retry_count + 1, error_code = NULL,
           error_message = NULL, result_json = NULL, validation_json = NULL,
           usage_json = NULL, selected_route = NULL, lease_owner = NULL, lease_token = NULL,
           lease_expires_at = NULL, started_at = NULL, completed_at = NULL
       WHERE id = ?`,
    ).run(jobId);
    return requireJob(jobId);
  }

  function listRecentByClientApp(
    clientApp: string,
    limit: number,
  ): Promise<IntelligenceJob[]> {
    const rows = db
      .prepare(
        `SELECT * FROM intelligence_jobs WHERE client_app = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(clientApp, limit) as IntelligenceJobRow[];
    return Promise.resolve(rows.map(rowToJob));
  }

  function listCreatedSince(sinceIso: string): Promise<IntelligenceJob[]> {
    const rows = db
      .prepare(
        `SELECT * FROM intelligence_jobs
         WHERE created_at >= ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sinceIso) as IntelligenceJobRow[];
    return Promise.resolve(rows.map(rowToJob));
  }

  function getOperationalSummary(): Promise<IntelligenceOperationalSummary> {
    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_count,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS active_count,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
         FROM intelligence_jobs`,
      )
      .get() as { queued_count: number | null; active_count: number | null; failed_count: number | null };
    const lastSuccessful = db
      .prepare(
        `SELECT completed_at
         FROM intelligence_jobs
         WHERE status = 'completed' AND completed_at IS NOT NULL
         ORDER BY completed_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get() as { completed_at: string } | undefined;

    return Promise.resolve({
      queuedCount: counts.queued_count ?? 0,
      activeCount: counts.active_count ?? 0,
      failedCount: counts.failed_count ?? 0,
      lastSuccessfulRequest: lastSuccessful?.completed_at ?? null,
    });
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
    listClaimableJobs,
    claimJob,
    renewJobLease,
    completeJob,
    failJob,
    blockJob,
    retryJob,
    listRecentByClientApp,
    listCreatedSince,
    getOperationalSummary,
  };
}
