# Discord Bot Setup Checklist

Current milestone: Discord bot operational for Arcadia request intake, safe execution, status readout, and notifications.

Next action: Create the Discord application, fill the bot environment, register slash commands, and run one real `/arcadia request` smoke test.

Work classification: Operational setup with a small product boundary backlog.

Required artifacts:
- `apps/discord-bot/.env`
- Discord application and bot installed in the target server
- Registered `/arcadia` slash commands
- `ARCADIA_WORKSPACE/database/discord-notifications.json`
- `ARCADIA_WORKSPACE/database/discord-submissions.json`
- One verified Discord-origin request/run record

## 1. Verify Local Arcadia Is Ready

- [x] Confirm Node.js `>=20` is installed. Verified `v25.6.1`.
- [x] Confirm `pnpm` is installed. Verified `11.5.1`.
- [x] From the repo root, run `pnpm install`. Verified with `pnpm install --frozen-lockfile`.
- [x] From the repo root, run `pnpm build`.
- [x] From the repo root, run `pnpm test`.
- [ ] Choose the real Arcadia workspace path to use for Discord.
- [ ] If the workspace does not exist yet, initialize it with `pnpm arcadia init <workspace>`.
- [ ] Confirm the workspace can answer status with `pnpm arcadia status --workspace <workspace>`.
- [ ] Confirm the workspace has at least one project and active milestone for useful request routing.
- [ ] For project-specific work, add or verify project metadata with repo path and validation command using `pnpm arcadia project metadata --workspace <workspace> ...`.

Local verification note:
- `pnpm smoke` passed against `tmp/demo-workspace`.
- `pnpm arcadia status --workspace tmp/demo-workspace` passed for the smoke workspace.
- Real Discord operation still requires selecting and verifying the actual private Arcadia workspace.

## 2. Create And Install The Discord Bot

- [ ] Create a Discord application in the Discord Developer Portal.
- [ ] Create a bot user for that application.
- [ ] Copy the bot token for `DISCORD_BOT_TOKEN`.
- [ ] Copy the application/client id for `DISCORD_CLIENT_ID`.
- [ ] Enable the bot permissions needed to read slash command interactions and send messages in the target channel.
- [ ] Install the bot into the target Discord server.
- [ ] Copy the server id for `DISCORD_GUILD_ID`.
- [ ] Create or choose the Arcadia channel.
- [ ] Copy the channel id for `DISCORD_CHANNEL_ID`.
- [ ] Confirm the bot can see and send messages in that channel.

## 3. Configure The Bot Environment

- [ ] Create `apps/discord-bot/.env` from `apps/discord-bot/.env.example`.
- [ ] Set `ARCADIA_WORKSPACE=/absolute/path/to/arcadia-workspace`.
- [ ] Set `DISCORD_BOT_TOKEN`.
- [ ] Set `DISCORD_CLIENT_ID`.
- [ ] Set `DISCORD_GUILD_ID`.
- [ ] Set `DISCORD_CHANNEL_ID`.
- [ ] Optional: set `ARCADIA_CLI_PATH` only if the bot should use a specific built CLI instead of the local source/built CLI autodetection.
- [ ] Optional: set `ARCADIA_DISCORD_POLL_INTERVAL_SECONDS=60` or another desired polling interval.
- [ ] Keep `.env` out of git.

## 4. Register Slash Commands

- [ ] From the repo root, run `pnpm --filter arcadia-discord-bot register`.
- [ ] In Discord, verify `/arcadia` appears in the configured server.
- [ ] Verify these subcommands appear:
  - [ ] `/arcadia status`
  - [ ] `/arcadia request`
  - [ ] `/arcadia requires-review`
  - [ ] `/arcadia runs`
  - [ ] `/arcadia run`
- [ ] If commands do not appear, recheck `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, and bot installation.

## 5. Run The Bot

- [ ] For local development, run `pnpm --filter arcadia-discord-bot dev`.
- [ ] For built operation, run `pnpm --filter arcadia-discord-bot build`.
- [ ] Start the built bot with `pnpm --filter arcadia-discord-bot start`.
- [ ] Confirm startup logs show the bot is ready.
- [ ] Confirm first startup creates or initializes notification state without replaying old workspace history.

## 6. Smoke Test Discord Usage

- [ ] In the configured channel, run `/arcadia status`.
- [ ] Confirm the response shows projects, running work, queued work, Requires Review count, and recent artifacts.
- [ ] Run `/arcadia request text:<small real request> run-safe:false`.
- [ ] Confirm Discord returns ask id, work item id, plan id, classification, gate or Requires Review count, and packet path when applicable.
- [ ] Run `/arcadia runs`.
- [ ] Run `/arcadia run id:<run-id>` for the created or latest run.
- [ ] Run `/arcadia requires-review`.
- [ ] Run `/arcadia request text:<safe deterministic request> run-safe:true`.
- [ ] Confirm safe steps execute and Discord can report completion, failure, or Requires Review with artifact and mission log paths.
- [ ] Confirm `ARCADIA_WORKSPACE/database/discord-submissions.json` records Discord-origin ask/work/run correlation.
- [ ] Confirm `ARCADIA_WORKSPACE/database/discord-notifications.json` records posted notification state.

## 7. Operating Boundaries To Remember

- [ ] Use Discord for request intake, safe deterministic progression, status, run inspection, Requires Review visibility, and notifications.
- [ ] Use Arcadia/local review for approvals.
- [ ] Use Arcadia/local review for artifact review.
- [ ] Use explicit local commands for Codex planning or Codex build execution.
- [ ] Do not expect Discord to approve gates.
- [ ] Do not expect Discord to run Codex build steps.
- [ ] Do not expect Discord to publish, deploy, post to social platforms, send messages, spend money, or use credentials.

## 8. Remaining Tasks Blocking A Fuller Discord Work Surface

- [ ] Decide whether Discord should ever support approvals. If yes, design an explicit approval model with audit records, allowed approvers, timeout behavior, and rollback rules.
- [ ] Decide whether Discord should ever trigger Codex planning or build execution. If yes, add explicit allowlisted commands and require visible confirmation before `--allow-codex-planning` or `--allow-codex-build`.
- [ ] Define artifact review behavior for Discord, or keep artifact review local-only.
- [ ] Define credential handling policy. Current expected behavior is no credential use from Discord.
- [ ] Define publishing/deployment/social-posting policy. Current expected behavior is no publishing from Discord.
- [ ] Migrate remaining user-facing CLI/report labels from legacy `Needs Mark` wording to `Requires Review` while preserving internal compatibility.
- [ ] Add a deployment choice if the bot should run continuously outside a local terminal, such as launchd, a server, or a container.
- [ ] Add operational logging and restart policy for the chosen always-on runtime.
- [ ] Add a short runbook for rotating `DISCORD_BOT_TOKEN`.
- [ ] Add a recovery runbook for deleting stale `discord-notifications.json` or `discord-submissions.json` only when duplicate/missing notifications are understood.

## 9. Done Criteria

- [ ] `/arcadia status` works in Discord.
- [ ] `/arcadia request` creates real Arcadia work from Discord.
- [ ] `/arcadia request ... run-safe:true` can run deterministic safe steps.
- [ ] `/arcadia runs` and `/arcadia run` expose the resulting audit trail.
- [ ] Requires Review items are visible from Discord.
- [ ] Failed, blocked, Requires Review, completed milestone, and Discord-origin completed-run notifications are understood.
- [ ] Approval, credential, publishing, and Codex execution boundaries are documented and intentionally handled outside Discord.
