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
 * The generic operation a request needs. Arcadia resolves this, together
 * with `execution` and `profile`, to exactly one configured LiteLLM route
 * (see src/intelligence/routing/resolveRoute.ts). Companion apps select an
 * operation, never a provider, model, or LiteLLM route name directly.
 *
 * Not every capability is wired to an executable transport or has a default
 * route configured in this milestone (vision/audio/video, image.edit) — an
 * unconfigured capability resolves to a typed "route_not_configured" failure
 * rather than throwing or silently falling back.
 */
export const INTELLIGENCE_CAPABILITIES = [
  "text.generate",
  "text.classify",
  "text.extract",
  "text.reason",
  "vision.analyze",
  "image.generate",
  "image.edit",
  "audio.transcribe",
  "audio.synthesize",
  "video.generate",
] as const;
export type IntelligenceCapability = (typeof INTELLIGENCE_CAPABILITIES)[number];

/**
 * Where a request is allowed/preferred to run.
 *
 * - "local-required": only a local route may resolve.
 * - "local-preferred": resolve to local when configured and available; never
 *   silently escalate to cloud. Use "cloud-required" explicitly to opt into
 *   cloud instead.
 * - "cloud-required": only a cloud route may resolve.
 *
 * Deliberately excludes "either"/"cloud-preferred"/"frontier" in this
 * milestone — routing stays a small, deterministic lookup, not a policy
 * engine that picks among options on the companion app's behalf.
 */
export const EXECUTION_PREFERENCES = [
  "local-required",
  "local-preferred",
  "cloud-required",
] as const;
export type ExecutionPreference = (typeof EXECUTION_PREFERENCES)[number];

/**
 * The requested optimization target.
 *
 * - "economy": minimize marginal cash cost.
 * - "fast": minimize latency and local resource occupancy.
 * - "standard": normal reliable default.
 * - "quality": maximize expected output quality.
 *
 * Arcadia resolves this deterministically against its route registry; it
 * never auto-upgrades or auto-downgrades a profile on the companion app's
 * behalf.
 */
export const INTELLIGENCE_PROFILES = ["economy", "fast", "standard", "quality"] as const;
export type IntelligenceProfile = (typeof INTELLIGENCE_PROFILES)[number];

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
   * v0.1 default: false.
   * Authorization/eligibility gate only — not a model tier. A route that
   * requires paid usage (see IntelligenceRouteEntry.requiresPaidUsage)
   * cannot resolve unless this is true. No automatic paid fallback occurs:
   * Arcadia never flips this on or escalates execution on its own.
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
   * App-defined stable identifier for this request, e.g.
   * "rebuster.candidate-list.v1". Arcadia does not interpret its domain
   * meaning; it is stored for provenance, logging, and lookups. Distinct
   * from `capability` below, which is the generic operation Arcadia itself
   * routes and executes.
   */
  capabilityId: string;

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
   * The generic operation this request needs. Arcadia resolves this,
   * together with `execution` and `profile`, to exactly one configured
   * LiteLLM route. Never a raw LiteLLM route, provider name, or model ID.
   */
  capability: IntelligenceCapability;

  /**
   * Where this request is allowed/preferred to run. See ExecutionPreference.
   * "local-preferred" never silently escalates to cloud — there is no
   * automatic fallback in this milestone.
   */
  execution: ExecutionPreference;

  /**
   * The requested optimization target. See IntelligenceProfile.
   */
  profile: IntelligenceProfile;

  /**
   * Arbitrary app-owned structured payload. For "image.generate" and
   * "image.edit" capabilities, `input` must contain a string `prompt`
   * field; Arcadia passes it to the resolved image route unexamined
   * otherwise. An optional numeric `n` and string `size` in `input` are
   * also read for image generation.
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
  /** Semantic resolved route ID, e.g. "arcadia.text.generate.local.fast". */
  routeId?: string;
  /** The literal LiteLLM route/model alias the resolved route maps to. */
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
