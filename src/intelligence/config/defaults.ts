import { INTELLIGENCE_PROFILES } from "../types.js";
import type { IntelligenceCapability, IntelligenceProfile } from "../types.js";
import type {
  IntelligenceRouteEntry,
  IntelligenceRouteLocation,
  IntelligenceV01Config,
} from "./types.js";

const TEXT_CAPABILITIES: IntelligenceCapability[] = [
  "text.generate",
  "text.classify",
  "text.extract",
  "text.reason",
];

function textRouteEntries(
  location: IntelligenceRouteLocation,
  liteLlmRoute: string | undefined,
  requiresPaidUsage: boolean,
): IntelligenceRouteEntry[] {
  if (!liteLlmRoute) {
    return [];
  }
  return TEXT_CAPABILITIES.flatMap((capability) =>
    INTELLIGENCE_PROFILES.map((profile) => buildEntry(capability, location, profile, liteLlmRoute, requiresPaidUsage)),
  );
}

function imageRouteEntries(liteLlmRoute: string | undefined): IntelligenceRouteEntry[] {
  if (!liteLlmRoute) {
    return [];
  }
  return INTELLIGENCE_PROFILES.map((profile) =>
    buildEntry("image.generate", "cloud", profile, liteLlmRoute, true),
  );
}

function buildEntry(
  capability: IntelligenceCapability,
  location: IntelligenceRouteLocation,
  profile: IntelligenceProfile,
  liteLlmRoute: string,
  requiresPaidUsage: boolean,
): IntelligenceRouteEntry {
  return {
    id: `arcadia.${capability}.${location}.${profile}`,
    capability,
    location,
    profile,
    liteLlmRoute,
    enabled: true,
    requiresPaidUsage,
  };
}

/**
 * Builds the v0.1 default route registry from at most three configured
 * LiteLLM aliases: one local text model, one cloud text model, and one
 * cloud image model. Each text alias is registered for every text.*
 * capability and every profile — there is only one model per location in
 * this milestone, so it serves whichever profile is requested. Omitting an
 * alias omits its entries entirely (capability resolves as
 * "route_not_configured"/"*_route_unavailable" rather than guessing a name).
 */
export function buildDefaultRoutes(options: {
  localTextRoute?: string;
  cloudTextRoute?: string;
  cloudImageRoute?: string;
}): IntelligenceRouteEntry[] {
  return [
    ...textRouteEntries("local", options.localTextRoute, false),
    ...textRouteEntries("cloud", options.cloudTextRoute, true),
    ...imageRouteEntries(options.cloudImageRoute),
  ];
}

export const intelligenceV01Defaults: IntelligenceV01Config = {
  routes: buildDefaultRoutes({ localTextRoute: "arcadia-default" }),
  liteLlmBaseUrl: "http://127.0.0.1:4000",
  maxRetries: 1,
  workerPollIntervalMs: 500,
  leaseDurationMs: 30_000,
};

/**
 * Resolves config from environment overrides on top of the v0.1 defaults.
 * Only the local LiteLLM endpoint and a compact, three-alias route registry
 * are configurable; v0.1 intentionally does not expose budgets, quotas, or
 * per-(capability, profile) environment variables.
 */
export function loadIntelligenceConfig(
  env: NodeJS.ProcessEnv = process.env,
): IntelligenceV01Config {
  const localTextRoute = env.ARCADIA_LITELLM_LOCAL_TEXT_ROUTE?.trim() || "arcadia-default";
  const cloudTextRoute = env.ARCADIA_LITELLM_CLOUD_TEXT_ROUTE?.trim() || undefined;
  const cloudImageRoute = env.ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE?.trim() || undefined;

  return {
    routes: buildDefaultRoutes({ localTextRoute, cloudTextRoute, cloudImageRoute }),
    liteLlmBaseUrl:
      env.ARCADIA_LITELLM_BASE_URL?.trim() || intelligenceV01Defaults.liteLlmBaseUrl,
    liteLlmApiKey: env.ARCADIA_LITELLM_API_KEY?.trim() || undefined,
    maxRetries: intelligenceV01Defaults.maxRetries,
    workerPollIntervalMs: intelligenceV01Defaults.workerPollIntervalMs,
    leaseDurationMs: intelligenceV01Defaults.leaseDurationMs,
  };
}
