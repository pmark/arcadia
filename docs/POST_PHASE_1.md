# Post-Phase 1

## Current Milestone

Post-Phase 1: Deterministic Weekly Review. Complete.

## Next Action

Use `arcadia review weekly --workspace <path>` against a real workspace and review the generated `reports/weekly/YYYY-MM-DD.md` artifact during the next operating review.

## Work Classification

Codex.

## Required Artifacts

- `arcadia review weekly --workspace <path> [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--json]`
- Stable JSON success and failure responses through the shared CLI contract
- SQLite-only weekly review data builder
- Markdown weekly review report writer
- Repository tests and CLI subprocess tests for success and failure paths
- Smoke coverage for weekly review generation
- Updated README and SETUP documentation

## Progress

- [x] Added deterministic weekly review date-window validation
- [x] Added weekly review SQLite queries for completed work, mission logs, blocked work, Needs Mark, Codex/autonomous work, artifacts, projects without open next actions, and suggested next actions
- [x] Added Markdown generation under `reports/weekly/YYYY-MM-DD.md`
- [x] Added CLI support for `review weekly`
- [x] Added JSON success and failure tests for the new command
- [x] Updated `pnpm smoke` to cover weekly review generation
- [x] Updated README and SETUP

## Boundaries Preserved

The weekly review does not use AI summarization or classification. It does not add a dashboard, daemon, sync, Codex dispatch, plugins, scheduling, local model integration, or web app.
