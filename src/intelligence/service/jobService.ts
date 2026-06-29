import { nowIso } from "../../utils/time.js";
import type { IntelligenceJobRepository } from "../db/repository.js";
import { validateRequirements } from "../validation/validateRequirements.js";
import type {
  IntelligenceJob,
  IntelligenceRequest,
  SubmitIntelligenceRequestResponse,
} from "../types.js";

export class RetryNotAllowedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RetryNotAllowedError";
  }
}

export class IntelligenceJobNotFoundError extends Error {
  public constructor(public readonly jobId: string) {
    super(`Arcadia Intelligence job not found: ${jobId}`);
    this.name = "IntelligenceJobNotFoundError";
  }
}

export class RequirementsNotSupportedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RequirementsNotSupportedError";
  }
}

/**
 * Submits a companion-app request as a durable queued job. If a job already
 * exists for the given idempotency key, that job is returned unchanged
 * instead of creating a duplicate.
 */
export async function submitIntelligenceRequest(
  repository: IntelligenceJobRepository,
  request: IntelligenceRequest,
): Promise<SubmitIntelligenceRequestResponse> {
  const requirementsError = validateRequirements(request);
  if (requirementsError) {
    throw new RequirementsNotSupportedError(requirementsError);
  }

  const existing = await repository.findByIdempotencyKey(request.idempotencyKey);
  if (existing) {
    return { job: existing, created: false };
  }

  try {
    const job = await repository.createQueuedJob(request);
    return { job, created: true };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const racedJob = await repository.findByIdempotencyKey(request.idempotencyKey);
      if (racedJob) {
        return { job: racedJob, created: false };
      }
    }
    throw error;
  }
}

/**
 * Retries a failed or blocked job, enforcing the v0.1 one-retry-maximum rule.
 */
export async function retryIntelligenceJob(
  repository: IntelligenceJobRepository,
  jobId: string,
  maxRetries: number,
): Promise<IntelligenceJob> {
  const job = await repository.findById(jobId);
  if (!job) {
    throw new IntelligenceJobNotFoundError(jobId);
  }

  if (job.status !== "failed" && job.status !== "blocked") {
    throw new RetryNotAllowedError(
      `Job ${jobId} cannot be retried while its status is "${job.status}".`,
    );
  }

  if (job.retryCount >= maxRetries) {
    throw new RetryNotAllowedError(
      `Job ${jobId} has already used its retry (max ${maxRetries}).`,
    );
  }

  return repository.retryJob(jobId, nowIso());
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    String((error as { code?: unknown }).code).startsWith("SQLITE_CONSTRAINT")
  );
}
