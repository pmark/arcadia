/**
 * Generic Arcadia Intelligence v0.1 contracts.
 *
 * These types intentionally contain no companion-app domain knowledge.
 * A companion app owns its own capability names, input payload, output schema,
 * template contents, and workflow state.
 */

export type IntelligenceJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type OutputContract = {
  /**
   * Companion-app-owned identifier, for example:
   * "rebuster.candidate-list.v1"
   * "another-app.content-draft.v1"
   */
  schemaId: string;

  /**
   * Companion-app-owned schema version.
   */
  schemaVersion: number;

  /**
   * JSON Schema document supplied by the client or resolved by a future registry.
   */
  jsonSchema: JsonValue;

  /**
   * Stable digest calculated by the client or service for provenance.
   */
  schemaHash?: string;
};

export type PromptTemplateRef = {
  /**
   * Companion-app-owned identifier.
   */
  id: string;

  /**
   * Immutable version or content hash.
   */
  version: string;

  /**
   * Optional source path, URL, or artifact reference for provenance.
   */
  sourceRef?: string;
};

export type ExecutionPolicy = {
  /**
   * v0.1 supports one configured LiteLLM route only.
   * This remains generic so a later policy engine can evolve without breaking clients.
   */
  allowedRoutes?: string[];

  /**
   * v0.1 default: false.
   * No automatic paid fallback should occur.
   */
  allowPaidUsage: boolean;

  /**
   * v0.1 default: 1.
   */
  maxRetries: number;

  /**
   * Optional upper bound supplied by the companion app.
   */
  maxCostUsd?: number;
};

export type IntelligenceRequest = {
  /**
   * Client-provided idempotency key.
   * Repeated submissions with the same key should return the same job.
   */
  idempotencyKey: string;

  /**
   * App-defined stable capability identifier.
   * Arcadia does not interpret its domain meaning.
   */
  capability: string;

  /**
   * App identity, for example "rebuster".
   */
  clientApp: string;

  /**
   * Arcadia project attribution.
   */
  projectId?: string;

  /**
   * Optional Arcadia mission attribution.
   */
  missionId?: string;

  /**
   * Arbitrary app-owned structured payload.
   */
  input: JsonValue;

  /**
   * App-owned output contract.
   */
  outputContract: OutputContract;

  /**
   * App-owned template identity and version.
   * The rendered prompt itself is not required in v0.1.
   */
  template: PromptTemplateRef;

  executionPolicy: ExecutionPolicy;
};

export type IntelligenceUsage = {
  modelRoute?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  measuredCostUsd?: number;
  durationMs?: number;
};

export type ValidationResult = {
  passed: boolean;
  errors?: string[];
};

export type IntelligenceJob = {
  id: string;
  status: IntelligenceJobStatus;

  request: IntelligenceRequest;

  selectedRoute?: string;

  result?: JsonValue;

  validation?: ValidationResult;

  usage?: IntelligenceUsage;

  error?: {
    code: string;
    message: string;
  };

  retryCount: number;

  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type SubmitIntelligenceRequestResponse = {
  job: IntelligenceJob;
  created: boolean;
};

export type RetryIntelligenceJobResponse = {
  job: IntelligenceJob;
};
