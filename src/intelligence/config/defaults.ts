import os from "node:os";
import path from "node:path";
import type { IntelligenceProfile } from "../types.js";
import { DEFAULT_VOICE_MAP, loadVoiceMap } from "../speech/voices.js";
import type {
  IntelligenceResourceGroup,
  IntelligenceRouteEntry,
  IntelligenceRouteLocation,
  IntelligenceSchedulerConfig,
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
const LOCAL_COMFYUI_IMAGE_PROFILES: IntelligenceProfile[] = ["quality"];
const CLOUD_IMAGE_PROFILES: IntelligenceProfile[] = ["quality"];
const AUDIO_SPEECH_PROFILES: IntelligenceProfile[] = ["standard"];
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

export const intelligenceSchedulerDefaults: IntelligenceSchedulerConfig = {
  scanLimit: 100,
  pools: {
    "litellm-local": { concurrency: 1 },
    "litellm-cloud-text": { concurrency: 4 },
    "litellm-cloud-image": { concurrency: 2 },
    "codex-cli": { concurrency: 3 },
    comfyui: { concurrency: 1 },
    "speech-local": { concurrency: 1 },
    "speech-cloud": { concurrency: 4 },
  },
};

export function resolveIntelligenceSchedulerConfig(
  config: IntelligenceV01Config,
): IntelligenceSchedulerConfig {
  const pools = Object.fromEntries(
    Object.entries(intelligenceSchedulerDefaults.pools).map(([group, defaults]) => {
      const overrides = config.scheduler?.pools?.[group as IntelligenceResourceGroup];
      return [group, { ...defaults, ...overrides }];
    }),
  ) as unknown as IntelligenceSchedulerConfig["pools"];

  return {
    scanLimit: positiveInteger(config.scheduler?.scanLimit, intelligenceSchedulerDefaults.scanLimit),
    pools: Object.fromEntries(
      Object.entries(pools).map(([group, pool]) => [
        group,
        {
          ...pool,
          concurrency: positiveInteger(pool.concurrency, 1),
        },
      ]),
    ) as unknown as IntelligenceSchedulerConfig["pools"],
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

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

function comfyUiImageRouteEntries(routeName: string | undefined): IntelligenceRouteEntry[] {
  if (!routeName) return [];
  return ["image.generate", "image.edit"].flatMap((capability) =>
    LOCAL_COMFYUI_IMAGE_PROFILES.map((profile) => ({
      ...buildEntry(capability as IntelligenceRouteEntry["capability"], "local", profile, routeName, false),
      id: `arcadia.${capability}.local.${profile}.comfyui`,
      executor: "comfyui" as const,
      metadata: {
        costClass: "free" as const,
        supportsImageInput: capability === "image.edit",
        supportsImageEditing: capability === "image.edit",
        weight: 4,
      },
    })),
  );
}

/**
 * Speech (text-to-speech) routes. Both local and cloud go through the same
 * LiteLLM proxy via the "speech" executor — like text/image, they differ only
 * in which LiteLLM model alias the route resolves to (e.g. a local "arcadia-tts"
 * alias LiteLLM maps to a Kokoro server) and paid-usage gating. Omitting the
 * alias env var omits the route entirely — there is no default speech route,
 * and no local->cloud fallback.
 */
function speechRouteEntries(
  location: IntelligenceRouteLocation,
  route: string | undefined,
  requiresPaidUsage: boolean,
): IntelligenceRouteEntry[] {
  if (!route) {
    return [];
  }
  return AUDIO_SPEECH_PROFILES.map((profile) => ({
    ...buildEntry("audio.speech.generate", location, profile, route, requiresPaidUsage, {
      costClass: requiresPaidUsage ? "medium" : "free",
    }),
    executor: "speech" as const,
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
 *   - arcadia.image.generate.local.quality.comfyui (ComfyUI)
 *   - arcadia.image.edit.local.quality.comfyui (ComfyUI)
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
  comfyUiImageRoute?: string;
  codexTextRoute?: string;
  localSpeechRoute?: string;
  cloudSpeechRoute?: string;
}): IntelligenceRouteEntry[] {
  return [
    ...textRouteEntries("local", options.localTextRoute, LOCAL_TEXT_PROFILES, false),
    ...(options.codexTextRoute ? codexTextRouteEntries(options.codexTextRoute) : []),
    ...textRouteEntries("cloud", options.cloudTextRoute, CLOUD_TEXT_PROFILES, true),
    ...comfyUiImageRouteEntries(options.comfyUiImageRoute),
    ...codexImageRouteEntries(options.codexImageRoute),
    ...imageRouteEntries(options.cloudImageRoute),
    ...speechRouteEntries("local", options.localSpeechRoute, false),
    ...speechRouteEntries("cloud", options.cloudSpeechRoute, true),
  ];
}

export const intelligenceV01Defaults: IntelligenceV01Config = {
  routes: buildDefaultRoutes({ localTextRoute: "arcadia-default" }),
  liteLlmBaseUrl: "http://127.0.0.1:4000",
  maxRetries: 1,
  workerPollIntervalMs: 500,
  leaseDurationMs: 30_000,
  scheduler: intelligenceSchedulerDefaults,
  codexCli: DEFAULT_CODEX_CLI,
  speech: {
    voiceMap: { ...DEFAULT_VOICE_MAP },
    timeoutMs: 60_000,
    maxRetries: 1,
  },
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
  const comfyUiImageRoute = env.ARCADIA_COMFYUI_IMAGE_ROUTE?.trim() || undefined;
  const codexTextRoute = env.ARCADIA_CODEX_TEXT_ROUTE?.trim() || "codex-cli";
  const localSpeechRoute = env.ARCADIA_SPEECH_LOCAL_ROUTE?.trim() || undefined;
  const cloudSpeechRoute = env.ARCADIA_SPEECH_CLOUD_ROUTE?.trim() || undefined;

  return {
    routes: buildDefaultRoutes({
      localTextRoute,
      cloudTextRoute,
      cloudImageRoute,
      codexImageRoute,
      comfyUiImageRoute,
      codexTextRoute,
      localSpeechRoute,
      cloudSpeechRoute,
    }),
    liteLlmBaseUrl:
      env.ARCADIA_LITELLM_BASE_URL?.trim() || intelligenceV01Defaults.liteLlmBaseUrl,
    liteLlmApiKey: env.ARCADIA_LITELLM_API_KEY?.trim() || undefined,
    maxRetries: intelligenceV01Defaults.maxRetries,
    workerPollIntervalMs: intelligenceV01Defaults.workerPollIntervalMs,
    leaseDurationMs: intelligenceV01Defaults.leaseDurationMs,
    scheduler: {
      scanLimit: readPositiveInteger(
        env.ARCADIA_INTELLIGENCE_SCAN_LIMIT,
        intelligenceSchedulerDefaults.scanLimit,
      ),
      pools: {
        "litellm-local": {
          concurrency: readPositiveInteger(
            env.ARCADIA_INTELLIGENCE_LOCAL_CONCURRENCY,
            intelligenceSchedulerDefaults.pools["litellm-local"].concurrency,
          ),
        },
        "litellm-cloud-text": {
          concurrency: readPositiveInteger(
            env.ARCADIA_INTELLIGENCE_CLOUD_TEXT_CONCURRENCY,
            intelligenceSchedulerDefaults.pools["litellm-cloud-text"].concurrency,
          ),
        },
        "litellm-cloud-image": {
          concurrency: readPositiveInteger(
            env.ARCADIA_INTELLIGENCE_CLOUD_IMAGE_CONCURRENCY,
            intelligenceSchedulerDefaults.pools["litellm-cloud-image"].concurrency,
          ),
        },
        "codex-cli": {
          concurrency: readPositiveInteger(
            env.ARCADIA_INTELLIGENCE_CODEX_CONCURRENCY,
            intelligenceSchedulerDefaults.pools["codex-cli"].concurrency,
          ),
        },
        comfyui: {
          concurrency: readPositiveInteger(
            env.ARCADIA_INTELLIGENCE_COMFYUI_CONCURRENCY,
            intelligenceSchedulerDefaults.pools.comfyui.concurrency,
          ),
        },
        "speech-local": {
          concurrency: readPositiveInteger(
            env.ARCADIA_INTELLIGENCE_LOCAL_SPEECH_CONCURRENCY,
            intelligenceSchedulerDefaults.pools["speech-local"].concurrency,
          ),
        },
        "speech-cloud": {
          concurrency: readPositiveInteger(
            env.ARCADIA_INTELLIGENCE_CLOUD_SPEECH_CONCURRENCY,
            intelligenceSchedulerDefaults.pools["speech-cloud"].concurrency,
          ),
        },
      },
    },
    speech: {
      voiceMap: loadVoiceMap(env.ARCADIA_SPEECH_VOICE_MAP),
      timeoutMs: env.ARCADIA_SPEECH_TIMEOUT_MS
        ? Number(env.ARCADIA_SPEECH_TIMEOUT_MS)
        : 60_000,
      maxRetries: intelligenceV01Defaults.maxRetries,
    },
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
    comfyUi: {
      baseUrl: env.ARCADIA_COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188",
      workflowDir:
        env.ARCADIA_COMFYUI_WORKFLOW_DIR?.trim() ||
        path.join(os.homedir(), "AI", "Arcadia-ComfyUI", "workflows"),
      timeoutMs: env.ARCADIA_COMFYUI_TIMEOUT_MS
        ? Number(env.ARCADIA_COMFYUI_TIMEOUT_MS)
        : 900_000,
    },
  };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return positiveInteger(parsed, fallback);
}
