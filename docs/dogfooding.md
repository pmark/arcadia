# Arcadia Dogfooding

The dogfood workspace is a repo-local Arcadia workspace at `.arcadia-workspace/`. It lets Arcadia development be managed through Arcadia itself without requiring Discord, iCloud ingress, servers, or external services.

## Why It Is Git-Ignored

`.arcadia-workspace/` is operational state. It contains local database records, generated prompts, mission logs, artifacts, status reports, and Requires Review queues for the person developing Arcadia. Those records are useful locally but should not become repository source.

## Initialize

Run:

```sh
pnpm arcadia dogfood init
```

The command creates `.arcadia-workspace/`, initializes it with the normal Arcadia workspace logic, and creates or updates the Arcadia project:

- Mission: Build Arcadia into a local-first mission control system for sustaining progress across a portfolio of creative and software projects.
- Goal: Use Arcadia as the primary system for managing Arcadia development for 30 consecutive days.
- Status: Active.
- Current milestone: Complete the dogfooding workflow.
- Next action: Use Arcadia ask to create and run Arcadia development work items.

It also records a mission log explaining that Arcadia is now being dogfooded. The command is idempotent.

## Issue Requests

Run:

```sh
pnpm arcadia dogfood ask "Create a work item for implementing Discord notifications."
```

`dogfood ask` is the preferred local workflow for Arcadia development. It is a thin wrapper around `arcadia ask`: it automatically supplies `.arcadia-workspace/` as the workspace, then routes the request through Arcadia Intake before ask creates work items, updates project state, shows status, or surfaces Requires Review packets.

Use natural language. Do not manually choose skills, queues, or Codex packet types for common work.

## Difference From Discord And iCloud Ingress

Discord ingress submits requests from a Discord bot and tracks Discord-origin notification state.

iCloud ingress processes request files from a local iCloud-style inbox and writes sidecar responses.

Dogfooding is direct local CLI usage. It does not depend on Discord, iCloud folders, polling, bot credentials, notification delivery, or remote services.

## Goals

Project goals are plain text outcomes currently being pursued. Arcadia keeps the mission as the reason a project exists, and the goal as the concrete outcome currently in focus. Goals appear in project status views and Codex planning context when available. Missing goals are allowed for older workspaces and are shown as `None`.

Arcadia intentionally does not add OKRs, KPIs, scorecards, or goal analytics.

## Recommended Workflow

1. Initialize the workspace with `pnpm arcadia dogfood init`.
2. Issue natural-language dogfood requests with `pnpm arcadia dogfood ask "..."`.
3. Review status, artifacts, mission logs, and Requires Review items in `.arcadia-workspace/`.

Examples:

```sh
pnpm arcadia dogfood ask "Add a top-level review command."
pnpm arcadia dogfood ask "What needs review?"
pnpm arcadia dogfood ask "What should I focus on today?"
```

For copy-pasteable Codex prompts and everyday usage patterns, see `docs/using-arcadia-skills.md`.

For Intake behavior and supported intents, see `docs/intake.md`.
