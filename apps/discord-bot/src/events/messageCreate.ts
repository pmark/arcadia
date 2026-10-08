import type { Message } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { BotConfig } from "../config.js";
import { formatRequest } from "../formatters/requestFormatter.js";
import { logJson } from "../logging.js";
import {
  discordSubmissionStatePath,
  loadReviewMessageState,
  recordDiscordSubmission,
  reviewMessageStatePath
} from "../notifications/state.js";
import { safeReact } from "../replyRouter/router.js";

export async function handleArcadiaMessage(
  message: Message,
  config: BotConfig,
  cli: ArcadiaCli
): Promise<void> {
  if (!(await isAllowedMessage(message, config))) {
    return;
  }

  const replyReviewId = await reviewIdFromReply(message, config.arcadiaWorkspace);
  try {
    if (replyReviewId) {
      const response = await cli.reviewResolveReply(message.content, replyReviewId, { actor: message.author.id });
      let confirmation = response.data.confirmation;
      if (
        response.data.item.resolvedIntent === "ActionClarification" &&
        response.data.action === "approved" &&
        response.data.item.workItemId
      ) {
        await message.reply(
          `**Arcadia answer recorded**\n${response.data.item.slug} is saved. I’m continuing clarification now; this did not approve execution.`
        );
        try {
          const continuation = await cli.clarify(response.data.item.workItemId);
          const evaluation = continuation.data.evaluated[0];
          if (evaluation?.verdict.verdict === "clarified") {
            confirmation = `${response.data.item.slug} answer recorded. Action clarified.\nNext Action: ${evaluation.verdict.nextAction}`;
          } else if (evaluation?.verdict.verdict === "question_open") {
            confirmation = `${response.data.item.slug} answer recorded. Arcadia has one focused follow-up question and will post it for review.`;
          } else {
            confirmation = `${response.data.item.slug} answer recorded. The related Action remains ready for clarification.`;
          }
        } catch {
          confirmation = `${response.data.item.slug} answer recorded. Automatic clarification is unavailable right now; the Action remains ready to continue.`;
        }
        await message.reply(`**Arcadia clarification updated**\n${confirmation}`);
        return;
      }
      await message.reply(`**Arcadia Decision updated**\n${confirmation}`);
      return;
    }

    const response = await cli.ask(message.content, {
      sourceIngress: "discord.message",
      replyReviewId: null
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
    const operation = replyReviewId ? "Decision reply" : "ask";
    await message.reply(`Arcadia ${operation} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Guild and channel gating always apply. When `DISCORD_ALLOWED_USER_IDS` is
 * configured the author must also be listed; a refused author gets the reply
 * router's refusal reaction. When it is empty the bot fails open to guild and
 * channel gating only (loadConfig logs a startup warning), so an unset value
 * never locks the operator out.
 */
async function isAllowedMessage(message: Message, config: BotConfig): Promise<boolean> {
  if (message.author.bot || message.guildId !== config.discordGuildId || message.channelId !== config.discordChannelId) {
    return false;
  }
  const allowedUserIds = config.allowedUserIds ?? [];
  if (allowedUserIds.length === 0 || allowedUserIds.includes(message.author.id)) {
    return true;
  }
  await safeReact(message, "🚫");
  logJson("info", { msg: "discord message refused: author not in DISCORD_ALLOWED_USER_IDS", authorId: message.author.id });
  return false;
}

async function reviewIdFromReply(message: Message, workspace: string): Promise<string | null> {
  const messageId = message.reference?.messageId;
  if (!messageId) {
    return null;
  }

  const state = await loadReviewMessageState(reviewMessageStatePath(workspace));
  return state.messages[messageId]?.reviewId ?? null;
}
