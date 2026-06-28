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
   * v0.1 default should remain false.
   */
  allowPaidUsage: boolean;

  /**
   * v0.1 default should remain 1.
   */
  maxRetries: number;

  /**
   * Path or identifier for SQLite storage.
   * Codex should adapt this to existing Arcadia database conventions.
   */
  databasePath: string;

  /**
   * Job polling interval for the in-process worker.
   */
  workerPollIntervalMs: number;
};
