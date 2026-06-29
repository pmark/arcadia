import type { IntelligenceCapability, IntelligenceProfile } from "../types.js";

/**
 * Where a configured route actually runs. Distinct from `ExecutionPreference`
 * (the companion app's request-time constraint) — this is the operator's
 * deployment-time fact about a specific route.
 */
export type IntelligenceRouteLocation = "local" | "cloud";

/**
 * One entry in Arcadia's route registry: a deterministic mapping from a
 * semantic (capability, location, profile) tuple to a single LiteLLM
 * route/model alias. LiteLLM may map that alias to any provider or model;
 * that mapping is free to change without companion apps noticing, since they
 * never see `liteLlmRoute` — only the semantic `id`.
 *
 * Metadata is intentionally minimal: just enough for deterministic routing
 * and validation today, not a scheduler or benchmarking system.
 */
export type IntelligenceRouteEntry = {
  /** Semantic, stable route ID, e.g. "arcadia.text.generate.local.fast". */
  id: string;
  capability: IntelligenceCapability;
  location: IntelligenceRouteLocation;
  profile: IntelligenceProfile;
  /** The LiteLLM route/model alias this semantic route resolves to. */
  liteLlmRoute: string;
  enabled: boolean;
  /** If true, this route cannot resolve unless executionPolicy.allowPaidUsage is true. */
  requiresPaidUsage: boolean;
  metadata?: {
    supportsStructuredOutput?: boolean;
    supportsImageInput?: boolean;
    supportsImageEditing?: boolean;
    costClass?: "free" | "low" | "medium" | "high";
    /** Relative local RAM/VRAM or concurrency weight, for future scheduling. */
    weight?: number;
  };
};

export type IntelligenceV01Config = {
  /**
   * The full route registry. Resolved deterministically by
   * src/intelligence/routing/resolveRoute.ts against a request's
   * capability/execution/profile. There is no fallback or scheduler here —
   * just a small explicit lookup table.
   */
  routes: IntelligenceRouteEntry[];

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
