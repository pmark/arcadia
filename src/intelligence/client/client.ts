import type {
  IntelligenceCapability,
  IntelligenceExecutionTarget,
  IntelligenceJob,
  IntelligenceProfile,
  IntelligenceRequest,
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

export interface StructuredTextOperation<
  TInput extends JsonValue,
  TOutput,
> {
  run(
    input: TInput,
    options: StructuredTextRunOptions,
  ): Promise<StructuredTextRunResult<TOutput>>;
}

type IntelligenceHealthResponse = {
  liteLlm: {
    routes: Array<{
      capability: IntelligenceCapability;
      location: "local" | "cloud";
      profile: IntelligenceProfile;
      executor: "litellm" | "codex-cli";
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
    ): StructuredTextOperation<TInput, TOutput> => ({
      run: async (input, options) => {
        if (options.execution === "cloud" && options.allowPaidUsage !== true) {
          throw new ArcadiaExecutionPolicyError(
            'Cloud execution requires allowPaidUsage: true.',
          );
        }

        const request: IntelligenceRequest = {
          idempotencyKey: options.idempotencyKey,
          operationId: definition.operationId,
          clientApp: definition.clientApp,
          projectId: definition.projectId,
          capability: "text.generate",
          execution: options.execution === "cloud"
            ? "cloud-required"
            : "local-required",
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
        };

        let job: IntelligenceJob;
        try {
          const { job: submitted } = await this.submit(request);
          job = await this.waitForCompletion(submitted.id, {
            pollIntervalMs: options.pollIntervalMs,
            timeoutMs: options.timeoutMs,
          });
        } catch (error) {
          throw new ArcadiaUnavailableError(
            `Arcadia Intelligence is unavailable: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }

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

        const result = definition.parse
          ? definition.parse(job.result)
          : job.result as TOutput;
        return { result, jobId: job.id };
      },
    }),
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
