import type { IntelligenceV01Config } from "./types.js";

export const intelligenceV01Defaults: IntelligenceV01Config = {
  defaultLiteLlmRoute: "arcadia-default",
  liteLlmBaseUrl: "http://127.0.0.1:4000",
  allowPaidUsage: false,
  maxRetries: 1,
  workerPollIntervalMs: 500,
  leaseDurationMs: 30_000,
};

/**
 * Resolves config from environment overrides on top of the v0.1 defaults.
 * Only the local LiteLLM endpoint and route are configurable; v0.1
 * intentionally does not expose provider, budget, or quota settings here.
 */
export function loadIntelligenceConfig(
  env: NodeJS.ProcessEnv = process.env,
): IntelligenceV01Config {
  return {
    ...intelligenceV01Defaults,
    defaultLiteLlmRoute:
      env.ARCADIA_LITELLM_ROUTE?.trim() || intelligenceV01Defaults.defaultLiteLlmRoute,
    liteLlmBaseUrl:
      env.ARCADIA_LITELLM_BASE_URL?.trim() || intelligenceV01Defaults.liteLlmBaseUrl,
    liteLlmApiKey: env.ARCADIA_LITELLM_API_KEY?.trim() || undefined,
  };
}
