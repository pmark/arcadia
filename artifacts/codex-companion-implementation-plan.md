# Codex Companion v0 Implementation Plan

Current milestone: Codex Companion v0.

Next action: Configure the Discord bot against the real Arcadia workspace and verify `/arcadia codex` with live Codex state.

Work classification: Codex implementation.

Required artifacts:
- Architecture note
- Implementation plan
- Working CLI and Discord implementation
- Tests
- Discord usage documentation
- Mission log entry

## Scope

Build the smallest useful integration between Arcadia and Codex:

1. Observe current Codex work from structured sources.
2. Store last observed snapshots in Arcadia SQLite.
3. Associate observed Codex tasks with Arcadia projects.
4. Display active Codex tasks in Discord.
5. Notify Discord on meaningful status transitions.
6. Write a mission log when associated Codex work completes.

## Delivered Slices

1. Schema
   - Add `codex_tasks`.
   - Store source, source id, title, status, URL, summary, Codex update time, Arcadia association, and mission log link.

2. Observation
   - Read `codex cloud list --json`.
   - Read local Codex goal SQLite stores read-only.
   - Provide fixture support for deterministic tests.

3. CLI
   - `arcadia codex list --workspace <path> [--active-only] [--source all|local-goals|cloud] [--no-sync]`
   - `arcadia codex sync --workspace <path>`
   - `arcadia codex associate <task-id> --workspace <path> --project <project-id> [--milestone <milestone-id>]`

4. Discord
   - Register `/arcadia codex`.
   - Format active Codex task readout.
   - Poll Codex task snapshots alongside existing Arcadia run status.
   - Notify on started, requires-review, completed, and failed transitions.

5. Mission logs
   - On completion transition, write one project-scoped mission log for associated tasks.
   - Link the mission log back to `codex_tasks`.

6. Documentation and tests
   - Add architecture note and implementation plan artifacts.
   - Document CLI and Discord usage.
   - Add tests for sync, association, mission log creation, Discord command formatting, command dispatch, and notifications.

## Non-Goals

- No custom Codex task execution manager.
- No terminal-output scraping.
- No Discord approval flow.
- No server or cloud dependency.
- No replacement for Codex goal functionality.

## Verification

Run:

```sh
pnpm vitest run tests/phase3.test.ts tests/discord-bot.test.ts
pnpm test
pnpm build
```

Manual live check:

```sh
pnpm arcadia codex list --workspace "$WORKSPACE" --active-only
pnpm arcadia codex associate <task-id-or-source-id> --workspace "$WORKSPACE" --project <project-id>
```

Then use Discord:

```text
/arcadia codex
```
