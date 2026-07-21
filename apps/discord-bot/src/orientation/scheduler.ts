import type { Client } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { BotConfig } from "../config.js";
import type { LogLevel } from "../logging.js";
import type { DiscordReplyRouter } from "../replyRouter/router.js";

/**
 * Checks on an interval whether the Daily Orientation Packet is due (local
 * clock time has passed the configured target) and, if so, composes it
 * (idempotent per local day via `orientation packet compose --if-due`),
 * pushes it to the configured channel, and registers the sent message with
 * the shared Discord Reply Router so a threaded reply routes to the
 * orientation correction loop.
 *
 * A missed tick (bot down at the target time) self-catches-up on the next
 * tick after restart — the idempotency guard is the local date, not the
 * clock, so there is no dependency on firing at exactly the target minute.
 */
export function startOrientationScheduler(
  client: Client,
  config: BotConfig,
  cli: ArcadiaCli,
  router: DiscordReplyRouter,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    try {
      if (isPastTargetLocalTime(config.orientationTargetLocalTime)) {
        await maybeSendPacket(client, config, cli, router, logJson);
      }
    } catch (error) {
      logJson("error", {
        msg: "orientation scheduler tick failed",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), config.orientationCheckIntervalSeconds * 1000);
      }
    }
  };

  timer = setTimeout(() => void tick(), 0);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Discord rejects any message over 2000 characters outright (a class of bug
 * already seen in this bot's notification poller). The packet is normally far
 * short of that, but a growing ledger must never be able to crash the send.
 */
function truncateForDiscord(content: string): string {
  if (content.length <= DISCORD_MAX_MESSAGE_LENGTH) {
    return content;
  }
  const suffix = "\n\n… (truncated — see `arcadia orientation entry list`)";
  return `${content.slice(0, DISCORD_MAX_MESSAGE_LENGTH - suffix.length)}${suffix}`;
}

function isPastTargetLocalTime(targetLocalTime: string): boolean {
  const [targetHour, targetMinute] = targetLocalTime.split(":").map((part) => Number.parseInt(part, 10));
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = targetHour * 60 + targetMinute;
  return nowMinutes >= targetMinutes;
}

async function maybeSendPacket(
  client: Client,
  config: BotConfig,
  cli: ArcadiaCli,
  router: DiscordReplyRouter,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): Promise<void> {
  const composed = await cli.orientationPacketCompose(true);

  if (!composed.ok) {
    logJson("error", { msg: "orientation packet compose failed", error: composed.error });
    return;
  }

  if (composed.data.alreadySent || !composed.data.packet) {
    return;
  }

  const packet = composed.data.packet;
  const channel = await client.channels.fetch(config.discordChannelId);
  if (!channel || !("send" in channel)) {
    logJson("error", { msg: "orientation channel is not sendable", channelId: config.discordChannelId });
    return;
  }

  const sent = await channel.send({ content: truncateForDiscord(packet.body) });

  await router.register({
    messageId: sent.id,
    feature: "orientation",
    entityId: "ledger",
    createdAt: new Date().toISOString()
  });

  const markSent = await cli.orientationPacketMarkSent(packet.id, sent.id);
  if (!markSent.ok) {
    logJson("error", { msg: "orientation packet mark-sent failed", error: markSent.error });
  }

  logJson("info", { msg: "orientation packet sent", packetId: packet.id, localDate: packet.localDate, messageId: sent.id });
}
