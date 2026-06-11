import { Client, Events, GatewayIntentBits } from "discord.js";
import { ArcadiaCli } from "./arcadia/cli.js";
import { loadConfig } from "./config.js";
import { handleArcadiaInteraction } from "./events/interactionCreate.js";
import { logJson } from "./logging.js";
import { startNotificationPoller } from "./notifications/poller.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const cli = new ArcadiaCli({
    workspace: config.arcadiaWorkspace,
    cliPath: config.arcadiaCliPath
  });

  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  client.once(Events.ClientReady, (readyClient) => {
    logJson("info", {
      msg: "arcadia discord bot ready",
      user: readyClient.user.tag,
      channelId: config.discordChannelId
    });
    startNotificationPoller(client, config, cli, logJson);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    await handleArcadiaInteraction(interaction, config, cli);
  });

  client.on(Events.Error, (error) => {
    logJson("error", {
      msg: "discord client error",
      error: error.message
    });
  });

  await client.login(config.discordBotToken);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
