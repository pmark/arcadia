import type { ArcadiaCli } from "../arcadia/cli.js";
import type { OperatorPingItem } from "../arcadia/types.js";
import type { BotConfig } from "../config.js";
import type { LogLevel } from "../logging.js";

const KIND_HEADLINE: Record<OperatorPingItem["kind"], string> = {
  look: "👀 Take a look",
  fyi: "ℹ️ FYI",
  attention: "🔔 Needs your attention"
};

export interface ResolvedPingChannel {
  channelId: string;
  /** Set when the ping asked for a channel the operator has not configured. */
  unconfigured: string | null;
}

/**
 * An agent names a channel; the operator's `DISCORD_PING_CHANNELS` decides
 * whether that name reaches anywhere. An alias or one of the listed channel
 * ids resolves; anything else falls back to the default channel rather than
 * dropping the ping, so a typo costs routing, never the message.
 */
export function resolvePingChannel(
  requested: string | null,
  config: Pick<BotConfig, "discordChannelId" | "pingChannels">
): ResolvedPingChannel {
  if (requested === null) return { channelId: config.discordChannelId, unconfigured: null };
  const byAlias = config.pingChannels[requested];
  if (byAlias) return { channelId: byAlias, unconfigured: null };
  const listedId = Object.values(config.pingChannels).find((id) => id === requested);
  if (listedId) return { channelId: listedId, unconfigured: null };
  if (requested === config.discordChannelId) return { channelId: config.discordChannelId, unconfigured: null };
  return { channelId: config.discordChannelId, unconfigured: requested };
}

export function operatorPingMessage(ping: OperatorPingItem, unconfiguredChannel: string | null = null): string {
  return [
    `${KIND_HEADLINE[ping.kind]}${ping.agent ? ` — ${ping.agent}` : ""}`,
    ping.message,
    ...(ping.link ? [ping.link] : []),
    ...(unconfiguredChannel ? [`(Channel "${unconfiguredChannel}" is not configured, so this came here.)`] : []),
    "_Ping only — nothing to approve or answer here._"
  ].join("\n");
}

type Log = (level: LogLevel, obj: Record<string, unknown>) => void;

/**
 * Drain the operator-ping outbox. Each ping is recorded as delivered only
 * after Discord accepted it, so a failed send stays queued for the next poll.
 * A failure to reach a named channel retries once in the default channel; a
 * failure there stops the batch, since the rest would fail the same way.
 */
export async function drainOperatorPings(
  cli: Pick<ArcadiaCli, "operatorPings" | "operatorPingSent">,
  config: Pick<BotConfig, "discordChannelId" | "pingChannels">,
  send: (channelId: string, content: string) => Promise<{ id: string }>,
  logJson: Log
): Promise<number> {
  const { pings } = (await cli.operatorPings()).data;
  let delivered = 0;
  for (const ping of pings) {
    const target = resolvePingChannel(ping.channel, config);
    let sent: { id: string };
    try {
      sent = await send(target.channelId, operatorPingMessage(ping, target.unconfigured));
    } catch (error) {
      if (target.channelId === config.discordChannelId) {
        logJson("error", { msg: "operator ping send failed", pingId: ping.id, error: errorText(error) });
        return delivered;
      }
      logJson("warn", { msg: "operator ping channel unsendable; using default", pingId: ping.id, channel: ping.channel, error: errorText(error) });
      try {
        sent = await send(config.discordChannelId, operatorPingMessage(ping, ping.channel));
      } catch (fallbackError) {
        logJson("error", { msg: "operator ping send failed", pingId: ping.id, error: errorText(fallbackError) });
        return delivered;
      }
    }
    await cli.operatorPingSent(ping.id, sent.id);
    delivered += 1;
    logJson("info", { msg: "discord operator ping sent", pingId: ping.id });
  }
  return delivered;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
