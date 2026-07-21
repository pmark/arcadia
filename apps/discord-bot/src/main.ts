import { Client, Events, GatewayIntentBits } from "discord.js";
import { ArcadiaCli } from "./arcadia/cli.js";
import { loadConfig } from "./config.js";
import { handleArcadiaInteraction } from "./events/interactionCreate.js";
import { handleArcadiaMessage } from "./events/messageCreate.js";
import { logJson } from "./logging.js";
import { startNotificationPoller } from "./notifications/poller.js";
import { buildOrientationReplyHandler } from "./orientation/handler.js";
import { startOrientationScheduler } from "./orientation/scheduler.js";
import { createDiscordReplyRouter } from "./replyRouter/router.js";
import { discordAdapterStatusPath, removeDiscordAdapterStatus, writeDiscordAdapterStatus } from "./status.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const statusPath = discordAdapterStatusPath(config.arcadiaWorkspace);
  let lastEventAt: string | null = null;
  const heartbeat = (connectionState: "connected" | "connecting" | "disconnected" | "error", state: "running" | "stopped" = "running") => {
    writeDiscordAdapterStatus(statusPath, { state, connectionState, lastEventAt });
  };
  heartbeat("connecting");
  const cli = new ArcadiaCli({
    workspace: config.arcadiaWorkspace,
    cliPath: config.arcadiaCliPath
  });

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  const replyRouter = createDiscordReplyRouter({
    workspace: config.arcadiaWorkspace,
    allowedUserIds: config.allowedUserIds,
    logJson
  });
  replyRouter.registerHandler("orientation", buildOrientationReplyHandler(cli, logJson));

  client.once(Events.ClientReady, (readyClient) => {
    heartbeat("connected");
    logJson("info", {
      msg: "arcadia discord bot ready",
      user: readyClient.user.tag,
      channelId: config.discordChannelId,
      allowedUserCount: config.allowedUserIds.length,
      orientationTargetLocalTime: config.orientationTargetLocalTime
    });
    startNotificationPoller(client, config, cli, logJson);
    startOrientationScheduler(client, config, cli, replyRouter, logJson);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    lastEventAt = new Date().toISOString();
    heartbeat("connected");
    if (!interaction.isChatInputCommand()) {
      return;
    }

    await handleArcadiaInteraction(interaction, config, cli);
  });

  client.on(Events.MessageCreate, async (message) => {
    lastEventAt = new Date().toISOString();
    heartbeat("connected");
    if (message.author.bot) {
      return;
    }
    try {
      const handledByRouter = await replyRouter.handle(message);
      if (handledByRouter) {
        return;
      }
      await handleArcadiaMessage(message, config, cli);
    } catch (error) {
      logJson("error", {
        msg: "discord message handling failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  client.on(Events.Error, (error) => {
    heartbeat("error");
    logJson("error", {
      msg: "discord client error",
      error: error.message
    });
  });

  const heartbeatTimer = setInterval(() => heartbeat(client.isReady() ? "connected" : "connecting"), 5_000);
  const cleanup = () => {
    clearInterval(heartbeatTimer);
    removeDiscordAdapterStatus(statusPath);
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  try {
    await client.login(config.discordBotToken);
  } catch (error) {
    heartbeat("error", "stopped");
    cleanup();
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
