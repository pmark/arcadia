import * as dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

dotenv.config();

export interface BotConfig {
  arcadiaWorkspace: string;
  discordBotToken: string;
  discordClientId: string;
  discordGuildId: string;
  discordChannelId: string;
  /**
   * Channels an operator ping may name, by lowercase alias, from
   * `DISCORD_PING_CHANNELS="actions=123…,review=456…"`. An agent can only
   * reach a channel the operator listed here; anything else lands in the
   * default channel, so a ping can never be aimed at an arbitrary channel.
   */
  pingChannels: Record<string, string>;
  arcadiaCliPath: string | null;
  /** Browser base URL used for deep links in proposal notifications. */
  dashboardUrl: string;
  pollIntervalSeconds: number;
  /** Per-user allowlist for the shared Discord Reply Router. Empty = no one authorized (fail closed). */
  allowedUserIds: string[];
  /** Local "HH:MM" time the Daily Orientation Packet targets. Default 06:00. */
  orientationTargetLocalTime: string;
  /** How often (seconds) the orientation scheduler checks whether the packet is due. */
  orientationCheckIntervalSeconds: number;
  /** Local "HH:MM" time after which the day's narrative digests may compose. Default 07:00. */
  digestTargetLocalTime: string;
  /** How often (seconds) the digest scheduler checks whether any cadence is due. */
  digestCheckIntervalSeconds: number;
}

const requiredEnv = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "DISCORD_CHANNEL_ID"
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const missing = requiredEnv.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const arcadiaWorkspace = resolveConfiguredWorkspace(env);
  refuseExperimentWorkspace(arcadiaWorkspace);

  return {
    arcadiaWorkspace,
    discordBotToken: requireEnv(env, "DISCORD_BOT_TOKEN"),
    discordClientId: requireEnv(env, "DISCORD_CLIENT_ID"),
    discordGuildId: requireEnv(env, "DISCORD_GUILD_ID"),
    discordChannelId: requireEnv(env, "DISCORD_CHANNEL_ID"),
    pingChannels: parsePingChannels(env.DISCORD_PING_CHANNELS),
    arcadiaCliPath: env.ARCADIA_CLI_PATH?.trim() ? path.resolve(env.ARCADIA_CLI_PATH) : null,
    dashboardUrl: parseDashboardUrl(env.ARCADIA_DASHBOARD_URL),
    pollIntervalSeconds: parsePollInterval(env.ARCADIA_DISCORD_POLL_INTERVAL_SECONDS),
    allowedUserIds: parseAllowedUserIds(env.DISCORD_ALLOWED_USER_IDS),
    orientationTargetLocalTime: parseTargetLocalTime(env.ARCADIA_ORIENTATION_TARGET_TIME, "06:00", "ARCADIA_ORIENTATION_TARGET_TIME"),
    orientationCheckIntervalSeconds: parseCheckInterval(
      env.ARCADIA_ORIENTATION_CHECK_INTERVAL_SECONDS,
      "ARCADIA_ORIENTATION_CHECK_INTERVAL_SECONDS"
    ),
    // After the orientation packet by default: the packet is what the operator
    // opens the day with, and a digest of yesterday arriving first would bury it.
    digestTargetLocalTime: parseTargetLocalTime(env.ARCADIA_DIGEST_TARGET_TIME, "07:00", "ARCADIA_DIGEST_TARGET_TIME"),
    digestCheckIntervalSeconds: parseCheckInterval(
      env.ARCADIA_DIGEST_CHECK_INTERVAL_SECONDS,
      "ARCADIA_DIGEST_CHECK_INTERVAL_SECONDS",
      900
    )
  };
}

function parseDashboardUrl(raw: string | undefined): string {
  const value = raw?.trim() || "http://localhost:3020";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`ARCADIA_DASHBOARD_URL must be an absolute HTTP(S) URL, got: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`ARCADIA_DASHBOARD_URL must be an absolute HTTP(S) URL, got: ${value}`);
  }
  return value.replace(/\/+$/, "");
}

export function parsePingChannels(raw: string | undefined): Record<string, string> {
  const channels: Record<string, string> = {};
  for (const entry of (raw ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const [alias, id, ...rest] = entry.split("=").map((part) => part.trim());
    if (!alias || !id || rest.length > 0 || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(alias) || !/^\d{17,20}$/.test(id)) {
      throw new Error(`DISCORD_PING_CHANNELS entries must look like alias=<channel id>, got: ${entry}`);
    }
    channels[alias] = id;
  }
  return channels;
}

function parseAllowedUserIds(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function parseTargetLocalTime(raw: string | undefined, fallback: string, name: string): string {
  const value = raw?.trim() || fallback;
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error(`${name} must be "HH:MM", got: ${value}`);
  }
  return value;
}

function parseCheckInterval(raw: string | undefined, name: string, fallback = 60): number {
  if (!raw?.trim()) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 5) {
    throw new Error(`${name} must be an integer of at least 5.`);
  }
  return value;
}

function requireEnv(env: NodeJS.ProcessEnv, name: (typeof requiredEnv)[number]): string {
  return env[name]?.trim() ?? "";
}

/**
 * Decision 0082: the bot posts to the operator's real channel, so it never
 * runs against an experiment workspace. This mirrors the `discord-bot.start`
 * entry of Arcadia's guard (src/workspace/experimentGuard.ts); the bot is a
 * separate package and reads the same `experiment` flag directly.
 */
export function refuseExperimentWorkspace(workspace: string): void {
  const configPath = path.join(workspace, "config", "arcadia.json");
  if (!existsSync(configPath)) return;
  const text = readFileSync(configPath, "utf8");
  let experiment: unknown;
  try {
    experiment = (JSON.parse(text) as { experiment?: unknown }).experiment;
  } catch {
    // Fail closed: an unparseable config that mentions an experiment is
    // treated as one rather than waved through.
    experiment = /"experiment"/.test(text) ? true : undefined;
  }
  if (experiment === undefined) return;
  throw new Error(
    `Refused in experiment workspace ${workspace}: discord-bot.start. The Discord bot posts to the operator's real channel. ` +
      "Read the outbox with `arcadia agent-ask notifications` instead; only the live workspace has a Discord sender."
  );
}

function resolveConfiguredWorkspace(env: NodeJS.ProcessEnv): string {
  if (env.ARCADIA_WORKSPACE?.trim()) {
    return path.resolve(env.ARCADIA_WORKSPACE);
  }

  // Its launchd service never sets ARCADIA_REQUIRE_INLINE_WORKSPACE.
  if (inlineWorkspaceRequired(env)) {
    throw new Error(
      "INLINE_WORKSPACE_REQUIRED: ARCADIA_REQUIRE_INLINE_WORKSPACE is on, so the Discord bot will not fall back to the user config defaultWorkspace. " +
        "Set ARCADIA_WORKSPACE=<path> inline on the command that starts it."
    );
  }

  const defaultWorkspace = loadUserConfig(env).defaultWorkspace;
  if (defaultWorkspace) {
    return path.resolve(defaultWorkspace);
  }

  throw new Error("Set ARCADIA_WORKSPACE or configure an Arcadia default workspace.");
}

/**
 * An identical copy of `inlineWorkspaceRequired` in Arcadia's resolver
 * (src/workspace/resolve.ts): the bot is a separate package with no
 * dependency on Arcadia's sources. It fails closed the same way: any
 * non-empty value other than 0, false, no or off is on.
 * tests/require-inline-workspace.test.ts checks the two agree.
 */
export function inlineWorkspaceRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.ARCADIA_REQUIRE_INLINE_WORKSPACE?.trim().toLowerCase() ?? "";
  return value !== "" && !["0", "false", "no", "off"].includes(value);
}

function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ARCADIA_CONFIG_PATH?.trim()) {
    return path.resolve(env.ARCADIA_CONFIG_PATH);
  }

  if (process.platform === "win32" && env.APPDATA?.trim()) {
    return path.join(env.APPDATA, "Arcadia", "config.json");
  }

  const configHome = env.XDG_CONFIG_HOME?.trim()
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config");
  return path.join(configHome, "arcadia", "config.json");
}

function loadUserConfig(env: NodeJS.ProcessEnv = process.env): { defaultWorkspace?: string } {
  const configPath = userConfigPath(env);
  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, "utf8").trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as { defaultWorkspace?: unknown };
  return {
    defaultWorkspace: typeof parsed.defaultWorkspace === "string" ? parsed.defaultWorkspace : undefined
  };
}

function parsePollInterval(raw: string | undefined): number {
  if (!raw?.trim()) {
    return 60;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 5) {
    throw new Error("ARCADIA_DISCORD_POLL_INTERVAL_SECONDS must be an integer of at least 5.");
  }

  return value;
}
