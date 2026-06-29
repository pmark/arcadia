export type IntelligenceV01Config = {
  /**
   * The single configured LiteLLM route for text/structured generation.
   * Companion apps do not select providers or models.
   */
  defaultLiteLlmRoute: string;

  /**
   * The single configured LiteLLM route for image generation. Undefined
   * means image generation is not configured; image jobs block clearly
   * rather than falling back to the text route.
   */
  defaultLiteLlmImageRoute?: string;

  /**
   * LiteLLM proxy endpoint, usually localhost.
   */
  liteLlmBaseUrl: string;

  /**
   * Optional bearer token forwarded to the local LiteLLM proxy.
   * Never a provider API key; LiteLLM owns provider credentials.
   */
  liteLlmApiKey?: string;

  /**
   * v0.1 default should remain false.
   */
  allowPaidUsage: boolean;

  /**
   * v0.1 default should remain 1.
   */
  maxRetries: number;

  /**
   * Job polling interval for the in-process worker.
   */
  workerPollIntervalMs: number;

  /**
   * How long a worker's claim on a job is valid before another worker may
   * reclaim it. Makes job execution restart-safe.
   */
  leaseDurationMs: number;
};
