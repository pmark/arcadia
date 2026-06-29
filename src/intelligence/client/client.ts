import type {
  IntelligenceJob,
  IntelligenceRequest,
  RetryIntelligenceJobResponse,
  SubmitIntelligenceRequestResponse,
} from "../types.js";

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
