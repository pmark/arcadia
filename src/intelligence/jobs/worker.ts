import { randomUUID } from "node:crypto";
import { nowIso } from "../../utils/time.js";
import type { IntelligenceV01Config } from "../config/types.js";
import type { IntelligenceJobRepository } from "../db/repository.js";
import { LiteLlmUnavailableError } from "../litellm/httpClient.js";
import type { LiteLlmClient } from "../litellm/client.js";
import { validateOutput } from "../validation/validateOutput.js";
import type { IntelligenceJob } from "../types.js";

/**
 * In-process worker for Arcadia Intelligence v0.1.
 *
 * Claims one durable SQLite job at a time via a lease (see
 * IntelligenceJobRepository.claimNextQueuedJob), executes it against the
 * single configured LiteLLM route, validates the result against the
 * app-supplied JSON Schema, and persists a terminal status. There is no
 * external queue, no multiple executors, and no provider SDK.
 */
export class IntelligenceWorker {
  private readonly workerId: string;

  public constructor(
    private readonly _repository: IntelligenceJobRepository,
    private readonly _liteLlmClient: LiteLlmClient,
    private readonly _config: IntelligenceV01Config,
    workerId: string = randomUUID(),
  ) {
    this.workerId = workerId;
  }

  /**
   * Claims and executes at most one job. Returns the job's final state, or
   * undefined if no job was available to claim.
   */
  public async runOnce(): Promise<IntelligenceJob | undefined> {
    const job = await this._repository.claimNextQueuedJob(
      this.workerId,
      nowIso(),
      this._config.leaseDurationMs,
    );
    if (!job) {
      return undefined;
    }

    const route = this._config.defaultLiteLlmRoute;
    const startedAt = Date.now();

    try {
      const execution = await this._liteLlmClient.generateStructured(job.request, route);
      const validation = await validateOutput(execution.output, job.request.outputContract);

      if (!validation.passed) {
        return this._repository.failJob(
          job.id,
          {
            code: "VALIDATION_FAILED",
            message:
              validation.errors?.join("; ") ??
              "LiteLLM output failed validation against the app-supplied JSON Schema.",
          },
          nowIso(),
        );
      }

      return this._repository.completeJob(job.id, {
        result: execution.output,
        validation,
        usage: {
          ...execution.usage,
          modelRoute: route,
          durationMs: Date.now() - startedAt,
        },
        selectedRoute: route,
        completedAt: nowIso(),
      });
    } catch (error) {
      if (error instanceof LiteLlmUnavailableError) {
        return this._repository.blockJob(
          job.id,
          { code: "LITELLM_UNAVAILABLE", message: error.message },
          nowIso(),
        );
      }

      return this._repository.failJob(
        job.id,
        {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
        nowIso(),
      );
    }
  }

  /**
   * Starts the polling loop and returns a function that stops it.
   */
  public start(): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const tick = (): void => {
      if (stopped) {
        return;
      }

      this.runOnce()
        .catch(() => {
          // A single tick's failure should not stop the loop; job-level
          // errors are already persisted as failed/blocked by runOnce.
        })
        .finally(() => {
          if (!stopped) {
            timer = setTimeout(tick, this._config.workerPollIntervalMs);
          }
        });
    };

    timer = setTimeout(tick, 0);

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }
}
