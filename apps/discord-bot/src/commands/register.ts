import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { loadConfig, type BotConfig } from "../config.js";

export function buildArcadiaCommand() {
  return new SlashCommandBuilder()
    .setName("arcadia")
    .setDescription("Read Arcadia awareness summaries")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show a concise Arcadia status summary")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("requires-review")
        .setDescription("Show current Requires Review items")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("runs")
        .setDescription("Show recent Arcadia execution runs")
    )
    .toJSON();
}

export async function registerSlashCommands(config: BotConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordBotToken);
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: [buildArcadiaCommand()] }
  );
}

if (isMainModule()) {
  registerSlashCommands(loadConfig()).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("register.ts") === true || process.argv[1]?.endsWith("register.js") === true;
}
