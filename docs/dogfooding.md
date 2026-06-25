# Arcadia Self-Management

Arcadia manages itself as an ordinary project inside an ordinary Arcadia workspace. The reusable initialization path is:

```sh
pnpm arcadia init <workspace> --profile arcadia
```

The historical dogfood shortcuts remain available as repo-local conveniences that target `.arcadia-workspace/`. The `arcadia dogfood` commands are compatibility shortcuts over the same workspace model; they do not create a separate kind of workspace.

## Why It Is Git-Ignored

Any workspace used to manage Arcadia contains operational state: local database records, generated prompts, mission logs, artifacts, status reports, and Requires Review queues. Repo-local `.arcadia-workspace/` is Git-ignored because those records are useful locally but should not become repository source.

## Initialize

Run:

```sh
pnpm arcadia init .arcadia-workspace --profile arcadia
```

The compatibility shortcut is:

```sh
pnpm arcadia dogfood init
```

Both commands initialize the workspace with the normal Arcadia workspace logic and create or update the Arcadia project:

- Mission: Build Arcadia into a local-first mission control system for sustaining progress across a portfolio of creative and software projects.
- Outcome: Manage Arcadia development through the same workspace model used for every other project.
- Status: Active.
- Current milestone: Unify Arcadia onto the single workspace model.
- Next action: Use Arcadia ask to create and run Arcadia development Actions.

It also records a mission log explaining that Arcadia is managed as a project in the workspace. Initialization is idempotent.

## Issue Requests

Run:

```sh
pnpm arcadia ask --workspace .arcadia-workspace "Create an Action for implementing Discord notifications."
```

The compatibility shortcut is:

```sh
pnpm arcadia dogfood ask "Create an Action for implementing Discord notifications."
```

`dogfood ask` is a thin wrapper around `arcadia ask`: it supplies `.arcadia-workspace/` as the workspace, then routes the request through Arcadia Intake before ask creates Actions, updates project state, shows status, or surfaces Requires Review packets. Project routing is the same as the generic ask command: explicit project flags and project names win, and a workspace with exactly one active project uses that project by default.

When emitted as JSON, compatibility shortcuts report their `dogfood.*` command name while keeping the same data shape as the generic command.

Use natural language. Do not manually choose skills, queues, or Codex packet types for common work.

## Difference From Discord And iCloud Ingress

Discord ingress submits requests from a Discord bot and tracks Discord-origin notification state.

iCloud ingress processes request files from a local iCloud-style inbox and writes sidecar responses.

Repo-local self-management is direct local CLI usage. It does not depend on Discord, iCloud folders, polling, bot credentials, notification delivery, or remote services.

## Outcomes

Project outcomes are plain text results currently being pursued. Arcadia keeps the mission as the reason a project exists, and the outcome as the concrete result currently in focus. Outcomes appear in project status views and Codex planning context when available. Missing outcomes are allowed for older workspaces and are shown as `None`.

Arcadia intentionally does not add OKRs, KPIs, scorecards, or outcome analytics.

## Recommended Workflow

1. Initialize a workspace with `pnpm arcadia init <workspace> --profile arcadia`.
2. Issue natural-language requests with `pnpm arcadia ask --workspace <workspace> "..."`.
3. Review status, artifacts, mission logs, and Requires Review Decisions in that workspace.

Examples:

```sh
pnpm arcadia ask --workspace .arcadia-workspace "Add a top-level review command."
pnpm arcadia ask --workspace .arcadia-workspace "What needs review?"
pnpm arcadia ask --workspace .arcadia-workspace "What should I focus on today?"
```

For copy-pasteable Codex prompts and everyday usage patterns, see `docs/using-arcadia-skills.md`.

For Intake behavior and supported intents, see `docs/intake.md`.
