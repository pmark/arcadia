# Arcadia Dashboard

Arcadia Dashboard is a local, read-only Mission Control adapter for Arcadia.

It shows:

- project status
- current milestones
- Requires Review items
- recent execution runs and artifacts

It does not edit projects, start runs, approve work, run AI, or manage background jobs.

## Workspace

By default, the dashboard reads:

```sh
./tmp/demo-workspace
```

Override it with:

```sh
ARCADIA_WORKSPACE=/absolute/path/to/arcadia-workspace
```

The workspace must already be initialized with `arcadia init`.

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

The dashboard calls:

```sh
arcadia dashboard snapshot --workspace <path> --json
```

The command uses a read-only SQLite connection and does not regenerate `reports/status.md`.
