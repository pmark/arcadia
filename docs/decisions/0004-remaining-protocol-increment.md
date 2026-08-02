---
arcadia: v1
type: decision
id: "0004"
slug: remaining-protocol-increment
project: arcadia
plan: portfolio-docs-protocol
action: persist-dependencies
status: deferred
question: "Now that mission-Log ingestion has landed, which remaining increment should Arcadia implement: dependency persistence or narrative summarization?"
gap_type: missing-decision
recommendation: Neither, before deciding whether dependency persistence is worth finishing at all — its enforcement half is already delivered, and its remaining half changes nothing Arcadia currently decides.
confidence: medium
decided: 2026-07-31
answer: "Neither now, and both deferred against named triggers. Dependency persistence revives when a database-backed view must show Action ordering without re-crawling repositories. Narrative summarization revives when a second foreign repository is onboarded, or when a narrative summary is actually wanted. Until then active_plan moves to dispatch-contract-enforcement, whose Actions are clarified and carry acceptance criteria."
updated: 2026-07-31
---

# Remaining protocol increment

## Context

Decision 0003 selected mission-Log ingestion and it is now delivered. Two
designed increments remain, and neither has a claim on going next, so the plan's
pointer names one and this Decision holds the choice rather than letting
ingestion order or backlog position decide.

Both remaining Actions are `clarification: unclarified` — not yet evaluated
against the rubric, rather than evaluated and found blocked.

## Options

**Dependency persistence (`persist-dependencies`).** Its second criterion is
already met: `src/docs/dispatch.ts` walks `depends_on` transitively and blocks a
dispatch whose prerequisite is unfinished. Only the first criterion remains,
persisting the edges through a sync round trip. The honest question is whether
that is worth building: dispatch resolves from documents, not from the database,
so persisted edges would not change any decision Arcadia makes today. Finishing
it buys a queryable graph for views that do not yet exist.

**Narrative summarization (`narrative-summarization`).** The larger build: an
Intelligence summarization job whose output is stored as an Artifact and never
written back into the source document. It is also the last thing standing
between a foreign repository and being fully represented — after Log ingestion,
narrative docs are the only document type `docs sync` still reports as skipped.

**Neither, yet.** Deferring is a real answer. The portfolio-docs-protocol
milestone has been reached, and `dispatch-contract-enforcement` is a drafted
plan whose Actions are clarified and carry acceptance criteria. Promoting that
plan may be worth more than finishing this one's tail.

## Decision

**Neither now.** Both are deferred, and under "if not now, then when?" each
carries the condition that revives it.

**Dependency persistence revives when a database-backed view must show Action
ordering without re-crawling repositories.** Today nothing does: dispatch
resolves from documents, and `compute-ready-set` — the next Action — computes
the ready set from documents too. The moment `portfolio` or the dashboard needs
to render ordering from SQLite, the edges have to be there and this becomes
real work. Until then it is a schema change that buys a column nobody reads.

**Narrative summarization revives when a second foreign repository is onboarded,
or when a narrative summary is actually wanted.** It is the last thing standing
between a foreign repository and being fully represented, which sounds urgent
and is not: one foreign repository has been validated and nobody has yet asked
what its `architecture.md` says. Onboarding a second makes "detected but never
read" a recurring cost instead of a one-off.

Both triggers can fire, so neither is a rejection in disguise. If a year passes
and neither has fired, that is evidence to close them, not to keep waiting.

Subsequent history superseded the dependency-persistence half of this deferral:
it was implemented on a parallel local branch before that branch was reconciled
with the accepted remote history on 2026-07-31. `work_item_dependencies` is now
durable and document-owned edges survive a sync round trip. The
`narrative-summarization` deferral and its trigger remain unchanged.

## Consequences

`active_plan` moves to `dispatch-contract-enforcement`, whose four Actions were
written against a review session, are clarified, and carry acceptance criteria —
rather than leaving this plan active with a pointer nobody intends to advance.
Its `compute-ready-set` becomes `current_action`: it is the one Action there
that depends on no open question, and the plan's own ordering note keeps it
clear of the review-and-acceptance surgery that `recheck-readiness-at-approval`
should settle first.

This plan keeps `status: active` and stops declaring a `current_action`, because
only the plan named by `active_plan` may declare one. Its milestone is reached;
the two deferred Actions stay `open` rather than `blocked`, since nothing
outside the repository is owed — this was a choice, not an obstruction.
