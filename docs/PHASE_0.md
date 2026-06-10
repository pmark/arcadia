# Phase 0

Phase 0 makes Arcadia real as a local-first CLI.

## What Works

- Initialize a private workspace with the required folders.
- Create `config/arcadia.json`.
- Create `database/arcadia.sqlite3`.
- Apply the initial SQLite schema.
- Create projects, milestones, work items, and artifact records.
- Add manually classified inbox work.
- View Inbox, Work Queue, Needs Mark, and Blocked queues.
- Create mission logs in SQLite.
- Write mission log Markdown files under `mission_logs/YYYY/MM/`.
- Generate `reports/status.md` from real SQLite rows.

SQLite is authoritative. Markdown files are generated artifacts.

## Out Of Scope

Phase 0 intentionally does not include:

- Dashboard
- Daemon
- Cloud sync
- Authentication
- AI classification
- Automatic Codex dispatch
- Plugin marketplace
- Advanced scheduling
- Local model integration
- Web app

## Smoke Test

Run:

```sh
pnpm install
pnpm build
pnpm test
pnpm arcadia --help
pnpm smoke
```

The smoke script creates `./tmp/demo-workspace`, inserts generic sample data, writes a mission log, generates `reports/status.md`, and verifies the expected files exist.

`tmp/` is ignored and should not be committed.

## Next Recommended Feature

Add a small non-interactive import command for inbox items so local scripts can capture work without using prompts.
