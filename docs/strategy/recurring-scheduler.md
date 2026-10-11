# Basic recurring scheduler

Arcadia's existing worker evaluates daily, weekly and monthly calendar triggers
and captures a concrete Action proposal through Agent Ask. The scheduler uses no
models and starts no agent itself. Accepting a proposal, updating the checked-in
Plan and dispatching approved work use the existing governed paths. A schedule is
an intake definition, never a competing Action queue or permission to publish.

## Operator guide

Definitions are JSON with schema `arcadia-recurring-schedule-v1`, a unique `id`,
configured active Project slug, `cadence`, IANA `timezone`, local `time` (`HH:MM`),
UTC `starts_at` (ISO with milliseconds), `desired_result` and nonempty `acceptance`
strings. Weekly definitions require `weekday` (1 Monday to 7 Sunday); monthly
ones require `day` (1–28). Other cadence-specific fields and unknown fields are
refused. Commands and executable payloads are unsupported.

```sh
arcadia schedule register --file docs/examples/schedules/field-notes-ship.json
arcadia schedule register --file docs/examples/schedules/field-notes-essay.json
arcadia schedule recurring --json
arcadia schedule enable field-notes-ship
arcadia schedule enable field-notes-essay
arcadia schedule tick --json
arcadia agent-ask pending --json
arcadia schedule pause field-notes-ship
arcadia schedule retry field-notes-ship --occurrence 2026-10-12
```

Each command resolves the configured workspace by default. Use `--workspace`
only for an explicitly resolved alternate workspace or disposable test fixture.
Registration starts paused; replaying the identical definition preserves its
state. To change a definition, pause the old id and register a new id. Receipts
are retained. `recurring` is read-only, including on a database predating this
feature. `tick` is a manual equivalent of the worker's regular evaluation.
The worker must be running a build containing this feature for automatic ticks.

The sample schedules use America/Los_Angeles: ship notes Monday at 09:00,
starting October 12, 2026; essay eligibility on the first day of each month at
09:00, starting November 1. These are explicit proposed defaults, not installed
live schedules. The trigger baseline does not replace the first-run evidence
collection cutoff required by the production instructions. Field Notes remains
bounded by Decision 0120: weekly ship notes at most, monthly essays only for
proven Milestones. Empty periods skip; these triggers never require a post.
The first two essays already assigned to the writer are separate content work.
AMC routes, RSS and automated publication remain tracked by issue #1211.

## Calendar and recovery behavior

A trigger becomes due at its local calendar time; a tick after downtime selects
only the latest due occurrence at or after `starts_at`, avoiding a backdated
burst. The template placeholders `{{due_at}}`, `{{period_start}}` and
`{{period_end}}` expand to UTC instants. Daily windows cover the previous local
day, weekly windows the previous Monday-to-Monday week, and monthly windows the
previous calendar month. Those completed cadence windows are separate from an
article's longer evidence collection interval after downtime.

Daylight-saving overlaps fire once at the earlier instant. A nonexistent local
time shifts forward by the gap for that occurrence, then resumes the configured
wall-clock time next period. Calendar calculations never use the host timezone.

An SQLite IMMEDIATE transaction captures the Agent Ask and occurrence receipt
together. A deterministic request id and unique schedule/date prevent duplicate
proposals across worker restarts and competing connections. An unsettled proposal
blocks subsequent occurrences for its schedule. Accept or reject it through the
existing settlement path before another can be submitted; settlement itself does
not mean an article was published. Authors must also inspect pending packages and
publication receipts before generating content.

A failed capture retains its error and occurrence, retries after five minutes,
and stops after three attempts. `retry` resets the budget for that failed
occurrence without deleting it. Pausing prevents all attempts. One failing
Project does not block other triggers. There are at most 100 definitions and 20
submission attempts per tick. No shell, network, model call, new daemon or
credentials are part of the scheduler.

## Runnable acceptance checks

```sh
pnpm exec vitest run tests/recurring-scheduler.test.ts
pnpm exec tsc --noEmit -p tsconfig.json
pnpm lint
```

For end-to-end operator QA in a disposable initialized workspace: create an
active fixture Project, register a definition naming that Project with a past
`starts_at`, and confirm registration is paused. Enable it, run `schedule tick`
twice, and inspect `schedule recurring` plus `agent-ask pending`. Expect one
proposal and one submitted occurrence; no new execution Run or approved work.
Pause it and tick again: no additional proposal. The production integration is
the same tick function in `runWorkerIteration`, tested with production inactive.
