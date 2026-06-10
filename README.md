# Arcadia

Arcadia is a local-first project operating system for people juggling multiple creative, technical, and entrepreneurial efforts at the same time.

Arcadia Core is the open source CLI, schema, and reporting engine. Your Arcadia workspace is private operational data.

Phase 0 is intentionally small: initialize a workspace, create projects, classify work, view queues, record mission logs, and generate Markdown status reports.

## Principles

- Local first whenever possible.
- Use the simplest solution that works.
- Favor deterministic workflows over clever automation.
- Use scripts before AI.
- Use local AI before expensive frontier models.
- Involve humans only where judgment is genuinely required.
- Avoid over-engineering.
- Optimize for sustained progress rather than perfect planning.

## Requirements

- Node.js 20 or newer
- pnpm
- A terminal

SQLite is embedded through `better-sqlite3`; no separate database server is required.

## Development Setup

Install dependencies:

```sh
pnpm install
```

Build the CLI:

```sh
pnpm build
```

Run tests:

```sh
pnpm test
```

Show CLI help:

```sh
pnpm arcadia --help
```

## Quick Start

Initialize a private workspace:

```sh
pnpm arcadia init ./tmp/demo-workspace
```

Create a project:

```sh
pnpm arcadia project create --workspace ./tmp/demo-workspace
```

Add manually classified work:

```sh
pnpm arcadia inbox add --workspace ./tmp/demo-workspace
```

Import manually classified work from a script:

```sh
pnpm arcadia inbox import --workspace ./tmp/demo-workspace --title "Run local check" --input "Run local check" --queue work_queue --classification autonomous --next-action "Run the script" --json
```

View queues:

```sh
pnpm arcadia queue --workspace ./tmp/demo-workspace
```

Create a mission log:

```sh
pnpm arcadia log create --workspace ./tmp/demo-workspace
```

Generate status:

```sh
pnpm arcadia status --workspace ./tmp/demo-workspace
pnpm arcadia report status --workspace ./tmp/demo-workspace
```

Run the non-interactive smoke path:

```sh
pnpm smoke
```

## Commands

- `arcadia init <workspace>` creates workspace folders, `config/arcadia.json`, `database/arcadia.sqlite3`, and applies the initial schema.
- `arcadia status --workspace <path>` prints a concise summary and writes `reports/status.md`.
- `arcadia project create --workspace <path>` interactively creates one project, milestone, initial work item, and optional artifact record.
- `arcadia project list --workspace <path>` lists projects with status, milestone, next action, and work classification.
- `arcadia inbox add --workspace <path>` interactively adds manually classified work.
- `arcadia inbox import --workspace <path> --title <title> --input <text> --queue <queue> --classification <classification> --next-action <action>` adds manually classified work without prompts.
- `arcadia queue --workspace <path>` shows Inbox, Work Queue, Needs Mark, and Blocked items.
- `arcadia log create --workspace <path>` records a mission log in SQLite and writes Markdown under `mission_logs/YYYY/MM/`.
- `arcadia report status --workspace <path>` writes the full Markdown status report.

## Workspace Data

`arcadia init` creates:

- `projects/`
- `mission_logs/`
- `artifacts/`
- `skills/`
- `prompts/`
- `config/`
- `database/`
- `reports/`
- `inbox/`

SQLite is authoritative. Markdown files are generated narrative artifacts.

Keep private workspaces separate from Arcadia Core. Do not commit personal workspace data unless you intentionally choose to.

## Not In Phase 0

Arcadia Phase 0 does not include a dashboard, daemon, cloud sync, authentication, AI classification, automatic Codex dispatch, plugin marketplace, advanced scheduling, local model integration, or a web app.

## License

Arcadia Core is licensed under the MPL-2.0 license.
