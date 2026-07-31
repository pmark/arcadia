---
arcadia: v1
type: decision
id: "0003"
slug: next-protocol-increment
project: arcadia
plan: portfolio-docs-protocol
action: ingest-mission-logs
status: approved
question: "Which next protocol increment should Arcadia implement first: mission-Log ingestion, narrative summarization, or dependency persistence?"
gap_type: missing-decision
recommendation: Mission-Log ingestion. Its parser and its table both already exist, so it is the increment that buys the most representation for the least new machinery.
confidence: high
decided: 2026-07-31
answer: Mission-Log ingestion.
updated: 2026-07-31
---

# Next protocol increment

## Context

`ingest-mission-logs` had been the plan's `current_action` since 2026-07-25 while
carrying `clarification: question_open`, so `arcadia next` correctly refused to
dispatch and returned this one question instead. Three increments were already
designed and none had a claim on going first, which is exactly the situation the
contract forbids resolving by backlog order.

The candidates were not equally expensive, and reading the code before asking
changed what the question was worth answering with.

## Options

**Mission-Log ingestion.** `parseLogEntries` already produced a structured
`LogEntryDoc` per dated heading, and `mission_logs` already existed as a table.
Sync skipped logs at one call site with an explicit "not implemented yet"
reason. The missing piece was a `doc_ref`-keyed upsert and nothing else.

**Narrative summarization.** Needs an Intelligence summarization job plus
Artifact storage, and its output depends on the local Intelligence service being
reachable. The most new machinery of the three, and the only one whose result
degrades when a service is down.

**Dependency persistence.** Half already delivered. Its second criterion — an
Action cannot be dispatched while an Action it depends on is unfinished — has
been enforced in `src/docs/dispatch.ts` since the dependency work landed. Only
the first criterion, edges surviving a sync round trip, remained. Its remaining
value is also the smallest, because dispatch resolves from documents rather than
from the database, so persisted edges would not change any decision Arcadia
makes today.

## Consequences

Mission-Log ingestion was selected and implemented. `docs sync` no longer reports
Log files as skipped; each dated entry becomes one `mission_logs` row keyed
`log/<slug>#<date>`.

Keying on the date rather than the full `## YYYY-MM-DD — title` heading is the
consequence worth recording. The protocol calls the heading the entry key, but
only the date half is promised stable — an operator rewording yesterday's title
must not fork a second row for the same day. Two entries sharing one date is
therefore reported as a per-file validation error rather than resolved by
ingestion order.

This Decision selected one increment, not an order for the remaining two. That
question is open as Decision 0004.
