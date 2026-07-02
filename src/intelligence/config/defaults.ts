import type { IntelligenceProfile } from "../types.js";
import type {
  IntelligenceRouteEntry,
  IntelligenceRouteLocation,
  IntelligenceV01Config,
} from "./types.js";

/**
 * The only profiles each location/capability is intentionally wired for
 * today. This is the entire supported route matrix — not a placeholder to
 * expand later by adding profiles here. A configured route means "this
 * exact combination is executable and tested," not "this alias could also
 * serve this profile." Adding a profile to one of these lists is a
 * deliberate decision to support a new combination, not a cosmetic change.
 */
const LOCAL_TEXT_PROFILES: IntelligenceProfile[] = ["fast", "standard"];
const CLOUD_TEXT_PROFILES: IntelligenceProfile[] = ["fast", "standard", "quality"];
const LOCAL_CODEX_IMAGE_PROFILES: IntelligenceProfile[] = ["quality"];
const CLOUD_IMAGE_PROFILES: IntelligenceProfile[] = ["quality"];
const DEFAULT_CODEX_CLI = {
  command: "codex",
  args: [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    "-C",
    "{workspace}",
    "-",
  ],
  timeoutMs: 120_000,
};

function textRouteEntries(
  location: IntelligenceRouteLocation,
  liteLlmRoute: string | undefined,
  profiles: IntelligenceProfile[],
  requiresPaidUsage: boolean,
): IntelligenceRouteEntry[] {
  if (!liteLlmRoute) {
    return [];
  }
  return profiles.map((profile) =>
    buildEntry("text.generate", location, profile, liteLlmRoute, requiresPaidUsage, {
      supportsStructuredOutput: true,
    }),
  );
}

function imageRouteEntries(liteLlmRoute: string | undefined): IntelligenceRouteEntry[] {
  if (!liteLlmRoute) {
    return [];
  }
  return CLOUD_IMAGE_PROFILES.map((profile) =>
    buildEntry("image.generate", "cloud", profile, liteLlmRoute, true),
  );
}

function codexTextRouteEntries(routeName: string): IntelligenceRouteEntry[] {
  return LOCAL_TEXT_PROFILES.map((profile) => ({
    ...buildEntry("text.generate", "local", profile, routeName, false, {
      supportsStructuredOutput: true,
    }),
    id: `arcadia.text.generate.local.${profile}.codex`,
    executor: "codex-cli" as const,
    metadata: { supportsStructuredOutput: true, costClass: "free" as const },
  }));
}

function codexImageRouteEntries(routeName: string | undefined): IntelligenceRouteEntry[] {
  if (!routeName) {
    return [];
  }
  return LOCAL_CODEX_IMAGE_PROFILES.map((profile) => ({
    ...buildEntry("image.generate", "local", profile, routeName, false),
    executor: "codex-cli" as const,
    metadata: { costClass: "free" as const, weight: 2 },
  }));
}

function buildEntry(
  capability: IntelligenceRouteEntry["capability"],
  location: IntelligenceRouteLocation,
  profile: IntelligenceProfile,
  liteLlmRoute: string,
  requiresPaidUsage: boolean,
  metadata?: IntelligenceRouteEntry["metadata"],
): IntelligenceRouteEntry {
  return {
    id: `arcadia.${capability}.${location}.${profile}`,
    capability,
    location,
    profile,
    liteLlmRoute,
    enabled: true,
    requiresPaidUsage,
    metadata,
  };
}

/**
 * Builds the v0.1 default route registry from configured LiteLLM aliases
 * plus optional local Codex routes.
 *
 * This intentionally does not expand each alias across every capability and
 * profile. Only the minimum supported route matrix is produced:
 *   - arcadia.text.generate.local.fast      (LiteLLM or Codex CLI)
 *   - arcadia.text.generate.local.standard  (LiteLLM or Codex CLI)
 *   - arcadia.text.generate.cloud.fast
 *   - arcadia.text.generate.cloud.standard
 *   - arcadia.text.generate.cloud.quality
 *   - arcadia.image.generate.local.quality  (Codex CLI)
 *   - arcadia.image.generate.cloud.quality
 *
 * Local LLM and Codex text routes may coexist. A request with an explicit
 * executionTarget selects one; legacy requests without a target retain the
 * local LLM route as their deterministic default.
 *
 * Other text.* capabilities (classify/extract/reason), other profiles
 * (economy on either text location, standard/economy on image),
 * and other capabilities (vision/audio/video/image.edit) are valid request
 * values but have no default route — they resolve as a typed
 * "route_not_configured"/"*_route_unavailable" failure rather than guessing
 * a route name. Omitting an alias env var omits its entries entirely.
 */
export function buildDefaultRoutes(options: {
  localTextRoute?: string;
  cloudTextRoute?: string;
  cloudImageRoute?: string;
  codexImageRoute?: string;
  codexTextRoute?: string;
}): IntelligenceRouteEntry[] {
  return [
    ...textRouteEntries("local", options.localTextRoute, LOCAL_TEXT_PROFILES, false),
    ...(options.codexTextRoute ? codexTextRouteEntries(options.codexTextRoute) : []),
    ...textRouteEntries("cloud", options.cloudTextRoute, CLOUD_TEXT_PROFILES, true),
    ...codexImageRouteEntries(options.codexImageRoute),
    ...imageRouteEntries(options.cloudImageRoute),
  ];
}

export const intelligenceV01Defaults: IntelligenceV01Config = {
  routes: buildDefaultRoutes({ localTextRoute: "arcadia-default" }),
  liteLlmBaseUrl: "http://127.0.0.1:4000",
  maxRetries: 1,
  workerPollIntervalMs: 500,
  leaseDurationMs: 30_000,
  codexCli: DEFAULT_CODEX_CLI,
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
  const codexImageRoute = env.ARCADIA_CODEX_IMAGE_ROUTE?.trim() || undefined;
  const codexTextRoute = env.ARCADIA_CODEX_TEXT_ROUTE?.trim() || "codex-cli";

  return {
    routes: buildDefaultRoutes({ localTextRoute, cloudTextRoute, cloudImageRoute, codexImageRoute, codexTextRoute }),
    liteLlmBaseUrl:
      env.ARCADIA_LITELLM_BASE_URL?.trim() || intelligenceV01Defaults.liteLlmBaseUrl,
    liteLlmApiKey: env.ARCADIA_LITELLM_API_KEY?.trim() || undefined,
    maxRetries: intelligenceV01Defaults.maxRetries,
    workerPollIntervalMs: intelligenceV01Defaults.workerPollIntervalMs,
    leaseDurationMs: intelligenceV01Defaults.leaseDurationMs,
    codexCli: {
      command:
        env.ARCADIA_CODEX_CLI_COMMAND?.trim() ??
        DEFAULT_CODEX_CLI.command,
      args: env.ARCADIA_CODEX_CLI_ARGS
        ? JSON.parse(env.ARCADIA_CODEX_CLI_ARGS) as string[]
        : DEFAULT_CODEX_CLI.args,
      timeoutMs: env.ARCADIA_CODEX_CLI_TIMEOUT_MS
        ? Number(env.ARCADIA_CODEX_CLI_TIMEOUT_MS)
        : DEFAULT_CODEX_CLI.timeoutMs,
    },
  };
}
