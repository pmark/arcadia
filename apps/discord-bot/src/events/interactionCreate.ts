import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { BotConfig } from "../config.js";
import { requestCommand } from "../commands/request.js";
import { requiresReviewCommand } from "../commands/requiresReview.js";
import { runsCommand } from "../commands/runs.js";
import { statusCommand } from "../commands/status.js";

export async function handleArcadiaInteraction(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  cli: ArcadiaCli
): Promise<void> {
  if (interaction.commandName !== "arcadia") {
    return;
  }

  if (!isAllowedLocation(interaction, config)) {
    await interaction.reply({
      content: "Arcadia Discord awareness is available only in the configured Arcadia channel.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply();

  try {
    const subcommand = interaction.options.getSubcommand();
    const content = await runSubcommand(interaction, subcommand, cli);
    await interaction.editReply({ content });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply({ content: `Arcadia command failed: ${message}` });
  }
}

function isAllowedLocation(interaction: ChatInputCommandInteraction, config: BotConfig): boolean {
  return interaction.guildId === config.discordGuildId && interaction.channelId === config.discordChannelId;
}

function runSubcommand(
  interaction: ChatInputCommandInteraction,
  subcommand: string,
  cli: ArcadiaCli
): Promise<string> {
  if (subcommand === "status") {
    return statusCommand(cli);
  }

  if (subcommand === "request") {
    return requestCommand(cli, interaction.options.getString("text", true));
  }

  if (subcommand === "requires-review") {
    return requiresReviewCommand(cli);
  }

  if (subcommand === "runs") {
    return runsCommand(cli);
  }

  return Promise.resolve("Unknown Arcadia command.");
}
