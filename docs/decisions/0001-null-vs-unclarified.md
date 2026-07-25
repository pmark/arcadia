---
arcadia: v1
type: decision
id: "0001"
slug: null-vs-unclarified
project: arcadia
plan: clarification-pass
action: phase-2-fields
status: approved
question: Should an Action that predates the clarification columns be treated as unclarified, or as a distinct never-evaluated state?
gap_type: missing-decision
recommendation: Keep NULL distinct from 'unclarified'.
confidence: high
decided: 2026-07-24
answer: NULL means never evaluated and stays distinct from 'unclarified', which asserts the Action is known to lack a concrete next action.
updated: 2026-07-25
---

# Null versus unclarified

## Context

Phase 2 added `clarification_status` to `work_items` as a nullable column. Every
row that existed before the migration reads NULL. The question was whether the
migration should backfill those rows to `unclarified`, or leave NULL as a
meaningful fourth state.

## Options

**Backfill to `unclarified`.** Simpler: three states instead of four, and every
consumer can assume the column is populated.

- Honesty: claims every historical Action was evaluated and found wanting, which
  never happened.
- Blast radius: the first `clarify` run would sweep the entire history of the
  workspace into a model pass.
- Reversibility: destroys the distinction permanently; it cannot be recovered.

**Keep NULL distinct.** NULL means "never evaluated"; `unclarified` means
"evaluated or captured, and known to lack a concrete next action".

- Honesty: records only what is true.
- Cost: every consumer must handle a third case rather than two.

## Consequences

`clarify` selects `unclarified` only, so a first run on an existing workspace
touches nothing historical. `arcadia portfolio` reports `never evaluated`
separately from `unclarified` for the same reason. The cost is real: each new
consumer of the column has to decide what NULL means for it, and forgetting to
is a silent bug rather than a loud one.
