# Phase 2

Phase 2 makes Arcadia useful as an execution orchestrator.

The focus is not autonomous agents or background automation. The focus is transforming captured intent into transparent, deterministic execution using reusable skills, existing scripts, and Codex only when planning or implementation is required.

SQLite remains authoritative. Every execution decision must be observable through execution plans, run records, artifacts, mission logs, and updated work state.

## Current Milestone

Phase 2: Planning and Execution Loop.

## Next Action

Use the single-work-item loop on real safe work before adding portfolio-wide progression.

## Work Classification

Codex.

## Required Artifacts

- `arcadia capture`
- `arcadia work plan`
- `arcadia work run`
- `arcadia run show`
- Execution planning and run tables in SQLite
- Built-in deterministic skill registry
- Mission logs generated from run outcomes
- Run-linked artifacts
- CLI and repository tests
- Smoke coverage for capture, plan, run, and show
- Command documentation with examples

## Execution Loop

The v1 loop is:

```text
Intent
  -> capture
  -> work plan
  -> work run
  -> run show
```

`arcadia progress-safe` is intentionally deferred. It should later compose this loop across eligible work items.

## Built-In Skills

Arcadia installs built-in skill definitions into SQLite when planning or running work:

- `validate_workspace_repository`
- `generate_status_report`
- `generate_weekly_review`
- `prepare_publication_packet`
- `generate_specification_artifact`
- `create_mission_log_from_run`
- `codex_planning`
- `codex_build`
- `needs_mark_decision`

Only deterministic safe skills run automatically. Codex and Mark steps pause execution and are recorded as `needs_mark`.

## Out Of Scope

- dashboards
- background daemons
- autonomous monitoring
- agent swarms
- frontier-model-first workflows
- portfolio-wide `progress-safe`

