import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import PQueue from "p-queue";
import { nowIso } from "../../utils/time.js";
import type { IntelligenceArtifactStore } from "../artifacts/store.js";
import {
  CodexImageExecutionBlockedError,
  CodexImageExecutionFailedError,
  type CodexImageExecutor,
} from "../codex/imageExecutor.js";
import {
  CodexTextExecutionBlockedError,
  CodexTextExecutionFailedError,
  type CodexTextExecutor,
} from "../codex/textExecutor.js";
import {
  ComfyUiExecutionBlockedError,
  ComfyUiExecutionFailedError,
  type ComfyUiImageExecutor,
} from "../comfyui/imageExecutor.js";
import { resolveIntelligenceSchedulerConfig } from "../config/defaults.js";
import type {
  IntelligenceResourceGroup,
  IntelligenceSchedulerConfig,
  IntelligenceV01Config,
} from "../config/types.js";
import {
  IntelligenceJobLeaseLostError,
  type ClaimedIntelligenceJob,
  type IntelligenceJobRepository,
} from "../db/repository.js";
import { LiteLlmUnavailableError } from "../litellm/httpClient.js";
import type { LiteLlmClient } from "../litellm/client.js";
import { resolveIntelligenceRoute, type ResolvedIntelligenceRoute } from "../routing/resolveRoute.js";
import {
  SpeechGenerationError,
  SpeechUnavailableError,
  type SpeechClient,
} from "../speech/client.js";
import { parseWavMetadata } from "../speech/wavMeta.js";
import { UnknownVoiceError, resolveVoice } from "../speech/voices.js";
import { validateOutput } from "../validation/validateOutput.js";
import { resolveIntelligenceResourceGroup } from "./resourceGroup.js";
import type {
  IntelligenceArtifactRecord,
  IntelligenceJob,
  IntelligenceUsage,
  JsonValue,
} from "../types.js";

/**
 * In-process worker for Arcadia Intelligence v0.1.
 *
 * Claims durable SQLite jobs only when their bounded resource pool has
 * capacity, renews each active lease, resolves its
 * capability/execution/profile to exactly one configured execution route
 * (see resolveIntelligenceRoute), executes it, validates the result against
 * the app-supplied JSON Schema, and persists a terminal status. There is no
 * external queue, no provider SDK, and no automatic fallback or escalation
 * if resolution fails — that becomes a typed "blocked" job instead.
 */
export class IntelligenceWorker {
  private readonly workerId: string;
  private readonly schedulerConfig: IntelligenceSchedulerConfig;
  private readonly queues: Map<IntelligenceResourceGroup, PQueue>;
  private dispatchTimer: NodeJS.Timeout | undefined;
  private dispatching = false;
  private stopped = true;

  public constructor(
    private readonly _repository: IntelligenceJobRepository,
    private readonly _liteLlmClient: LiteLlmClient,
    private readonly _config: IntelligenceV01Config,
    private readonly _artifactStore?: IntelligenceArtifactStore,
    private readonly _codexImageExecutor?: CodexImageExecutor,
    private readonly _codexTextExecutor?: CodexTextExecutor,
    private readonly _speechClient?: SpeechClient,
    private readonly _comfyUiImageExecutor?: ComfyUiImageExecutor,
    workerId: string = randomUUID(),
  ) {
    this.workerId = workerId;
    this.schedulerConfig = resolveIntelligenceSchedulerConfig(_config);
    this.queues = new Map(
      Object.entries(this.schedulerConfig.pools).map(([group, pool]) => [
        group as IntelligenceResourceGroup,
        new PQueue({ concurrency: pool.concurrency }),
      ]),
    );
  }

  /**
   * Claims and executes at most one job. Returns the job's final state, or
   * undefined if no job was available to claim.
   */
  public async runOnce(): Promise<IntelligenceJob | undefined> {
    const claimed = await this._repository.claimNextQueuedJob(
      this.workerId,
      nowIso(),
      this._config.leaseDurationMs,
    );
    if (!claimed) {
      return undefined;
    }

    return this.executeClaimedJob(claimed);
  }

  private resolveJobRoute(job: IntelligenceJob) {
    return resolveIntelligenceRoute(
      {
        capability: job.request.capability,
        execution: job.request.execution,
        profile: job.request.profile,
        executionTarget: job.request.executionTarget,
      },
      this._config.routes,
      { allowPaidUsage: job.request.executionPolicy.allowPaidUsage },
    );
  }

  private async executeClaimedJob(
    claimed: ClaimedIntelligenceJob,
    preResolved?: ReturnType<typeof resolveIntelligenceRoute>,
  ): Promise<IntelligenceJob> {
    const heartbeatIntervalMs = Math.max(5, Math.floor(this._config.leaseDurationMs / 3));
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this._repository.renewJobLease(
        claimed.job.id,
        claimed.lease,
        nowIso(),
        this._config.leaseDurationMs,
      ).catch(() => false).finally(() => {
        renewing = false;
      });
    }, heartbeatIntervalMs);

    try {
      return await this.executeClaimedAttempt(claimed, preResolved);
    } catch (error) {
      if (error instanceof IntelligenceJobLeaseLostError) {
        return (await this._repository.findById(claimed.job.id)) ?? claimed.job;
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async executeClaimedAttempt(
    claimed: ClaimedIntelligenceJob,
    preResolved?: ReturnType<typeof resolveIntelligenceRoute>,
  ): Promise<IntelligenceJob> {
    const { job, lease } = claimed;

    const startedAt = Date.now();
    const resolution = preResolved ?? this.resolveJobRoute(job);

    if (!resolution.ok) {
      return this._repository.blockJob(
        job.id,
        { code: resolution.code.toUpperCase(), message: resolution.message },
        nowIso(),
        lease,
      );
    }

    try {
      const { output, usage } = job.request.capability === "audio.speech.generate"
        ? await this.executeSpeechJob(job, resolution.route)
        : job.request.capability.startsWith("image.")
          ? await this.executeImageJob(job, resolution.route)
          : resolution.route.executor === "codex-cli"
            ? await this.executeCodexTextJob(job)
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
          lease,
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
      }, lease);
    } catch (error) {
      if (error instanceof IntelligenceJobLeaseLostError) {
        throw error;
      }
      if (error instanceof LiteLlmUnavailableError) {
        return this._repository.blockJob(
          job.id,
          { code: "LITELLM_UNAVAILABLE", message: error.message },
          nowIso(),
          lease,
        );
      }
      if (error instanceof SpeechUnavailableError) {
        return this._repository.blockJob(
          job.id,
          { code: "SPEECH_UNAVAILABLE", message: error.message },
          nowIso(),
          lease,
        );
      }
      if (error instanceof SpeechGenerationError) {
        return this._repository.failJob(
          job.id,
          { code: error.code, message: error.message },
          nowIso(),
          lease,
        );
      }
      if (
        error instanceof CodexImageExecutionBlockedError ||
        error instanceof CodexTextExecutionBlockedError ||
        error instanceof ComfyUiExecutionBlockedError
      ) {
        return this._repository.blockJob(
          job.id,
          { code: error.code, message: error.message },
          nowIso(),
          lease,
        );
      }
      if (
        error instanceof CodexImageExecutionFailedError ||
        error instanceof CodexTextExecutionFailedError ||
        error instanceof ComfyUiExecutionFailedError
      ) {
        return this._repository.failJob(
          job.id,
          { code: error.code, message: error.message },
          nowIso(),
          lease,
        );
      }

      return this._repository.failJob(
        job.id,
        {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
        nowIso(),
        lease,
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

  private async executeCodexTextJob(
    job: IntelligenceJob,
  ): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
    if (!this._codexTextExecutor) {
      throw new CodexTextExecutionBlockedError(
        "CODEX_CLI_UNAVAILABLE",
        "Arcadia Intelligence has no Codex text executor configured.",
      );
    }
    return this._codexTextExecutor.execute(job);
  }

  private async executeImageJob(
    job: IntelligenceJob,
    route: ResolvedIntelligenceRoute,
  ): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
    if (route.executor === "codex-cli") {
      if (!this._codexImageExecutor) {
        throw new CodexImageExecutionBlockedError(
          "CODEX_CLI_UNAVAILABLE",
          "Arcadia Intelligence has no Codex image executor configured.",
        );
      }
      return this._codexImageExecutor.execute(job);
    }

    if (route.executor === "comfyui") {
      if (!this._comfyUiImageExecutor) {
        throw new ComfyUiExecutionBlockedError(
          "COMFYUI_UNAVAILABLE",
          "Arcadia Intelligence has no ComfyUI image executor configured.",
        );
      }
      return this._comfyUiImageExecutor.execute(job);
    }

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

  private async executeSpeechJob(
    job: IntelligenceJob,
    route: ResolvedIntelligenceRoute,
  ): Promise<{ output: JsonValue; usage?: IntelligenceUsage }> {
    if (!this._speechClient) {
      throw new SpeechUnavailableError(
        "Arcadia Intelligence has no speech client configured for audio.speech.generate.",
      );
    }
    if (!this._artifactStore) {
      throw new SpeechUnavailableError(
        "Arcadia Intelligence has no artifact store configured for speech generation.",
      );
    }

    const speechConfig = this._config.speech;
    // Speech is a LiteLLM-routed capability like text/image: both local and
    // cloud go through the same proxy, distinguished only by which LiteLLM
    // model alias (route.liteLlmRoute) the route resolves to.
    const baseUrl = this._config.liteLlmBaseUrl;

    const input = parseSpeechInput(job.request.input);
    let voice: string;
    try {
      voice = resolveVoice(input.voiceId, speechConfig?.voiceMap ?? {});
    } catch (error) {
      if (error instanceof UnknownVoiceError) {
        throw new SpeechGenerationError("SPEECH_UNKNOWN_VOICE", error.message);
      }
      throw error;
    }

    const generation = await this._speechClient.generateSpeech(
      {
        text: input.text,
        voice,
        format: input.format,
        speed: input.speed,
        language: input.language,
        instructions: input.instructions,
      },
      route.liteLlmRoute,
      baseUrl,
    );

    // Deterministic inspection happens before any bytes are persisted: an
    // undecodable payload fails the job and never becomes an artifact.
    const metadata = parseWavMetadata(generation.bytes);
    if (!metadata) {
      throw new SpeechGenerationError(
        "SPEECH_UNDECODABLE_AUDIO",
        "Generated audio could not be decoded as WAV; its duration and sample metadata are unavailable.",
      );
    }

    const artifact = await this._artifactStore.saveAudioBytes({
      jobId: job.id,
      bytes: generation.bytes,
      format: input.format,
      durationSeconds: metadata.durationSeconds,
      sampleRateHz: metadata.sampleRateHz,
      channels: metadata.channels,
      metadata: { voiceId: input.voiceId },
    });

    const usage: IntelligenceUsage = {
      provider: generation.provider,
      ...(generation.model ? { model: generation.model } : {}),
      ...(route.location === "local" ? { estimatedCostUsd: 0 } : {}),
    };

    const output: JsonValue = {
      artifact: artifact as unknown as JsonValue,
      voiceId: input.voiceId,
      routeId: route.routeId,
      provider: generation.provider,
      ...(generation.model ? { model: generation.model } : {}),
      usage: {
        routeId: route.routeId,
        modelRoute: route.liteLlmRoute,
        provider: generation.provider,
        ...(generation.model ? { model: generation.model } : {}),
        ...(route.location === "local" ? { estimatedCostUsd: 0 } : {}),
      },
      createdAt: nowIso(),
    };

    // Make it obvious in logs whether this used a free local route or a paid
    // cloud route.
    process.stdout.write(
      `[intelligence] audio.speech.generate job ${job.id} produced ${artifact.byteSize}B ` +
        `${artifact.format ?? "audio"} via ${route.location === "local" ? "LOCAL" : "PAID CLOUD"} ` +
        `route ${route.routeId} (provider ${generation.provider})\n`,
    );

    return { output, usage };
  }

  /** Starts bounded dispatch and returns a function that stops new claims. */
  public start(options: { heartbeatPath?: string } = {}): () => void {
    if (!this.stopped) {
      throw new Error("Arcadia Intelligence worker is already running.");
    }
    this.stopped = false;
    const heartbeatPath = options.heartbeatPath;
    const writeHeartbeat = (): void => {
      if (!heartbeatPath) return;
      try {
        mkdirSync(path.dirname(heartbeatPath), { recursive: true });
        writeFileSync(heartbeatPath, new Date().toISOString(), "utf8");
      } catch {
        // Health reporting must never stop job processing.
      }
    };

    writeHeartbeat();
    const heartbeatTimer = heartbeatPath ? setInterval(writeHeartbeat, 5_000) : undefined;
    this.scheduleDispatch(0, writeHeartbeat);

    return () => {
      this.stopped = true;
      if (this.dispatchTimer) {
        clearTimeout(this.dispatchTimer);
        this.dispatchTimer = undefined;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (heartbeatPath) {
        try { unlinkSync(heartbeatPath); } catch {}
      }
    };
  }

  /** Wakes a running worker after submission/retry instead of waiting for polling. */
  public wake(): void {
    this.scheduleDispatch(0);
  }

  /** Waits for the current dispatch pass and all already-claimed work. */
  public async onIdle(): Promise<void> {
    while (this.dispatching) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    await Promise.all([...this.queues.values()].map((queue) => queue.onIdle()));
  }

  public getSchedulerSummary(): {
    dispatching: boolean;
    pools: Record<string, { concurrency: number; active: number; waiting: number }>;
  } {
    return {
      dispatching: this.dispatching,
      pools: Object.fromEntries(
        [...this.queues.entries()].map(([group, queue]) => [
          group,
          {
            concurrency: this.schedulerConfig.pools[group].concurrency,
            active: queue.pending,
            waiting: queue.size,
          },
        ]),
      ),
    };
  }

  private scheduleDispatch(delayMs: number, writeHeartbeat?: () => void): void {
    if (this.stopped) return;
    if (this.dispatchTimer) {
      if (delayMs > 0) return;
      clearTimeout(this.dispatchTimer);
    }
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = undefined;
      void this.dispatchAvailable(writeHeartbeat);
    }, delayMs);
  }

  private async dispatchAvailable(writeHeartbeat?: () => void): Promise<void> {
    if (this.stopped || this.dispatching) return;
    this.dispatching = true;

    try {
      const candidates = await this._repository.listClaimableJobs(
        nowIso(),
        this.schedulerConfig.scanLimit,
      );

      for (const candidate of candidates) {
        if (this.stopped) break;
        const resolution = this.resolveJobRoute(candidate);

        if (!resolution.ok) {
          const claimed = await this._repository.claimJob(
            candidate.id,
            this.workerId,
            nowIso(),
            this._config.leaseDurationMs,
          );
          if (claimed) {
            await this.executeClaimedJob(claimed, resolution);
          }
          continue;
        }

        const group = resolveIntelligenceResourceGroup(resolution.route);
        const queue = this.queues.get(group);
        if (!queue) {
          throw new Error(`Arcadia Intelligence scheduler pool is missing: ${group}`);
        }
        if (queue.pending >= this.schedulerConfig.pools[group].concurrency || queue.size > 0) {
          continue;
        }

        const claimed = await this._repository.claimJob(
          candidate.id,
          this.workerId,
          nowIso(),
          this._config.leaseDurationMs,
        );
        if (!claimed) continue;

        void queue.add(async () => {
          await this.executeClaimedJob(claimed, resolution);
        }).catch(() => {
          // Job-level failures are persisted by executeClaimedJob. A queue
          // task rejection must not stop other resource groups.
        }).finally(() => {
          writeHeartbeat?.();
          this.scheduleDispatch(0, writeHeartbeat);
        });
      }
    } catch {
      // A dispatch-level failure is retried on the next poll. Claimed jobs
      // retain their leases and are independently finalized by their tasks.
    } finally {
      this.dispatching = false;
      writeHeartbeat?.();
      this.scheduleDispatch(this._config.workerPollIntervalMs, writeHeartbeat);
    }
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

type SpeechInputFields = {
  text: string;
  voiceId: string;
  format: string;
  speed?: number;
  language?: string;
  instructions?: string;
};

/**
 * Reads and validates the speech options from a request's `input`. The API
 * layer already validates this shape (see api/server.ts), but the worker
 * re-checks defensively — a raw request could reach the worker without passing
 * through the HTTP validator. `format` defaults to "wav" (the only supported
 * format this milestone).
 */
function parseSpeechInput(input: JsonValue): SpeechInputFields {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SpeechGenerationError(
      "SPEECH_INVALID_INPUT",
      "audio.speech.generate input must be an object containing text and voiceId.",
    );
  }
  const obj = input as Record<string, JsonValue>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  const voiceId = typeof obj.voiceId === "string" ? obj.voiceId.trim() : "";
  if (!text) {
    throw new SpeechGenerationError(
      "SPEECH_INVALID_INPUT",
      "audio.speech.generate requires a non-empty string input.text.",
    );
  }
  if (!voiceId) {
    throw new SpeechGenerationError(
      "SPEECH_INVALID_INPUT",
      "audio.speech.generate requires a non-empty string input.voiceId.",
    );
  }
  const format =
    typeof obj.format === "string" && obj.format.trim().length > 0 ? obj.format.trim() : "wav";
  if (format !== "wav") {
    throw new SpeechGenerationError(
      "SPEECH_INVALID_INPUT",
      `audio.speech.generate input.format "${format}" is not supported. Only "wav" is supported.`,
    );
  }
  return {
    text,
    voiceId,
    format,
    speed: typeof obj.speed === "number" ? obj.speed : undefined,
    language: typeof obj.language === "string" ? obj.language : undefined,
    instructions: typeof obj.instructions === "string" ? obj.instructions : undefined,
  };
}
