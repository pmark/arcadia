import type { Message } from "discord.js";
import type { LogLevel } from "../logging.js";
import { loadReplyRouterState, registerMessage, replyRouterStatePath, type RegisteredMessage, type ReplyFeature } from "./state.js";

export interface IncomingReply {
  feature: ReplyFeature;
  entityId: string;
  authorId: string;
  text: string;
  messageId: string;
  inReplyTo: string;
}

export type ReplyAck =
  | { kind: "applied"; note?: string }
  | { kind: "clarify"; question: string }
  | { kind: "rejected"; reason: string };

export type ReplyHandler = (reply: IncomingReply) => Promise<ReplyAck>;

export interface DiscordReplyRouter {
  register(message: RegisteredMessage): Promise<void>;
  registerHandler(feature: ReplyFeature, handler: ReplyHandler): void;
  /**
   * Returns true if `message` was a reply to a message this router registered
   * (whether or not it was ultimately authorized/applied) — the caller should
   * skip any other message handling in that case. Returns false for a reply
   * to an unregistered message, or a non-reply, so the caller's existing
   * behavior (e.g. handleArcadiaMessage) runs unchanged.
   */
  handle(message: Message): Promise<boolean>;
}

export interface DiscordReplyRouterOptions {
  workspace: string;
  allowedUserIds: string[];
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void;
}

export function createDiscordReplyRouter(options: DiscordReplyRouterOptions): DiscordReplyRouter {
  const handlers = new Map<ReplyFeature, ReplyHandler>();
  const statePath = replyRouterStatePath(options.workspace);

  return {
    async register(message: RegisteredMessage): Promise<void> {
      await registerMessage(statePath, message);
    },

    registerHandler(feature: ReplyFeature, handler: ReplyHandler): void {
      handlers.set(feature, handler);
    },

    async handle(message: Message): Promise<boolean> {
      const referenceId = message.reference?.messageId;
      if (!referenceId) {
        return false;
      }

      let registered: RegisteredMessage | undefined;
      try {
        const state = await loadReplyRouterState(statePath);
        registered = state.messages[referenceId];
      } catch (error) {
        options.logJson("error", {
          msg: "reply router state load failed",
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      }

      if (!registered) {
        return false;
      }

      if (!options.allowedUserIds.includes(message.author.id)) {
        await safeReact(message, "🚫");
        options.logJson("info", {
          msg: "reply router rejected unauthorized author",
          authorId: message.author.id,
          feature: registered.feature,
          entityId: registered.entityId
        });
        return true;
      }

      const handler = handlers.get(registered.feature);
      if (!handler) {
        await safeReact(message, "🚫");
        options.logJson("error", { msg: "reply router has no handler registered", feature: registered.feature });
        return true;
      }

      try {
        const ack = await handler({
          feature: registered.feature,
          entityId: registered.entityId,
          authorId: message.author.id,
          text: message.content,
          messageId: message.id,
          inReplyTo: referenceId
        });
        await applyAck(message, ack);
      } catch (error) {
        options.logJson("error", {
          msg: "reply router handler threw",
          feature: registered.feature,
          error: error instanceof Error ? error.message : String(error)
        });
        await safeReact(message, "❓");
      }

      return true;
    }
  };
}

async function applyAck(message: Message, ack: ReplyAck): Promise<void> {
  if (ack.kind === "applied") {
    await safeReact(message, "✅");
    if (ack.note) {
      await safeReply(message, ack.note);
    }
    return;
  }
  if (ack.kind === "clarify") {
    await safeReact(message, "❓");
    await safeReply(message, ack.question);
    return;
  }
  await safeReact(message, "🚫");
  await safeReply(message, ack.reason);
}

async function safeReact(message: Message, emoji: string): Promise<void> {
  try {
    await message.react(emoji);
  } catch {
    // Reaction failures (missing permission, deleted message) must never
    // crash the gateway handler.
  }
}

async function safeReply(message: Message, content: string): Promise<void> {
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false } });
  } catch {
    // Same tolerance as safeReact.
  }
}
