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
  arcadiaCliPath: string | null;
  pollIntervalSeconds: number;
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

  return {
    arcadiaWorkspace: resolveConfiguredWorkspace(env),
    discordBotToken: requireEnv(env, "DISCORD_BOT_TOKEN"),
    discordClientId: requireEnv(env, "DISCORD_CLIENT_ID"),
    discordGuildId: requireEnv(env, "DISCORD_GUILD_ID"),
    discordChannelId: requireEnv(env, "DISCORD_CHANNEL_ID"),
    arcadiaCliPath: env.ARCADIA_CLI_PATH?.trim() ? path.resolve(env.ARCADIA_CLI_PATH) : null,
    pollIntervalSeconds: parsePollInterval(env.ARCADIA_DISCORD_POLL_INTERVAL_SECONDS)
  };
}

function requireEnv(env: NodeJS.ProcessEnv, name: (typeof requiredEnv)[number]): string {
  return env[name]?.trim() ?? "";
}

function resolveConfiguredWorkspace(env: NodeJS.ProcessEnv): string {
  if (env.ARCADIA_WORKSPACE?.trim()) {
    return path.resolve(env.ARCADIA_WORKSPACE);
  }

  const defaultWorkspace = loadUserConfig(env).defaultWorkspace;
  if (defaultWorkspace) {
    return path.resolve(defaultWorkspace);
  }

  throw new Error("Set ARCADIA_WORKSPACE or configure an Arcadia default workspace.");
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
