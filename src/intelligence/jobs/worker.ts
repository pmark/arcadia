import { randomUUID } from "node:crypto";
import { nowIso } from "../../utils/time.js";
import type { IntelligenceArtifactStore } from "../artifacts/store.js";
import type { IntelligenceV01Config } from "../config/types.js";
import type { IntelligenceJobRepository } from "../db/repository.js";
import { LiteLlmUnavailableError } from "../litellm/httpClient.js";
import type { LiteLlmClient } from "../litellm/client.js";
import { resolveIntelligenceRoute, type ResolvedIntelligenceRoute } from "../routing/resolveRoute.js";
import { validateOutput } from "../validation/validateOutput.js";
import type {
  IntelligenceArtifactRecord,
  IntelligenceJob,
  IntelligenceUsage,
  JsonValue,
} from "../types.js";

/**
 * In-process worker for Arcadia Intelligence v0.1.
 *
 * Claims one durable SQLite job at a time via a lease (see
 * IntelligenceJobRepository.claimNextQueuedJob), resolves its
 * capability/execution/profile to exactly one configured LiteLLM route (see
 * resolveIntelligenceRoute), executes it, validates the result against the
 * app-supplied JSON Schema, and persists a terminal status. There is no
 * external queue, no multiple executors, no provider SDK, and no automatic
 * fallback or escalation if resolution fails — that becomes a typed
 * "blocked" job instead.
 */
export class IntelligenceWorker {
  private readonly workerId: string;

  public constructor(
    private readonly _repository: IntelligenceJobRepository,
    private readonly _liteLlmClient: LiteLlmClient,
    private readonly _config: IntelligenceV01Config,
    private readonly _artifactStore?: IntelligenceArtifactStore,
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

    const startedAt = Date.now();

    const resolution = resolveIntelligenceRoute(
      {
        capability: job.request.capability,
        execution: job.request.execution,
        profile: job.request.profile,
      },
      this._config.routes,
      { allowPaidUsage: job.request.executionPolicy.allowPaidUsage },
    );

    if (!resolution.ok) {
      return this._repository.blockJob(
        job.id,
        { code: resolution.code.toUpperCase(), message: resolution.message },
        nowIso(),
      );
    }

    try {
      const { output, usage } = job.request.capability.startsWith("image.")
        ? await this.executeImageJob(job, resolution.route)
        : await this.executeTextJob(job, resolution.route);

      const validation = await validateOutput(output, job.request.outputContract);
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
        result: output,
        validation,
        usage: {
          ...usage,
          routeId: resolution.route.routeId,
          modelRoute: resolution.route.liteLlmRoute,
          durationMs: Date.now() - startedAt,
        },
        selectedRoute: resolution.route.liteLlmRoute,
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

  private async executeTextJob(
    job: IntelligenceJob,
    route: ResolvedIntelligenceRoute,
  ): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
    const execution = await this._liteLlmClient.generateStructured(job.request, route.liteLlmRoute);
    return { output: execution.output, usage: execution.usage };
  }

  private async executeImageJob(
    job: IntelligenceJob,
    route: ResolvedIntelligenceRoute,
  ): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
    if (!this._artifactStore) {
      throw new LiteLlmUnavailableError(
        "Arcadia Intelligence has no artifact store configured for image generation.",
      );
    }

    const generation = await this._liteLlmClient.generateImage(job.request, route.liteLlmRoute);
    const artifacts: IntelligenceArtifactRecord[] = [];
    for (const image of generation.images) {
      const metadata: Record<string, JsonValue> = {};
      if (image.seed !== undefined) {
        metadata.seed = image.seed;
      }
      if (image.revisedPrompt !== undefined) {
        metadata.revisedPrompt = image.revisedPrompt;
      }
      artifacts.push(
        await this._artifactStore.saveImageBytes({
          jobId: job.id,
          bytes: image.bytes,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        }),
      );
    }

    const requestedCount = requestedImageCount(job.request.input);
    const output: JsonValue = {
      artifacts: artifacts as unknown as JsonValue,
      generation: { requestedCount: requestedCount ?? artifacts.length, returnedCount: artifacts.length },
    };

    return { output, usage: generation.usage };
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

function requestedImageCount(input: JsonValue): number | undefined {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const n = (input as Record<string, JsonValue>).n;
    if (typeof n === "number" && Number.isInteger(n)) {
      return n;
    }
  }
  return undefined;
}
