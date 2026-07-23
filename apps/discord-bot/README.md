# Arcadia Discord Bot

This app is a lightweight Discord adapter for Arcadia. It reads Arcadia through the CLI, submits requests through `arcadia ask`, posts concise progress notifications, and directs richer decisions back to Arcadia.

Discord is intentionally not an approval, artifact review, deployment, publishing, or spending surface.

## Environment

Required:

```sh
ARCADIA_WORKSPACE=/absolute/path/to/arcadia-workspace
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
DISCORD_CHANNEL_ID=...
```

Optional:

```sh
ARCADIA_CLI_PATH=/absolute/path/to/arcadia
ARCADIA_DISCORD_POLL_INTERVAL_SECONDS=60
```

If `ARCADIA_CLI_PATH` is omitted, the bot looks for the local Arcadia CLI source or built CLI.

## Commands

Install dependencies from the repository root:

```sh
pnpm install
```

Register slash commands:

```sh
pnpm --filter arcadia-discord-bot register
```

Clear all guild slash commands for this app:

```sh
pnpm --filter arcadia-discord-bot unregister
```

Clear all guild slash commands and register the current supported commands:

```sh
pnpm --filter arcadia-discord-bot reregister
```

Run locally:

```sh
pnpm --filter arcadia-discord-bot dev
```

Build and start:

```sh
pnpm --filter arcadia-discord-bot build
pnpm --filter arcadia-discord-bot start
```

## Slash Commands

- `/arcadia status` shows active projects, running work, queued work, Requires Review count, and recent artifacts.
- `/arcadia request text:<request> run-safe:<true|false>` submits a natural-language request through `arcadia ask`; `run-safe:true` immediately runs deterministic safe steps.
- `/arcadia codex` shows active Codex Companion tasks observed by Arcadia, including project association and mission log path when available.
- `/arcadia review` shows current Requires Review items.
- `/arcadia review-show id:<review-id>` shows one Requires Review item.
- `/arcadia review-approve id:<review-id>` approves a Requires Review item and resumes the intended workflow.
- `/arcadia review-reject id:<review-id>` rejects a Requires Review item without executing it.
- `/arcadia review-defer id:<review-id>` keeps a Requires Review item open for future review.
- `/arcadia runs` shows recent execution runs.
- `/arcadia run id:<run-id>` shows one run with mission log, artifacts, Requires Review items, and failure or blocking reason.

Commands only respond in the configured guild and channel.

## Notifications

The bot polls Arcadia and notifies the configured channel when:

- a run fails,
- a run pauses with Requires Review,
- a Discord-submitted run completes,
- an observed Codex task starts, requires review, completes, or fails,
- the Requires Review count transitions from `0` to a positive number,
- a milestone is completed.

The bot suppresses routine artifact generation, mission log updates, intermediate execution steps, and successful runs with no human action required.

Notification state is stored at:

```text
ARCADIA_WORKSPACE/database/discord-notifications.json
```

Discord-submitted ask/work/run correlation is stored separately at:

```text
ARCADIA_WORKSPACE/database/discord-submissions.json
```

The first startup initializes this state silently so old workspace history is not replayed into Discord. Future notable events are posted once.

## Requires Review

Arcadia uses the internal value `requires_review` for work that needs human judgment, and Discord output uses the user-name-agnostic phrase `Requires Review`.

Arcadia remains authoritative for approvals, planning, implementation, and artifact review.

## Codex Companion

Arcadia observes Codex through structured sources and keeps only lightweight coordination state. It does not run Codex from Discord.

Before using `/arcadia codex`, refresh and optionally associate tasks locally:

```sh
pnpm arcadia codex list --workspace "$ARCADIA_WORKSPACE" --active-only
pnpm arcadia codex associate <task-id-or-source-id> --workspace "$ARCADIA_WORKSPACE" --project <project-id>
```

After association, `/arcadia codex` shows the task under its Arcadia project. When the task later completes successfully, Arcadia records a mission log and Discord links that mission log in the completion notification.
