import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { loadConfig, type BotConfig } from "../config.js";

export function buildArcadiaCommand() {
  return new SlashCommandBuilder()
    .setName("arcadia")
    .setDescription("Read Arcadia summaries and submit requests")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show a concise Arcadia status summary")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("review")
        .setDescription("Show current Requires Review items")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("review-show")
        .setDescription("Show one Requires Review item")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("Requires Review item id")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("review-approve")
        .setDescription("Approve a Requires Review item and continue the intended workflow")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("Requires Review item id")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("review-reject")
        .setDescription("Reject a Requires Review item without executing it")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("Requires Review item id")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("review-defer")
        .setDescription("Keep a Requires Review item open for future review")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("Requires Review item id")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("codex")
        .setDescription("Show active Codex Companion tasks")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("request")
        .setDescription("Submit an Arcadia request")
        .addStringOption((option) =>
          option
            .setName("text")
            .setDescription("Natural-language request")
            .setRequired(true)
        )
        .addBooleanOption((option) =>
          option
            .setName("run-safe")
            .setDescription("Immediately run deterministic safe steps after creating the request")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("runs")
        .setDescription("Show recent Arcadia execution runs")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("run")
        .setDescription("Show one Arcadia execution run")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("Execution run id")
            .setRequired(true)
        )
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

export async function unregisterSlashCommands(config: BotConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordBotToken);
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: [] }
  );
}

export async function reregisterSlashCommands(config: BotConfig): Promise<void> {
  await unregisterSlashCommands(config);
  await registerSlashCommands(config);
}

if (isMainModule()) {
  runSlashCommandMaintenance(process.argv[2], loadConfig()).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

async function runSlashCommandMaintenance(action = "register", config: BotConfig): Promise<void> {
  switch (action) {
    case "register":
      await registerSlashCommands(config);
      return;
    case "unregister":
      await unregisterSlashCommands(config);
      return;
    case "reregister":
      await reregisterSlashCommands(config);
      return;
    default:
      throw new Error("Usage: register.ts [register|unregister|reregister]");
  }
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("register.ts") === true || process.argv[1]?.endsWith("register.js") === true;
}
