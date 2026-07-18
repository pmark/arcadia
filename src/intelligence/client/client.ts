import type {
  IntelligenceCapability,
  IntelligenceExecutionTarget,
  IntelligenceImageGenerationResult,
  IntelligenceJob,
  IntelligenceProfile,
  IntelligenceRequest,
  IntelligenceRequirements,
  IntelligenceSpeechGenerationResult,
  JsonValue,
  OutputContract,
  PromptTemplateRef,
  RetryIntelligenceJobResponse,
  SubmitIntelligenceRequestResponse,
} from "../types.js";

export class ArcadiaUnavailableError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArcadiaUnavailableError";
  }
}

export class ArcadiaJobBlockedError extends Error {
  public constructor(
    public readonly jobId: string,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ArcadiaJobBlockedError";
  }
}

export class ArcadiaJobFailedError extends Error {
  public constructor(
    public readonly jobId: string,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ArcadiaJobFailedError";
  }
}

export class ArcadiaExecutionPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ArcadiaExecutionPolicyError";
  }
}

export type StructuredTextOperationDefinition<TOutput> = {
  operationId: string;
  clientApp: string;
  projectId?: string;
  profile: IntelligenceProfile;
  template: PromptTemplateRef;
  outputContract: OutputContract;
  parse?: (value: unknown) => TOutput;
};

export type StructuredTextRunOptions = {
  idempotencyKey: string;
  execution: IntelligenceExecutionTarget;
  allowPaidUsage?: boolean;
  maxRetries?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type StructuredTextRunResult<TOutput> = {
  result: TOutput;
  jobId: string;
};

export type OperationWaitOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export interface StructuredTextOperation<
  TInput extends JsonValue,
  TOutput,
> {
  run(
    input: TInput,
    options: StructuredTextRunOptions,
  ): Promise<StructuredTextRunResult<TOutput>>;
  retry(
    jobId: string,
    options?: OperationWaitOptions,
  ): Promise<StructuredTextRunResult<TOutput>>;
}

export type ImageGenerationOperationDefinition<TOutput> = {
  operationId: string;
  clientApp: string;
  projectId?: string;
  profile: IntelligenceProfile;
  template: PromptTemplateRef;
  outputContract: OutputContract;
  requirements?: IntelligenceRequirements;
  parse?: (value: unknown) => TOutput;
};

export interface ImageGenerationOperation<
  TInput extends JsonValue,
  TOutput = IntelligenceImageGenerationResult,
> {
  run(
    input: TInput,
    options: StructuredTextRunOptions,
  ): Promise<StructuredTextRunResult<TOutput>>;
  retry(
    jobId: string,
    options?: OperationWaitOptions,
  ): Promise<StructuredTextRunResult<TOutput>>;
}

export type SpeechGenerationOperationDefinition<TOutput> = {
  operationId: string;
  clientApp: string;
  projectId?: string;
  profile: IntelligenceProfile;
  template: PromptTemplateRef;
  outputContract: OutputContract;
  parse?: (value: unknown) => TOutput;
};

export interface SpeechGenerationOperation<
  TInput extends JsonValue,
  TOutput = IntelligenceSpeechGenerationResult,
> {
  run(
    input: TInput,
    options: StructuredTextRunOptions,
  ): Promise<StructuredTextRunResult<TOutput>>;
  retry(
    jobId: string,
    options?: OperationWaitOptions,
  ): Promise<StructuredTextRunResult<TOutput>>;
}

type IntelligenceHealthResponse = {
  liteLlm: {
    routes: Array<{
      capability: IntelligenceCapability;
      location: "local" | "cloud";
      profile: IntelligenceProfile;
      executor: "litellm" | "codex-cli" | "speech";
    }>;
  };
};

export type ArcadiaIntelligenceClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export class ArcadiaIntelligenceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: ArcadiaIntelligenceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public readonly text = {
    defineStructuredOperation: <
      TInput extends JsonValue,
      TOutput,
    >(
      definition: StructuredTextOperationDefinition<TOutput>,
    ): StructuredTextOperation<TInput, TOutput> => {
      const parse = (value: unknown): TOutput => definition.parse
        ? definition.parse(value)
        : value as TOutput;
      return {
        run: async (input, options) => {
          this.assertExecutionPolicy(options);
          return this.runOperation({
            idempotencyKey: options.idempotencyKey,
            operationId: definition.operationId,
            clientApp: definition.clientApp,
            projectId: definition.projectId,
            capability: "text.generate",
            execution: this.executionPreference(options.execution),
            executionTarget: options.execution,
            profile: definition.profile,
            input,
            requirements: { structuredOutput: true },
            outputContract: definition.outputContract,
            template: definition.template,
            executionPolicy: {
              allowPaidUsage: options.allowPaidUsage ?? false,
              maxRetries: options.maxRetries ?? 1,
            },
          }, options, parse);
        },
        retry: async (jobId, options = {}) =>
          this.retryOperation(jobId, options, parse),
      };
    },
  };

  public readonly image = {
    defineGenerationOperation: <
      TInput extends JsonValue,
      TOutput = IntelligenceImageGenerationResult,
    >(
      definition: ImageGenerationOperationDefinition<TOutput>,
    ): ImageGenerationOperation<TInput, TOutput> => {
      const parse = (value: unknown): TOutput => definition.parse
        ? definition.parse(value)
        : value as TOutput;
      return {
        run: async (input, options) => {
          this.assertExecutionPolicy(options);
          const request: IntelligenceRequest = {
            idempotencyKey: options.idempotencyKey,
            operationId: definition.operationId,
            clientApp: definition.clientApp,
            projectId: definition.projectId,
            capability: "image.generate",
            execution: this.executionPreference(options.execution),
            executionTarget: options.execution,
            profile: definition.profile,
            input,
            requirements: definition.requirements,
            outputContract: definition.outputContract,
            template: definition.template,
            executionPolicy: {
              allowPaidUsage: options.allowPaidUsage ?? false,
              maxRetries: options.maxRetries ?? 1,
            },
          };
          return this.runOperation(request, options, parse);
        },
        retry: async (jobId, options = {}) =>
          this.retryOperation(jobId, options, parse),
      };
    },
  };

  public readonly audio = {
    /**
     * Defines a text-to-speech operation. Mirrors image generation: submit +
     * poll through the same job API. `input` carries `text` + a semantic
     * `voiceId` (never a provider voice name) plus optional `format` ("wav"),
     * `speed`, `language`, `instructions`. The result is an
     * IntelligenceSpeechGenerationResult carrying a durable audio artifact.
     */
    defineSpeechOperation: <
      TInput extends JsonValue,
      TOutput = IntelligenceSpeechGenerationResult,
    >(
      definition: SpeechGenerationOperationDefinition<TOutput>,
    ): SpeechGenerationOperation<TInput, TOutput> => {
      const parse = (value: unknown): TOutput => definition.parse
        ? definition.parse(value)
        : value as TOutput;
      return {
        run: async (input, options) => {
          this.assertExecutionPolicy(options);
          const request: IntelligenceRequest = {
            idempotencyKey: options.idempotencyKey,
            operationId: definition.operationId,
            clientApp: definition.clientApp,
            projectId: definition.projectId,
            capability: "audio.speech.generate",
            execution: this.executionPreference(options.execution),
            executionTarget: options.execution,
            profile: definition.profile,
            input,
            outputContract: definition.outputContract,
            template: definition.template,
            executionPolicy: {
              allowPaidUsage: options.allowPaidUsage ?? false,
              maxRetries: options.maxRetries ?? 1,
            },
          };
          return this.runOperation(request, options, parse);
        },
        retry: async (jobId, options = {}) =>
          this.retryOperation(jobId, options, parse),
      };
    },
  };

  public async availableExecutions(
    capability: IntelligenceCapability,
    profile: IntelligenceProfile,
  ): Promise<IntelligenceExecutionTarget[]> {
    const health = await this.request<IntelligenceHealthResponse>(
      "GET",
      "/api/intelligence/health",
    );
    const available = new Set<IntelligenceExecutionTarget>();
    for (const route of health.liteLlm.routes) {
      if (route.capability !== capability || route.profile !== profile) continue;
      if (route.executor === "codex-cli") available.add("codex");
      else available.add(route.location === "cloud" ? "cloud" : "local");
    }
    return ["local", "cloud", "codex"].filter((target) =>
      available.has(target as IntelligenceExecutionTarget)
    ) as IntelligenceExecutionTarget[];
  }

  public async submit(
    request: IntelligenceRequest,
  ): Promise<SubmitIntelligenceRequestResponse> {
    return this.request<SubmitIntelligenceRequestResponse>(
      "POST",
      "/api/intelligence/jobs",
      request,
    );
  }

  public async getJob(jobId: string): Promise<IntelligenceJob> {
    return this.request<IntelligenceJob>(
      "GET",
      `/api/intelligence/jobs/${encodeURIComponent(jobId)}`,
    );
  }

  public async retry(jobId: string): Promise<RetryIntelligenceJobResponse> {
    return this.request<RetryIntelligenceJobResponse>(
      "POST",
      `/api/intelligence/jobs/${encodeURIComponent(jobId)}/retry`,
    );
  }

  /**
   * Fetches the durable bytes for an artifact reference from an
   * IntelligenceArtifactRecord (its `uri`, e.g. "/api/intelligence/artifacts/iart_...").
   */
  public async getArtifact(uri: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const response = await this.fetchImpl(`${this.baseUrl}${uri}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Arcadia Intelligence artifact request failed: ${response.status} ${response.statusText}. ${text}`,
      );
    }
    return {
      bytes: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  public async waitForCompletion(
    jobId: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<IntelligenceJob> {
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const startedAt = Date.now();

    while (true) {
      const job = await this.getJob(jobId);

      if (
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "blocked"
      ) {
        return job;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `Timed out waiting for Arcadia Intelligence job ${jobId}.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  private assertExecutionPolicy(options: StructuredTextRunOptions): void {
    if (options.execution === "cloud" && options.allowPaidUsage !== true) {
      throw new ArcadiaExecutionPolicyError(
        "Cloud execution requires allowPaidUsage: true.",
      );
    }
  }

  private executionPreference(
    target: IntelligenceExecutionTarget,
  ): IntelligenceRequest["execution"] {
    return target === "cloud" ? "cloud-required" : "local-required";
  }

  private async runOperation<TOutput>(
    request: IntelligenceRequest,
    options: OperationWaitOptions,
    parse: (value: unknown) => TOutput,
  ): Promise<StructuredTextRunResult<TOutput>> {
    try {
      const { job: submitted } = await this.submit(request);
      return await this.waitForOperation(submitted.id, options, parse);
    } catch (error) {
      if (
        error instanceof ArcadiaJobBlockedError ||
        error instanceof ArcadiaJobFailedError
      ) {
        throw error;
      }
      throw new ArcadiaUnavailableError(
        `Arcadia Intelligence is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private async retryOperation<TOutput>(
    jobId: string,
    options: OperationWaitOptions,
    parse: (value: unknown) => TOutput,
  ): Promise<StructuredTextRunResult<TOutput>> {
    try {
      const { job } = await this.retry(jobId);
      return await this.waitForOperation(job.id, options, parse);
    } catch (error) {
      if (
        error instanceof ArcadiaJobBlockedError ||
        error instanceof ArcadiaJobFailedError
      ) {
        throw error;
      }
      throw new ArcadiaUnavailableError(
        `Arcadia Intelligence is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private async waitForOperation<TOutput>(
    jobId: string,
    options: OperationWaitOptions,
    parse: (value: unknown) => TOutput,
  ): Promise<StructuredTextRunResult<TOutput>> {
    const job = await this.waitForCompletion(jobId, options);
    if (job.status === "blocked") {
      throw new ArcadiaJobBlockedError(
        job.id,
        job.error?.code ?? "UNKNOWN",
        job.error?.message ?? `Arcadia Intelligence job ${job.id} was blocked.`,
      );
    }
    if (job.status === "failed") {
      throw new ArcadiaJobFailedError(
        job.id,
        job.error?.code ?? "UNKNOWN",
        job.error?.message ?? `Arcadia Intelligence job ${job.id} failed.`,
      );
    }
    if (job.status !== "completed") {
      throw new ArcadiaUnavailableError(
        `Arcadia Intelligence job ${job.id} returned non-terminal status ${job.status}.`,
      );
    }
    return { result: parse(job.result), jobId: job.id };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Arcadia Intelligence request failed: ${response.status} ${response.statusText}. ${text}`,
      );
    }

    return (await response.json()) as T;
  }
}
