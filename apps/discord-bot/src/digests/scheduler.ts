import type { Client } from "discord.js";
import type { ArcadiaCli } from "../arcadia/cli.js";
import type { DigestRunEntry } from "../arcadia/types.js";
import type { BotConfig } from "../config.js";
import type { LogLevel } from "../logging.js";

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Checks on an interval whether any narrative digest cadence is due and, if so,
 * composes every active Project's digest plus the collective portfolio roll-up
 * for each completed day, week, and month window, then posts each one.
 *
 * This is the orientation scheduler's mechanism applied to a set rather than a
 * single packet. Three properties carry over deliberately:
 *
 * - **Idempotency is stored, not timed.** `digest run --if-due` composes only
 *   (scope, cadence, window) pairs that have no row yet, so a tick that fires
 *   ten times an hour still produces one digest per Project per period.
 * - **A missed tick self-catches-up.** The window is derived from the completed
 *   calendar period, not from when the tick fired, so a bot that was down
 *   overnight composes the same window on its first tick after restart.
 * - **Delivery is recorded separately from composition.** A digest composed but
 *   never posted comes back as `pending-delivery` on the next tick instead of
 *   being lost behind the once-per-period guard.
 *
 * Failure isolation lives in the CLI, which returns one entry per subject and
 * never lets one Project's failure end the run. This process's job is to report
 * those failures and keep posting the rest.
 */
export function startDigestScheduler(
  client: Client,
  config: BotConfig,
  cli: ArcadiaCli,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    try {
      // A run can take minutes (one local narration per Project per cadence).
      // Overlapping runs would race on the same rows and double-post.
      if (running || !isPastTargetLocalTime(config.digestTargetLocalTime)) return;
      running = true;
      try {
        await runDueDigests(client, config, cli, logJson);
      } finally {
        running = false;
      }
    } catch (error) {
      logJson("error", {
        msg: "digest scheduler tick failed",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), config.digestCheckIntervalSeconds * 1000);
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

async function runDueDigests(
  client: Client,
  config: BotConfig,
  cli: ArcadiaCli,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): Promise<void> {
  const run = await cli.digestRun();
  if (!run.ok) {
    logJson("error", { msg: "digest run failed", error: run.error });
    return;
  }

  for (const failure of run.data.entries.filter((entry) => entry.status === "failed")) {
    logJson("error", {
      msg: "digest composition failed",
      subject: failure.subject,
      period: failure.period,
      window: failure.windowLabel,
      error: failure.error
    });
  }

  if (run.data.pending.length === 0) return;

  const channel = await client.channels.fetch(config.discordChannelId);
  if (!channel || !("send" in channel)) {
    logJson("error", { msg: "digest channel is not sendable", channelId: config.discordChannelId });
    return;
  }

  for (const entry of run.data.pending) {
    // One subject's delivery failure is logged and skipped for the same reason
    // one subject's composition failure is: the other digests are still good,
    // and an unposted one returns as pending-delivery on the next tick.
    try {
      await postDigest(channel, cli, entry, logJson);
    } catch (error) {
      logJson("error", {
        msg: "digest delivery failed",
        subject: entry.subject,
        period: entry.period,
        digestId: entry.digestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

async function postDigest(
  channel: { send: (payload: { content: string }) => Promise<{ id: string }> },
  cli: ArcadiaCli,
  entry: DigestRunEntry,
  logJson: (level: LogLevel, obj: Record<string, unknown>) => void
): Promise<void> {
  if (!entry.body || !entry.digestId) {
    logJson("error", { msg: "digest is pending delivery with no body", subject: entry.subject, period: entry.period });
    return;
  }

  const sent = await channel.send({ content: truncateForDiscord(entry.body, entry.digestId) });
  const marked = await cli.digestMarkPosted(entry.digestId, sent.id);
  if (!marked.ok) {
    // Worth surfacing loudly: an unrecorded delivery means the next tick will
    // treat this digest as pending and post it again.
    logJson("error", { msg: "digest mark-posted failed", digestId: entry.digestId, error: marked.error });
    return;
  }

  logJson("info", {
    msg: "digest posted",
    digestId: entry.digestId,
    scope: entry.scope,
    subject: entry.subject,
    period: entry.period,
    window: entry.windowLabel,
    factCount: entry.factCount,
    messageId: sent.id
  });
}

function isPastTargetLocalTime(targetLocalTime: string): boolean {
  const [targetHour, targetMinute] = targetLocalTime.split(":").map((part) => Number.parseInt(part, 10));
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= targetHour * 60 + targetMinute;
}

/**
 * Discord rejects any message over 2000 characters outright. A narrated digest
 * is normally far shorter, but a busy month must not be able to crash the send.
 */
function truncateForDiscord(content: string, digestId: string): string {
  if (content.length <= DISCORD_MAX_MESSAGE_LENGTH) {
    return content;
  }
  const suffix = `\n\n… (truncated — see \`arcadia digest export ${digestId}\`)`;
  return `${content.slice(0, DISCORD_MAX_MESSAGE_LENGTH - suffix.length)}${suffix}`;
}
