---
arcadia: v1
type: decision
id: "0005"
slug: plan-milestone-span
project: arcadia
plan: portfolio-docs-protocol
status: approved
question: If one plan's work spans multiple milestones, should the protocol split the plan, or allow a plan to reference more than one milestone?
gap_type: missing-decision
recommendation: Allow it, as an optional per-action milestone override, because forcing a split would sever dependency edges across the split boundary.
confidence: high
decided: 2026-07-26
answer: Allow a plan to span milestones through an optional per-action `milestone:` override. The plan-level `milestone:` remains the default for actions that do not name one.
updated: 2026-07-26
---

# Plan and milestone span

## Context

The protocol was structurally 1:1: `milestone:` is a single scalar and the
milestone's doc ref *is* `plan/<slug>`. A plan did not reference a milestone, it
defined one.

Splitting a plan at a milestone boundary looked free until `depends_on` became
persisted state. A dependency may only name an action in the same plan — the
parser rejects anything else — so splitting a plan severs every ordering edge
across the split. Since an unfinished prerequisite is now a dispatch blocker,
that would silently remove the constraint at exactly the handoff most likely to
be gotten wrong. The cheaper-looking option turned out to cost the guarantee
that had just been built.

## Options

**Split the plan.** Keeps `plan/<slug>` as milestone identity and needs no
schema change. Rejected: it trades a dispatch-time correctness guarantee for a
documentation-shape preference.

**Make milestones a first-class document type.** Plans would reference milestone
slugs, and `PROJECT.md` would point at a real object. The cleanest end state,
and the largest change: a new document type, a new vocabulary, and a migration
of every existing milestone row. Not justified by present evidence.

**Optional per-action override.** An action may name its own `milestone:`;
absent that it inherits the plan's. Chosen.

## Consequences

The plan's primary milestone keeps the bare `plan/<slug>` ref it was ingested
under, so no existing row migrates. An override gets
`plan/<slug>?milestone=<slug>`, following the shape already used for plan
questions. `PROJECT.md` is untouched and `depends_on` is unaffected, which was
the point.

Milestone status is now derived from plan status in the same change: a plan that
is `complete` or `superseded` ends its milestone, anything else keeps it active.
This was a live bug independent of the span question — `current_milestone`
selects the newest `active` milestone, and because no plan ever ended one,
Arcadia's own portfolio reported a milestone belonging to a completed plan,
chosen by a two-millisecond gap in insertion order rather than by intent.

A first-class milestone document type remains the likely end state if plans ever
need to share a milestone across projects. This decision does not foreclose it.
