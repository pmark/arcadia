export type IntelligenceV01Config = {
  /**
   * The single configured LiteLLM route allowed for v0.1.
   * Companion apps do not select providers or models.
   */
  defaultLiteLlmRoute: string;

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
