---
arcadia: v1
type: decision
id: "0004"
slug: docs-sync-write-back
project: arcadia
plan: portfolio-docs-protocol
status: approved
question: "Should docs sync ever write back to a repo (e.g. append Arcadia run results to MISSION_LOG.md), or must it stay strictly one-way?"
gap_type: missing-decision
recommendation: Strictly one-way into human-authored files, with execution history projected into a separate generated namespace that ingestion never reads as intent.
confidence: high
decided: 2026-07-26
answer: Strictly one-way. Arcadia never writes to a human-authored managed document. Execution history may be projected into a separate generated namespace that is marked Arcadia-owned and is never parsed as intent, following the Obsidian vault precedent.
updated: 2026-07-26
---

# Docs sync write-back

## Context

Conflict resolution in `docs sync` is one function, `stalenessOf`: a document
whose `updated:` is greater than or equal to the row's date overwrites the row.
That is design principle 7, "last write wins by `updated`", and it is only sound
because documents are the sole writer. A document dated newer than its row means
a human recorded newer intent, so overwriting is correct.

Write-back breaks the inference rather than merely complicating it. Arcadia would
append to a file, bump `updated:` to today, and the next sync would read that
file as newer intent — but the content came from the database. The comparison is
day-granular and inclusive, so within a single day the document always wins:
an operator change made after a write-back is clobbered by the next sync reading
the file Arcadia itself wrote. The timestamp stops identifying which side is
authoritative.

Two further costs. `docs sync` is expected to re-run as a no-op, and a run that
writes to the repository dirties tracked files every time while forcing the
dry-run guarantee to cover repository writes as well. And `AGENTS.md` points
cold-starting agents at `MISSION_LOG.md`, so Arcadia writing there on its own
schedule puts merge conflicts in the one file meant to be a reliable narrative.

The question is not idle. Execution history — what ran, what failed — lives only
in SQLite today, so an agent with a fresh clone and no access to the operator's
workspace database cannot see any of it. That gap is the real motivation for
write-back and it deserves an answer, not a refusal.

## Options

**Strictly one-way, no execution history in the repository.** Preserves the
invariant and leaves the visibility gap unaddressed. Rejected: the gap is real.

**Allow write-back into human-authored documents.** Closes the gap and destroys
`stalenessOf` as a conflict resolver, requiring a replacement identity model for
every managed document, not just logs.

**One-way into human-authored files, plus a generated namespace.** Arcadia
writes execution history to a path it wholly owns, marked generated and excluded
from ingestion, and never touches a human-authored document. No feedback loop is
possible because Arcadia never reads what it writes as intent.

## Consequences

The third option is chosen. It has precedent in this codebase: the Obsidian
projection already writes to `Arcadia/Records/`, a subtree declared generated,
Arcadia-owned, and not an editable input. This applies the same shape to the
repository.

`MISSION_LOG.md` stays purely human-authored, which settles the open keying
question for `ingest-mission-logs`: the entry key must be derived from what a
human typed — the `YYYY-MM-DD` heading date plus a title slug — because Arcadia
may not stamp an id into the file. Dates alone are not unique; Arcadia's own log
carries five entries dated 2026-07-25. Log entries are append-only, so a reworded
heading is an anomaly to warn on, not a case to support.

The generated execution-history projection is not yet built and is not part of
`ingest-mission-logs`. It is a separate increment, unranked against the remaining
protocol work.
