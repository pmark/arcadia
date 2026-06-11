import * as dotenv from "dotenv";
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
  "ARCADIA_WORKSPACE",
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
    arcadiaWorkspace: path.resolve(requireEnv(env, "ARCADIA_WORKSPACE")),
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
