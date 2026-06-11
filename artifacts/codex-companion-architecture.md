# Codex Companion v0 Architecture Note

Current milestone: Codex Companion v0.

Next action: Use `/arcadia codex` in Discord after running or polling `arcadia codex list` against the real Arcadia workspace.

Work classification: Codex implementation.

Required artifacts:
- `codex_tasks` SQLite table
- `arcadia codex list`
- `arcadia codex sync`
- `arcadia codex associate`
- Discord `/arcadia codex`
- Discord Codex task notifications
- Mission log entry for completed associated Codex work

## Decision

Arcadia observes Codex work through structured Codex state and stores only Arcadia coordination metadata.

Codex remains responsible for implementation work, goal ownership, execution details, approvals, and task lifecycle. Arcadia does not create a replacement goal system. It records:

- the latest observed Codex task or local goal snapshot,
- optional association to an Arcadia project and milestone,
- notification dedupe state for Discord,
- a mission log reference when associated Codex work completes.

## Observation Sources

Primary stable source:

- `codex cloud list --json --limit 20`

This is documented by the Codex CLI manual as a machine-readable task list. Arcadia reads the JSON output and maps each task into `codex_tasks` with source `cloud_task`.

Local source:

- `$CODEX_HOME/goals_1.sqlite`
- `$CODEX_HOME/state_5.sqlite`

This is a structured local Codex store observed in the current installed Codex CLI, not a documented public API. Arcadia treats it as a best-effort local companion source and reads it read-only. It maps local thread goals into `codex_tasks` with source `local_goal`.

Rejected sources:

- Terminal scraping.
- Managing Codex execution from Discord.
- Reimplementing Codex goal/task lifecycle inside Arcadia.
- Adding servers or cloud dependencies.

## Data Flow

```text
Codex structured source
  -> arcadia codex sync/list
  -> codex_tasks snapshot
  -> optional project/milestone association
  -> Discord /arcadia codex readout
  -> Discord transition notifications
  -> mission log when associated task completes
```

## Status Semantics

Arcadia does not reinterpret detailed Codex internals. It groups statuses only for visibility:

- active: `active`, `running`, `in_progress`, `pending`
- requires review: `blocked`, `needs_review`, `requires_review`, `usage_limited`, `budget_limited`
- completed: `complete`, `completed`, `succeeded`, `success`
- failed: `failed`, `error`

All original status strings remain stored and displayed.

## Discord Behavior

`/arcadia codex` shows active observed Codex tasks with project association and mission log path when present.

The existing notification poller now also sends one notification per Codex task transition:

- started
- requires review
- completed
- failed

First startup initializes silently so old Codex state is not replayed.

## Mission Logs

When an associated Codex task transitions from a non-success status to a success status, Arcadia writes one mission log and links it to the task. Unassociated tasks do not create mission logs because Arcadia cannot assign project context confidently.
