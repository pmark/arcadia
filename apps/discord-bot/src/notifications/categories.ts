import type { Client } from "discord.js";
import type { AgentAskNotificationItem, ExecutionRun } from "../arcadia/types.js";
import type { BotConfig } from "../config.js";
import type { LogLevel } from "../logging.js";

/**
 * Where a proactive notification lands. `alerts` is something is wrong,
 * `briefings` is a scheduled read, `log` is routine progress. Anything that
 * needs the operator's answer or attention is not a category: it stays in the
 * default channel, where replies, review items and the ask ingress live.
 */
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

export const NOTIFICATION_CATEGORIES = ["alerts", "briefings", "log"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type CategoryChannels = Partial<Record<NotificationCategory, string>>;

/** The slice of a notification snapshot the categorizer needs. */
export interface CategorizationContext {
  agentAskNotifications?: AgentAskNotificationItem[];
  runs: Pick<ExecutionRun, "id" | "status">[];
}

/**
 * Categorize one notification by its key. `null` means the default channel.
 * Unknown keys, and anything that needs the operator, return `null`: a message
 * routed nowhere special is still delivered, never dropped.
 */
export function categorizeNotification(key: string, context: CategorizationContext): NotificationCategory | null {
  if (key.startsWith("agent-ask:")) {
    const settlementId = key.slice("agent-ask:".length);
    const notification = (context.agentAskNotifications ?? []).find((candidate) => candidate.settlementId === settlementId);
    return notification ? categorizeAgentAsk(notification) : null;
  }
  if (key.startsWith("blocked:")) return "alerts";
  if (key.startsWith("artifact:") || key.startsWith("milestone:")) return "log";
  if (key.startsWith("run:")) {
    const run = context.runs.find((candidate) => candidate.id === key.slice("run:".length));
    if (run?.status === "failed") return "alerts";
    if (run?.status === "completed") return "log";
    return null;
  }
  if (key.startsWith("codex:")) {
    const event = key.slice(key.lastIndexOf(":") + 1);
    if (event === "failed") return "alerts";
    if (event === "started" || event === "completed") return "log";
    return null;
  }
  // requires-review items and their transition, and anything unrecognized.
  return null;
}

export function categorizeAgentAsk(notification: AgentAskNotificationItem): NotificationCategory | null {
  const requestId = notification.requestId ?? "";
  // A production red alert wins over everything else.
  if (notification.desiredResult?.startsWith("RED ALERT")) return "alerts";
  // Needs the operator: a Decision was opened, or a pull request is ready for
  // their call. These stay in the default channel even when the settlement also
  // carries a recovery note, because that is where they can answer.
  if (notification.intent === "decision" || requestId.startsWith("pr-ready-")) return null;
  // Something broke: a CI check an agent could not clear, or a settlement whose
  // recovery is incomplete.
  if (requestId.startsWith("ci-blocked-") || notification.recovery) return "alerts";
  return "log";
}

/** The channel a category posts to: its configured channel, else the default. */
export function resolveCategoryChannel(
  category: NotificationCategory | null,
  config: Pick<BotConfig, "discordChannelId" | "categoryChannels">
): string {
  return (category && config.categoryChannels[category]) || config.discordChannelId;
}

/**
 * Send to a category's channel. If that channel cannot be sent to, say so and
 * deliver to the default channel instead: a misconfigured or deleted channel
 * costs routing, never the message. A failure in the default channel
 * propagates, so the caller does not mark the notification delivered and the
 * next poll retries, as it did before categories existed.
 */
export async function sendToCategory(
  send: (channelId: string, content: string) => Promise<{ id: string }>,
  config: Pick<BotConfig, "discordChannelId" | "categoryChannels">,
  category: NotificationCategory | null,
  content: string,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): Promise<{ id: string }> {
  const channelId = resolveCategoryChannel(category, config);
  if (channelId === config.discordChannelId) return send(channelId, content);
  try {
    return await send(channelId, content);
  } catch (error) {
    logJson("warn", {
      msg: "category channel unsendable; using default",
      category,
      error: error instanceof Error ? error.message : String(error)
    });
    return send(config.discordChannelId, `(Routed from "${category}", whose channel was unavailable.)\n${content}`);
  }
}

/**
 * The channel a scheduled post should use: the category's, else the default.
 * Its `send` falls back to the default channel when the category channel cannot
 * be fetched, is not sendable, or rejects the send (for example a missing Send
 * Messages permission, which fetches fine). Returns `null` only when no
 * sendable channel exists at all. Delivery is at-least-once: a send that reached
 * Discord but failed on the client can be repeated in the default channel.
 */
export async function fetchCategoryChannel(
  client: Pick<Client, "channels">,
  config: Pick<BotConfig, "discordChannelId" | "categoryChannels">,
  category: NotificationCategory,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): Promise<{ id: string; send: (payload: { content: string }) => Promise<{ id: string }> } | null> {
  type Sendable = { id: string; send: (payload: { content: string }) => Promise<{ id: string }> };
  const fetchSendable = async (channelId: string): Promise<Sendable | null> => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && "send" in channel) return channel;
    } catch (error) {
      logJson("warn", { msg: "category channel fetch failed", category, channelId, error: error instanceof Error ? error.message : String(error) });
    }
    return null;
  };

  const preferredId = resolveCategoryChannel(category, config);
  const preferred = await fetchSendable(preferredId);
  if (preferredId === config.discordChannelId) {
    if (!preferred) logJson("error", { msg: "category channel is not sendable", category, channelId: preferredId });
    return preferred;
  }
  if (!preferred) {
    logJson("warn", { msg: "category channel is not sendable; using default", category, channelId: preferredId });
    const fallback = await fetchSendable(config.discordChannelId);
    if (!fallback) logJson("error", { msg: "default channel is not sendable", category, channelId: config.discordChannelId });
    return fallback;
  }
  return {
    id: preferred.id,
    send: async (payload) => {
      try {
        return await preferred.send(payload);
      } catch (error) {
        logJson("warn", {
          msg: "category channel rejected the send; using default",
          category,
          channelId: preferredId,
          error: error instanceof Error ? error.message : String(error)
        });
        const fallback = await fetchSendable(config.discordChannelId);
        if (!fallback) throw error;
        // The caller already truncated to Discord's limit; the note must fit inside it too.
        const note = `(Routed from "${category}", whose channel rejected the post.)\n`;
        return fallback.send({ content: note + payload.content.slice(0, Math.max(0, DISCORD_MAX_MESSAGE_LENGTH - note.length)) });
      }
    }
  };
}
