import type {
  IntelligenceJob,
  IntelligenceRequest,
} from "../types.js";

export interface IntelligenceOperationalSummary {
  queuedCount: number;
  activeCount: number;
  failedCount: number;
  lastSuccessfulRequest: string | null;
}

/**
 * Storage seam, implemented by ./sqliteRepository.ts against the shared
 * Arcadia workspace database (see ../../db/connection.js and
 * ../../db/schema.js). There is no second ORM or separate database.
 */
export interface IntelligenceJobRepository {
  findById(jobId: string): Promise<IntelligenceJob | undefined>;

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<IntelligenceJob | undefined>;

  createQueuedJob(request: IntelligenceRequest): Promise<IntelligenceJob>;

  /**
   * Claims the oldest job that is queued, or whose worker lease has expired,
   * for the given workerId. This is what makes job execution restart-safe:
   * a crashed worker's lease expires and another worker can reclaim the job.
   */
  claimNextQueuedJob(
    workerId: string,
    nowIso: string,
    leaseDurationMs: number,
  ): Promise<IntelligenceJob | undefined>;

  completeJob(
    jobId: string,
    update: Pick<
      IntelligenceJob,
      "result" | "validation" | "usage" | "selectedRoute" | "completedAt"
    >,
  ): Promise<IntelligenceJob>;

  failJob(
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
  ): Promise<IntelligenceJob>;

  blockJob(
    jobId: string,
    error: NonNullable<IntelligenceJob["error"]>,
    completedAt: string,
  ): Promise<IntelligenceJob>;

  /**
   * Resets a failed or blocked job back to queued and increments retryCount.
   * Eligibility (status, maxRetries) is enforced by the caller.
   */
  retryJob(jobId: string, nowIso: string): Promise<IntelligenceJob>;

  /**
   * Returns the most recent jobs submitted by a given clientApp, newest
   * first. Read-only history lookup (e.g. for an admin test bench); not
   * part of the companion-app HTTP API.
   */
  listRecentByClientApp(
    clientApp: string,
    limit: number,
  ): Promise<IntelligenceJob[]>;

  /**
   * Read-only operational usage lookup. Returns every job created on or
   * after the supplied timestamp, oldest first, so callers can aggregate
   * one explicit reporting period without guessing provider quotas.
   */
  listCreatedSince(sinceIso: string): Promise<IntelligenceJob[]>;

  /** Read-only counts used by the local admin Status page. */
  getOperationalSummary?: () => Promise<IntelligenceOperationalSummary>;
}
