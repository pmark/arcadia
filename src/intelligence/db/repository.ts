import type {
  IntelligenceJob,
  IntelligenceRequest,
} from "../types.js";

/**
 * Storage seam only.
 *
 * Codex should implement this using Arcadia's existing SQLite access pattern.
 * Do not introduce a second ORM or a separate database unless the existing
 * repository structure makes that necessary.
 */
export interface IntelligenceJobRepository {
  findById(jobId: string): Promise<IntelligenceJob | undefined>;

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<IntelligenceJob | undefined>;

  createQueuedJob(request: IntelligenceRequest): Promise<IntelligenceJob>;

  claimNextQueuedJob(
    workerId: string,
    nowIso: string,
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

  retryJob(jobId: string, nowIso: string): Promise<IntelligenceJob>;
}
