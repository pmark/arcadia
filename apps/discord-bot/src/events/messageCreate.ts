import type { Message } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { BotConfig } from "../config.js";
import { formatInvalidReviewReply } from "../formatters/requiresReviewFormatter.js";
import { loadReviewMessageState, reviewMessageStatePath } from "../notifications/state.js";

export async function handleArcadiaMessage(
  message: Message,
  config: BotConfig,
  cli: ArcadiaCli
): Promise<void> {
  if (!isAllowedMessage(message, config)) {
    return;
  }

  const replyReviewId = await reviewIdFromReply(message, config.arcadiaWorkspace);
  const slug = replyReviewId ? null : slugFromReply(message.content);
  if (!replyReviewId && !slug) {
    return;
  }

  try {
    const response = await cli.reviewResolveReply(message.content, replyReviewId);
    await message.reply(response.data.confirmation);
  } catch (error) {
    const item = await loadReviewItemForInvalidReply(cli, replyReviewId ?? slug);
    if (item) {
      await message.reply(formatInvalidReviewReply(item));
      return;
    }

    await message.reply(`Arcadia review reply failed: ${error instanceof Error ? error.message : String(error)}`);
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

function slugFromReply(content: string): string | null {
  return /^(R\d+)\b/i.exec(content.trim())?.[1]?.toUpperCase() ?? null;
}

async function loadReviewItemForInvalidReply(cli: ArcadiaCli, idOrSlug: string | null | undefined) {
  if (!idOrSlug) {
    return null;
  }

  try {
    const response = await cli.reviewShow(idOrSlug);
    return response.data.item;
  } catch {
    return null;
  }
}
