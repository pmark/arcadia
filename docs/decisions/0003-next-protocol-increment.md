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
recommendation: Dependency persistence, because it is the only one of the three that changes what Arcadia will hand a coding agent.
confidence: high
decided: 2026-07-26
answer: Whichever most reliably advances using Arcadia to manage planned work with coding agents. Against that criterion the operator delegated the selection, and it resolves to dependency persistence.
updated: 2026-07-26
---

# Next protocol increment

## Context

Foreign-repository validation left three designed increments and no ordering.
`arcadia next` deliberately refused to infer priority from backlog order, so the
current Action sat `question_open` rather than dispatching.

The operator did not pick an increment by name. They supplied a selection
criterion instead: whatever most reliably makes the most progress toward being
able to use Arcadia to manage planned work with coding agents. That criterion,
not the backlog order and not implementation cost, decides this.

## Options

**Dependency persistence.** `depends_on` was parsed and validated, then
discarded. Ordering therefore existed in documents but constrained nothing, so
`arcadia next` could hand an agent an Action whose prerequisite was unfinished —
the precise failure mode of managing planned work with coding agents. It is the
only one of the three that touches dispatch.

**Mission-Log ingestion.** The smallest gap by implementation cost: the log
parser and the `mission_logs` table both already exist, so only the upsert and a
duplicate key are missing. But it makes history queryable without changing what
Arcadia dispatches. Under a "smallest gap" criterion this wins; under the
operator's stated criterion it does not.

**Narrative summarization.** Depends on the local Intelligence service being
reachable, making it the least deterministic of the three, and it likewise does
not affect dispatch. It ranks last under this criterion.

## Consequences

`persist-dependencies` becomes the current Action and dependency edges become
persisted state. An unfinished prerequisite is now a dispatch blocker naming the
file, field, and remedy, rather than context an agent is free to ignore.

The other two increments are unblocked and unranked between themselves. This
decision selected one increment; it did not order the remainder, and
`ingest-mission-logs` keeps its already-written acceptance criteria for whenever
it is selected.
