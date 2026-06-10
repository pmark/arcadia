# Arcadia

Arcadia is a local-first project operating system for people juggling multiple creative, technical, and entrepreneurial efforts at the same time.

Arcadia Core is the open source CLI, schema, and reporting engine. Your Arcadia workspace is private operational data.

Phase 0 is intentionally small: initialize a workspace, create projects, classify work, view queues, record mission logs, and generate Markdown status reports. Phase 2 adds a single-work-item execution loop: capture intent, plan work, run deterministic safe steps, and review run records. Phase 3 adds deterministic natural-language intent resolution with `arcadia ask`.

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

Capture executable intent:

```sh
pnpm arcadia capture --workspace ./tmp/demo-workspace --text "Generate status report" --json
```

Resolve natural-language intent into an auditable work item and plan:

```sh
pnpm arcadia ask --workspace ./tmp/demo-workspace "Create a new blog site named MartianRover Field Notes." --json
```

View queues:

```sh
pnpm arcadia queue --workspace ./tmp/demo-workspace
```

List and update work:

```sh
pnpm arcadia work list --workspace ./tmp/demo-workspace
pnpm arcadia work update --workspace ./tmp/demo-workspace <work-id> --status in_progress --json
pnpm arcadia work done --workspace ./tmp/demo-workspace <work-id> --json
pnpm arcadia work plan --workspace ./tmp/demo-workspace <work-id> --json
pnpm arcadia work run --workspace ./tmp/demo-workspace <work-id> --json
pnpm arcadia run show --workspace ./tmp/demo-workspace <run-id> --json
```

Update project and milestone state:

```sh
pnpm arcadia project update --workspace ./tmp/demo-workspace <project-id> --status paused --json
pnpm arcadia milestone create --workspace ./tmp/demo-workspace <project-id> --title "Next milestone" --json
pnpm arcadia milestone complete --workspace ./tmp/demo-workspace <milestone-id> --json
```

List and update artifacts:

```sh
pnpm arcadia artifact list --workspace ./tmp/demo-workspace --json
pnpm arcadia artifact update --workspace ./tmp/demo-workspace <artifact-id> --status ready --path artifacts/output.md --json
```

Create a mission log:

```sh
pnpm arcadia log create --workspace ./tmp/demo-workspace
```

Generate status:

```sh
pnpm arcadia status --workspace ./tmp/demo-workspace
pnpm arcadia report status --workspace ./tmp/demo-workspace
Generate a deterministic weekly review:

```sh
pnpm arcadia review weekly --workspace ./tmp/demo-workspace
pnpm arcadia review weekly --workspace ./tmp/demo-workspace --since 2026-06-03 --until 2026-06-09 --json
```

Run the non-interactive smoke path:

```sh
pnpm smoke
```

## Commands

- `arcadia init <workspace>` creates workspace folders, `config/arcadia.json`, `database/arcadia.sqlite3`, and applies the initial schema.
- `arcadia status --workspace <path>` prints a concise summary and writes `reports/status.md`.
- `arcadia ask --workspace <path> <request> [--project <project-id>] [--milestone <milestone-id>] [--run-safe]` resolves natural-language intent into an auditable work item and execution plan.
- `arcadia capture --workspace <path> --text <intent> [--project <project-id>] [--milestone <milestone-id>] [--expected-artifact <artifact>]` captures natural-language intent as structured work.
- `arcadia project create --workspace <path>` interactively creates one project, milestone, initial work item, and optional artifact record.
- `arcadia project list --workspace <path>` lists projects with status, milestone, next action, and work classification.
- `arcadia project update --workspace <path> <project-id> --status <status>` updates project status.
- `arcadia inbox add --workspace <path>` interactively adds manually classified work.
- `arcadia inbox import --workspace <path> --title <title> --input <text> --queue <queue> --classification <classification> --next-action <action>` adds manually classified work without prompts.
- `arcadia queue --workspace <path>` shows Inbox, Work Queue, Needs Mark, and Blocked items.
- `arcadia work list --workspace <path>` lists work items.
- `arcadia work update --workspace <path> <work-id> [--queue <queue>] [--classification <classification>] [--next-action <action>] [--status <status>]` updates a work item.
- `arcadia work done --workspace <path> <work-id>` marks a work item complete.
- `arcadia work plan --workspace <path> <work-id>` creates an observable execution plan for a work item.
- `arcadia work run --workspace <path> <work-id> [--plan <plan-id>] [--allow-codex-planning] [--allow-codex-build] [--agent-profile <name>]` runs deterministic safe steps by default, and runs Codex steps only with explicit allow flags.
- `arcadia run show --workspace <path> <run-id>` shows the run audit trail and Needs Mark items.
- `arcadia milestone create --workspace <path> <project-id> --title <title>` creates a milestone.
- `arcadia milestone complete --workspace <path> <milestone-id>` marks a milestone complete.
- `arcadia artifact list --workspace <path>` lists artifacts.
- `arcadia artifact update --workspace <path> <artifact-id> [--status <status>] [--path <path>]` updates artifact status or path.
- `arcadia log create --workspace <path>` records a mission log in SQLite and writes Markdown under `mission_logs/YYYY/MM/`.
- `arcadia report status --workspace <path>` writes the full Markdown status report.
- `arcadia review weekly --workspace <path> [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]` writes a deterministic weekly review to `reports/weekly/YYYY-MM-DD.md`. If dates are omitted, Arcadia uses the seven calendar days ending today.

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

Phase 3 also creates inspectable registries in `config/`:

- `intent-registry.json`
- `template-registry.json`
- `coding-agent-profiles.json`

SQLite is authoritative. Markdown files are generated narrative artifacts.

For copy-paste examples of common workflows, see [docs/COMMANDS.md](docs/COMMANDS.md). For Phase 2 scope and behavior, see [docs/PHASE_2.md](docs/PHASE_2.md). For Phase 3 scope and behavior, see [docs/phase-3-natural-language-intent.md](docs/phase-3-natural-language-intent.md).

Keep private workspaces separate from Arcadia Core. Do not commit personal workspace data unless you intentionally choose to.

## Current Boundaries

Arcadia Core does not include a dashboard, daemon, cloud sync, authentication, AI classification, automatic Codex dispatch, plugin marketplace, advanced scheduling, local model integration, or a web app.

## License

Arcadia Core is licensed under the MPL-2.0 license.
