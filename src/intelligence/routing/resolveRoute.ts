import type { IntelligenceRouteEntry, IntelligenceRouteLocation } from "../config/types.js";
import type {
  ExecutionPreference,
  IntelligenceCapability,
  IntelligenceExecutionTarget,
  IntelligenceProfile,
} from "../types.js";

export type IntelligenceRouteRequest = {
  capability: IntelligenceCapability;
  execution: ExecutionPreference;
  profile: IntelligenceProfile;
  executionTarget?: IntelligenceExecutionTarget;
};

export type ResolvedIntelligenceRoute = {
  routeId: string;
  capability: IntelligenceCapability;
  location: IntelligenceRouteLocation;
  profile: IntelligenceProfile;
  liteLlmRoute: string;
  executor: "litellm" | "codex-cli" | "comfyui" | "speech";
  requiresPaidUsage: boolean;
};

export type IntelligenceRouteResolutionFailureCode =
  | "route_not_configured"
  | "route_disabled"
  | "paid_usage_not_allowed"
  | "local_route_unavailable"
  | "cloud_route_unavailable";

export type IntelligenceRouteResolution =
  | { ok: true; route: ResolvedIntelligenceRoute }
  | {
      ok: false;
      code: IntelligenceRouteResolutionFailureCode;
      message: string;
      requested: IntelligenceRouteRequest;
      alternatives?: IntelligenceRouteRequest[];
    };

const EXECUTION_LOCATIONS: Record<ExecutionPreference, IntelligenceRouteLocation[]> = {
  "local-required": ["local"],
  // v0.1 looks only at local routes for "local-preferred" — it never
  // escalates to cloud on the companion app's behalf. Use "cloud-required"
  // explicitly (e.g. from the alternatives this returns) to opt into cloud.
  "local-preferred": ["local"],
  "cloud-required": ["cloud"],
};

/**
 * Deterministically resolves a companion-app request's capability/execution/
 * profile into exactly one configured execution route, or a typed failure.
 *
 * This is a small explicit lookup, not a policy engine: no scheduling, no
 * cost optimization, no automatic fallback or quality escalation. Companion
 * apps never see a LiteLLM route, Codex command, provider, model, or
 * executor name — only this route resolution, which the worker dispatches
 * to the configured backend.
 */
export function resolveIntelligenceRoute(
  requested: IntelligenceRouteRequest,
  registry: IntelligenceRouteEntry[],
  options: { allowPaidUsage: boolean },
): IntelligenceRouteResolution {
  const candidateLocations = EXECUTION_LOCATIONS[requested.execution];
  const targetExecutor = requested.executionTarget === "codex"
    ? "codex-cli"
    : requested.executionTarget === "local" || requested.executionTarget === "cloud"
      // Speech routes run on the dedicated OpenAI-compatible "speech" executor,
      // not the generic LiteLLM transport; a local/cloud target for the speech
      // capability must therefore match "speech", not "litellm".
      ? (requested.capability === "audio.speech.generate" ? "speech" : "litellm")
      : undefined;

  for (const location of candidateLocations) {
    const entry = registry.find(
      (route) =>
        route.capability === requested.capability &&
        route.profile === requested.profile &&
        route.location === location &&
        (targetExecutor === undefined
          || (route.executor ?? "litellm") === targetExecutor),
    );
    if (!entry) {
      continue;
    }

    if (!entry.enabled) {
      return {
        ok: false,
        code: "route_disabled",
        message: `Route "${entry.id}" is configured but disabled.`,
        requested,
      };
    }

    if (entry.requiresPaidUsage && !options.allowPaidUsage) {
      return {
        ok: false,
        code: "paid_usage_not_allowed",
        message:
          `Route "${entry.id}" requires paid usage, but the request's ` +
          `executionPolicy.allowPaidUsage is false.`,
        requested,
      };
    }

    return {
      ok: true,
      route: {
        routeId: entry.id,
        capability: entry.capability,
        location: entry.location,
        profile: entry.profile,
        liteLlmRoute: entry.liteLlmRoute,
        executor: entry.executor ?? "litellm",
        requiresPaidUsage: entry.requiresPaidUsage,
      },
    };
  }

  const configuredForCapability = registry.filter(
    (route) =>
      route.capability === requested.capability &&
      (targetExecutor === undefined
        || (route.executor ?? "litellm") === targetExecutor),
  );
  if (configuredForCapability.length === 0) {
    return {
      ok: false,
      code: "route_not_configured",
      message: `No Arcadia Intelligence route is configured for capability "${requested.capability}".`,
      requested,
    };
  }

  const otherLocationEntries = configuredForCapability.filter(
    (route) => !candidateLocations.includes(route.location),
  );
  const alternatives: IntelligenceRouteRequest[] = otherLocationEntries.map((route) => ({
    capability: route.capability,
    execution: route.location === "local" ? "local-required" : "cloud-required",
    profile: route.profile,
    executionTarget: requested.executionTarget,
  }));

  if (requested.execution === "cloud-required") {
    return {
      ok: false,
      code: "cloud_route_unavailable",
      message:
        `No cloud route is configured for capability "${requested.capability}" ` +
        `at profile "${requested.profile}".`,
      requested,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
    };
  }

  return {
    ok: false,
    code: "local_route_unavailable",
    message:
      `No local route is configured for capability "${requested.capability}" ` +
      `at profile "${requested.profile}". Arcadia does not automatically ` +
      `escalate "${requested.execution}" requests to cloud.`,
    requested,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
  };
}
