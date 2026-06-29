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

/**
 * What kind of generation a request wants. Arcadia interprets this only to
 * pick a transport (chat completions vs. image generation) and a configured
 * route; it never interprets the request's domain meaning.
 */
export type IntelligenceModality = "text" | "image";

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
   * What kind of generation this request wants. Defaults to "text" when
   * absent. For "image", `input` must contain a string `prompt` field;
   * Arcadia passes it to the configured image route unexamined otherwise.
   * An optional numeric `n` and string `size` in `input` are also read.
   */
  modality?: IntelligenceModality;

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

/**
 * A durable, Arcadia-owned reference to a generated binary artifact (for
 * example one generated image). Arcadia downloads or decodes provider output,
 * persists the bytes itself, and returns this record instead of a provider
 * URL or an inline base64 payload — provider URLs can be temporary, signed,
 * or credential-sensitive, and base64 bloats job rows and HTTP responses.
 *
 * `uri` is a path relative to the Arcadia Intelligence API base URL (the
 * same `baseUrl` passed to `ArcadiaIntelligenceClient`), fetchable via
 * `GET {uri}` or `ArcadiaIntelligenceClient.getArtifact(id)`.
 */
export type IntelligenceArtifactRecord = {
  id: string;
  kind: "image";
  uri: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  dimensions?: { width: number; height: number };
  /** Safe, provider-returned metadata only (e.g. seed, revised prompt). Never a provider URL or credential. */
  metadata?: JsonValue;
};

/**
 * The generic manifest an image-generation job's `result` conforms to.
 * Companion apps write their own outputContract.jsonSchema against this
 * shape, typically requiring only the subset of fields they care about.
 */
export type IntelligenceImageGenerationResult = {
  artifacts: IntelligenceArtifactRecord[];
  warnings?: string[];
  generation?: {
    requestedCount?: number;
    returnedCount?: number;
  };
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
