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

function categorizeAgentAsk(notification: AgentAskNotificationItem): NotificationCategory | null {
  const requestId = notification.requestId ?? "";
  // Something broke: a production red alert, a CI check an agent could not
  // clear, or a settlement whose recovery is incomplete.
  if (
    notification.desiredResult?.startsWith("RED ALERT") ||
    requestId.startsWith("ci-blocked-") ||
    notification.recovery
  ) {
    return "alerts";
  }
  // Needs the operator: a Decision was opened, or a pull request is ready for
  // their call.
  if (notification.intent === "decision" || requestId.startsWith("pr-ready-")) return null;
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
 * Fetch the channel a scheduled post should use: the category's, else the
 * default, falling back to the default when the category channel is missing or
 * not sendable. Returns `null` only when no sendable channel exists at all.
 */
export async function fetchCategoryChannel(
  client: Pick<Client, "channels">,
  config: Pick<BotConfig, "discordChannelId" | "categoryChannels">,
  category: NotificationCategory,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): Promise<{ id: string; send: (payload: { content: string }) => Promise<{ id: string }> } | null> {
  const preferred = resolveCategoryChannel(category, config);
  for (const channelId of preferred === config.discordChannelId ? [preferred] : [preferred, config.discordChannelId]) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && "send" in channel) return channel;
    } catch (error) {
      logJson("warn", { msg: "category channel fetch failed", category, channelId, error: error instanceof Error ? error.message : String(error) });
    }
    logJson("error", { msg: "category channel is not sendable", category, channelId });
  }
  return null;
}
