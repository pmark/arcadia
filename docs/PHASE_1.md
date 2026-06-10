# Phase 1

Phase 1 should make the Phase 0 CLI useful as a daily operating loop.

The focus is not expansion into a dashboard or automation system. The focus is reducing friction around capture, updates, review, and generated artifacts while keeping SQLite authoritative and workflows deterministic.

## Current Milestone

Phase 1: Capture, Update, and Review Loop. Complete.

## Next Action

Start the next recommended feature: deterministic weekly review command.

## Work Classification

Codex.

## Required Artifacts

- CLI response and error contract
- Non-interactive inbox capture command
- Work item update commands
- Project and milestone update commands
- Artifact status commands
- Expanded status report sections
- Tests for the new command behavior
- Updated CLI documentation

## Progress

- [x] CLI response and error contract
- [x] CLI-level JSON and failure tests for existing non-interactive commands
- [x] Non-interactive inbox capture command
- [x] Work item update commands
- [x] Project and milestone update commands
- [x] Artifact status commands
- [x] Expanded status report sections
- [x] Expanded smoke coverage for inbox import, work update, work completion, project update, milestone completion, and artifact update
- [x] Updated CLI documentation

## Goals

- Let local scripts add work without interactive prompts.
- Make command success, usage errors, validation errors, missing records, and runtime exceptions consistent enough for scripts, tools, and AI skills to recover accurately.
- Let users move work through queues without editing SQLite directly.
- Let users mark work complete and record what changed.
- Keep project milestone and next-action data current.
- Make `reports/status.md` more useful for a fast daily review.
- Preserve the Phase 0 boundary: local CLI, SQLite, Markdown, no background services.

## CLI Response Contract

Phase 1 must define this before adding new commands.

Every non-interactive command should support predictable human output and machine-readable JSON output:

```sh
arcadia <command> --json
```

Successful JSON responses should use this shape:

```json
{
  "ok": true,
  "command": "work.update",
  "workspace": "/absolute/workspace/path",
  "data": {},
  "artifacts": [],
  "warnings": []
}
```

Failed JSON responses should use this shape:

```json
{
  "ok": false,
  "command": "work.update",
  "workspace": "/absolute/workspace/path",
  "error": {
    "code": "WORK_ITEM_NOT_FOUND",
    "message": "Work item not found.",
    "details": {}
  }
}
```

Human output should remain concise and stable:

- Success: one-line summary plus important IDs and artifact paths.
- Failure: one-line error message, stable error code, and no stack trace by default.
- Debug details: only behind an explicit debug option or environment variable.

Exit codes:

- `0`: success
- `1`: runtime failure
- `2`: usage or validation error
- `3`: missing workspace or missing record

Error codes should be stable uppercase strings. Initial codes should include:

- `USAGE_ERROR`
- `VALIDATION_ERROR`
- `WORKSPACE_NOT_FOUND`
- `DATABASE_NOT_INITIALIZED`
- `PROJECT_NOT_FOUND`
- `MILESTONE_NOT_FOUND`
- `WORK_ITEM_NOT_FOUND`
- `ARTIFACT_NOT_FOUND`
- `SQLITE_ERROR`
- `UNEXPECTED_ERROR`

Interactive commands may keep prompt-oriented output, but any command intended for scripts must support `--json`.

## Proposed Commands

Add these commands first:

```sh
arcadia inbox import --workspace <path> --title <title> --input <text> --queue <queue> --classification <classification> --next-action <action>
arcadia work list --workspace <path>
arcadia work update --workspace <path> <work-id> --queue <queue> --classification <classification> --next-action <action> --status <status>
arcadia work done --workspace <path> <work-id>
```

Then add the smallest project state commands:

```sh
arcadia project update --workspace <path> <project-id> --status <status>
arcadia milestone create --workspace <path> <project-id>
arcadia milestone complete --workspace <path> <milestone-id>
```

Then add artifact visibility:

```sh
arcadia artifact list --workspace <path>
arcadia artifact update --workspace <path> <artifact-id> --status <status> --path <path>
```

## Report Improvements

Update `reports/status.md` to include:

- Work items grouped by queue.
- Work items grouped by classification.
- Recently completed work.
- Artifacts by status.
- Projects with no open next action.
- Blocked work with blocker context when available.

The report should remain Markdown generated from SQLite. Do not introduce a separate report database or cache.

## Implementation Order

1. Add shared CLI response helpers for human and JSON output.
2. Add a typed error class with stable error codes and exit-code mapping.
3. Add CLI-level tests for usage errors, validation errors, missing records, runtime errors, and JSON output.
4. Add repository functions for listing and updating work items.
5. Add `arcadia inbox import` for non-interactive capture.
6. Add `arcadia work list`, `work update`, and `work done`.
7. Add project and milestone update commands.
8. Add artifact list/update commands.
9. Improve the status report from the new data.
10. Expand smoke coverage.
11. Update README, SETUP, and this document with actual command behavior.

## Acceptance Criteria

Phase 1 is complete when:

- Script-facing commands return stable success and error shapes in JSON.
- Usage errors, validation errors, missing records, and runtime exceptions have consistent messages, stable codes, and correct exit codes.
- A shell script can add a work item without prompts.
- A user can list, update, and complete work items from the CLI.
- A user can update project status without touching SQLite.
- A user can create and complete milestones from the CLI.
- A user can list artifacts and update artifact status/path.
- `reports/status.md` clearly shows what needs human judgment, what is agent-ready, what is blocked, and what recently completed.
- Tests pass for success and failure paths of all new command behavior.
- `pnpm smoke` covers at least one non-interactive capture and one work-item update.

## Required Test Coverage

Phase 1 coverage must include:

- Repository tests for every create, list, update, complete, and not-found path.
- CLI tests that execute commands as users and scripts would run them.
- JSON output tests for every non-interactive command.
- Exit-code tests for success, usage errors, validation errors, missing records, and runtime errors.
- Report tests after each important state transition.
- Smoke coverage for import, update, done, milestone completion, artifact update, and report generation.

## Out Of Scope

Do not build these in Phase 1:

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

## Next Recommended Feature After Phase 1

Add a deterministic weekly review command that summarizes recent mission logs, completed work, blocked work, and upcoming artifacts into a Markdown report.

## Latest Progress

Implemented `arcadia inbox import` as the first script-facing Phase 1 workflow command. It supports stable JSON success and failure responses, validates queue and classification values, rejects missing workspace/database/project/milestone references with stable error codes, and is covered by CLI subprocess tests plus the smoke script.

Implemented `arcadia work list`, `arcadia work update`, and `arcadia work done`. Work lifecycle commands use the shared CLI response/error contract, validate enum values before SQLite updates, return `WORK_ITEM_NOT_FOUND` for missing work items, and are covered by repository tests, CLI subprocess tests, and smoke coverage for update and completion.

Implemented `arcadia project update`, `arcadia milestone create`, and `arcadia milestone complete`. Project and milestone lifecycle commands use stable JSON success and failure shapes, validate status values before SQLite updates, return stable missing-record errors, and are covered by repository tests, CLI subprocess tests, and smoke coverage.

Implemented `arcadia artifact list` and `arcadia artifact update`. Artifact commands use stable JSON success and failure shapes, validate status values before SQLite updates, return `ARTIFACT_NOT_FOUND` for missing artifacts, and are covered by repository tests, CLI subprocess tests, and smoke coverage.

Expanded `reports/status.md` generation with detailed work grouped by queue, work grouped by classification, projects without open next actions, blocked work context, recently completed work, and artifacts grouped by status. The report remains generated directly from SQLite.

Updated README and SETUP command documentation for the Phase 1 script-friendly lifecycle commands and expanded status report contents.

Final verification passed with `pnpm install`, `pnpm build`, `pnpm test`, `pnpm arcadia --help`, and `pnpm smoke`.
