import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
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
import type { IntelligenceV01Config } from "../config/types.js";
import type { IntelligenceJobRepository } from "../db/repository.js";
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
 * capability/execution/profile to exactly one configured execution route
 * (see resolveIntelligenceRoute), executes it, validates the result against
 * the app-supplied JSON Schema, and persists a terminal status. There is no
 * external queue, no provider SDK, and no automatic fallback or escalation
 * if resolution fails — that becomes a typed "blocked" job instead.
 */
export class IntelligenceWorker {
  private readonly workerId: string;

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
        executionTarget: job.request.executionTarget,
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
      if (error instanceof SpeechUnavailableError) {
        return this._repository.blockJob(
          job.id,
          { code: "SPEECH_UNAVAILABLE", message: error.message },
          nowIso(),
        );
      }
      if (error instanceof SpeechGenerationError) {
        return this._repository.failJob(
          job.id,
          { code: error.code, message: error.message },
          nowIso(),
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

  /**
   * Starts the polling loop and returns a function that stops it.
   */
  public start(options: { heartbeatPath?: string } = {}): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
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
          writeHeartbeat();
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
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (heartbeatPath) {
        try { unlinkSync(heartbeatPath); } catch {}
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
