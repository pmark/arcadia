# Arcadia Dashboard

Arcadia Dashboard is a local Mission Control adapter for Arcadia.

It shows:

- project status
- current milestones
- Requires Review items
- recent execution runs and artifacts

It can approve, reject, defer, or resolve Decisions through the same CLI commands used in a terminal. Planning approval atomically queues one managed Run for the existing Arcadia worker; the dashboard never invokes a planning provider directly and maintains no dashboard-only approval state.

## AI Advice

Action-item cards (Today's Advantage and Attention) carry a common AI advice
affordance. Clicking its icon invokes the most useful plan the AI can perform
with that item: by default it surfaces the obstacles to clear and insightful
recommendations for excellent execution. It runs on demand only (never on
mount), routes through the local-first Arcadia Intelligence service without
billing, and is a progressive enhancement — the surrounding deterministic UI
stands on its own when advice is skipped, pending, or unavailable. Add or adjust
advice-style operations in `lib/enrichment/registry.ts`.

## Workspace

The dashboard lets the Arcadia CLI resolve the workspace. Resolution order is:

1. CLI `--workspace` flag when a dashboard command is called directly.
2. `ARCADIA_WORKSPACE`.
3. A local initialized workspace marker from the CLI working directory, including repo-local `.arcadia-workspace`.
4. User config `defaultWorkspace`.
5. Missing workspace error.

The workspace must already be initialized with `arcadia init`, including `database/arcadia.sqlite3`.

## Run Locally

Install dependencies from the repository root:

```sh
pnpm install
```

Start the dashboard:

```sh
pnpm --filter arcadia-dashboard dev
```

The dev server binds to all local interfaces:

```text
http://0.0.0.0:3020
```

Use your computer's LAN IP address from a phone on the same network.

## Data Source

The dashboard snapshot calls:

```sh
arcadia dashboard snapshot --json
```

The command uses a read-only SQLite connection and does not regenerate `reports/status.md`.

Review decisions call:

```sh
arcadia review approve <id> --json
arcadia review reject <id> --json
arcadia review defer <id> --json
arcadia review resolve-reply <reply> --id <id> --json
```

Decision-gated planning follows this durable path:

```text
Action + packet Artifact
  -> planning approval Decision
  -> pending Run
  -> worker
  -> deterministic Validation
  -> final planning Artifact + Log
  -> final plan-acceptance Decision
```

`arcadia run retry <run-id>` creates an immutable retry Decision for a failed or Requires Review planning Run. Approval creates a new invocation and Run linked to the original attempt.
