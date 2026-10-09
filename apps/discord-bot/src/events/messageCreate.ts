import type { Message } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { BotConfig } from "../config.js";
import { formatAskCorrection, formatRequest } from "../formatters/requestFormatter.js";
import { logJson } from "../logging.js";
import {
  askReceiptMessageStatePath,
  discordSubmissionStatePath,
  loadAskReceiptMessageState,
  loadReviewMessageState,
  recordAskReceiptMessage,
  recordDiscordSubmission,
  reviewMessageStatePath
} from "../notifications/state.js";
import { safeReact } from "../replyRouter/router.js";
import { parseAskCorrectionReply } from "./askCorrection.js";

export async function handleArcadiaMessage(
  message: Message,
  config: BotConfig,
  cli: ArcadiaCli
): Promise<void> {
  if (!(await isAllowedMessage(message, config))) {
    return;
  }

  const replyReviewId = await reviewIdFromReply(message, config.arcadiaWorkspace);
  let operation = replyReviewId ? "Decision reply" : "ask";
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

    // A reply to an Ask receipt that starts with `type:` or `project:` corrects that Ask; any other reply is a new Ask.
    const receiptAskId = await askIdFromReceiptReply(message, config.arcadiaWorkspace);
    const correction = receiptAskId ? parseAskCorrectionReply(message.content) : null;
    if (receiptAskId && correction) {
      operation = "correction";
      // Answering a Decision needs a verified sender: DISCORD_ALLOWED_USER_IDS must be set and name the author. An
      // unset list lets the free-text path through, but never lets a reply resolve a Decision.
      const allowed = config.allowedUserIds ?? [];
      if (correction.type === "answer" && (allowed.length === 0 || !allowed.includes(message.author.id))) {
        await message.reply(
          "**Arcadia correction refused**\nAn answer correction needs a verified author: set DISCORD_ALLOWED_USER_IDS to include you, " +
            "or run `arcadia ask correct <ask_id> --type answer --ref <decision>` from the CLI. Nothing was changed."
        );
        return;
      }
      const corrected = await cli.askCorrect(receiptAskId, {
        type: correction.type,
        project: correction.project,
        ref: correction.ref,
        actor: message.author.id
      });
      const sent = await message.reply(formatAskCorrection(corrected.data));
      await rememberReceipt(sent, corrected.data.newAskId, message, config);
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
    const sent = await message.reply(formatRequest(response.data));
    if (response.data.ask) {
      await rememberReceipt(sent, response.data.ask.id, message, config);
    }
  } catch (error) {
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

/** The Ask a reply's parent message is the receipt of, from the receipt-to-Ask mapping the bot recorded. */
async function askIdFromReceiptReply(message: Message, workspace: string): Promise<string | null> {
  const messageId = message.reference?.messageId;
  if (!messageId) {
    return null;
  }

  const state = await loadAskReceiptMessageState(askReceiptMessageStatePath(workspace));
  return state.messages[messageId]?.askId ?? null;
}

/**
 * Records that the receipt just posted names this Ask, so a reply to it can correct it. A failure to record is logged
 * and never fails the reply the operator already has.
 */
async function rememberReceipt(
  sent: { id?: string } | null | undefined,
  askId: string,
  message: Message,
  config: BotConfig
): Promise<void> {
  if (!sent?.id) {
    return;
  }
  try {
    await recordAskReceiptMessage(askReceiptMessageStatePath(config.arcadiaWorkspace), {
      askId,
      channelId: message.channelId,
      messageId: sent.id,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    logJson("warn", { msg: "could not record Ask receipt message", askId, error: error instanceof Error ? error.message : String(error) });
  }
}
