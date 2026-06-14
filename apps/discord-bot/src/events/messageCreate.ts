import type { Message } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { BotConfig } from "../config.js";
import { formatRequest } from "../formatters/requestFormatter.js";
import {
  discordSubmissionStatePath,
  loadReviewMessageState,
  recordDiscordSubmission,
  reviewMessageStatePath
} from "../notifications/state.js";

export async function handleArcadiaMessage(
  message: Message,
  config: BotConfig,
  cli: ArcadiaCli
): Promise<void> {
  if (!isAllowedMessage(message, config)) {
    return;
  }

  const replyReviewId = await reviewIdFromReply(message, config.arcadiaWorkspace);
  try {
    const response = await cli.ask(message.content, {
      sourceIngress: "discord.message",
      replyReviewId
    });
    if (response.data.ask) {
      await recordDiscordSubmission(discordSubmissionStatePath(config.arcadiaWorkspace), {
        askId: response.data.ask.id,
        workItemId: response.data.workItem?.id ?? null,
        runId: response.data.run?.id ?? null
      });
    }
    await message.reply(formatRequest(response.data));
  } catch (error) {
    await message.reply(`Arcadia ask failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isAllowedMessage(message: Message, config: BotConfig): boolean {
  return !message.author.bot && message.guildId === config.discordGuildId && message.channelId === config.discordChannelId;
}

async function reviewIdFromReply(message: Message, workspace: string): Promise<string | null> {
  const messageId = message.reference?.messageId;
  if (!messageId) {
    return null;
  }

  const state = await loadReviewMessageState(reviewMessageStatePath(workspace));
  return state.messages[messageId]?.reviewId ?? null;
}
