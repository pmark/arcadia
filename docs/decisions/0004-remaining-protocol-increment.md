---
arcadia: v1
type: decision
id: "0004"
slug: remaining-protocol-increment
project: arcadia
plan: portfolio-docs-protocol
action: persist-dependencies
status: open
question: "Now that mission-Log ingestion has landed, which remaining increment should Arcadia implement: dependency persistence or narrative summarization?"
gap_type: missing-decision
recommendation: Neither, before deciding whether dependency persistence is worth finishing at all — its enforcement half is already delivered, and its remaining half changes nothing Arcadia currently decides.
confidence: medium
decided: null
answer: null
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

## Consequences

Whichever is chosen, the selected Action needs a `next_action`,
`acceptance_criteria`, `confidence`, and an execution profile before it can be
dispatched — `unclarified` Actions do not resolve.

If the answer is "neither", `PROJECT.md` should move `active_plan` to the plan
that does carry the next objective, rather than leaving this plan active with a
pointer nobody intends to advance.
