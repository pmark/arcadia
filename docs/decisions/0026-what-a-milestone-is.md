---
arcadia: v1
type: decision
id: "0026"
slug: what-a-milestone-is
project: arcadia
status: approved
question: What does `milestone` mean, given that a Project carries one, a plan carries one, an Action may override it, and `arcadia portfolio` and `arcadia next` currently report different current milestones for the same Project?
gap_type: missing-decision
recommendation: >-
  A Milestone is a named outcome that survives the plan that pursues it, owned
  by the Project and referenced by plans -- not a sentence a plan happens to
  carry. Make the Project's milestone list authoritative, have plans and
  Actions point at a Milestone by id rather than restating its title, and
  derive the Project's current Milestone from the active plan so two commands
  cannot disagree. Do this before adding cross-project ranking or any new
  vocabulary.
confidence: medium
decided: 2026-08-17
answer: >-
  The definition is approved as recommended by the operator on 2026-08-17: a
  Milestone is a named outcome that outlives the plan pursuing it, owned by
  the Project and referenced by plans and Actions by id, with the Project's
  current Milestone derived from the active plan rather than stored, so
  `arcadia portfolio` and `arcadia next` cannot disagree again. The schema
  change and the migration reconciling existing free-text milestones across
  four projects are explicitly NOT authorized by this ratification and are
  not scheduled -- this Decision's own "What this Decision does not
  authorize" section already reserves that gate, and the operator chose to
  exercise it rather than schedule implementation now. Until implemented,
  `portfolio` and `next` continue to read two different fields and may
  disagree.
updated: 2026-08-17
---

# What a Milestone is

## Context

Ask this repository what Arcadia's current milestone is and you get two
different answers.

`arcadia next --project arcadia` reports the milestone of the active plan
`demo-first-delivery`: *every software Project always exposes a stable proof
surface and a governed path from candidate demo through QA-verified release.*

`arcadia portfolio` reports: *one portfolio or Project view tells the truthful
story of past, current, planned, deferred, and Incubating work* — which is
`portfolio-continuity-view`'s milestone, on a plan that is `draft`.

Neither is wrong by its own logic. They are reading different fields. The
Project row carries a `milestone` title matched or created on ingest; dispatch
reads the active plan's `milestone`. Nothing reconciles them, and an operator
reading both has no way to tell which is current.

The word is doing at least three jobs:

1. **A Project's current milestone** — a DB column, matched by title on ingest.
2. **A plan's milestone** — free text in plan frontmatter, the thing dispatch
   prints.
3. **An Action's milestone override** — `PlanActionDoc.milestone`, because
   Decision 0005 allowed a plan to span more than one.

Three meanings, one word, no defined relationship. That is why the operator's
question — *what does milestone mean beyond a single task* — has no answer in
the code today.

## What a Milestone should be

**A Milestone is a named outcome that outlives the plan pursuing it.**

The test is longevity. If a plan is superseded, rewritten, or split, does the
thing it was driving toward still exist and still matter? If yes, that is a
Milestone. If it disappears with the plan, it was the plan's scope statement
and should not have been called a milestone.

This makes the ownership obvious. A Milestone belongs to the **Project**, since
the Project is what outlives plans. A plan *pursues* a Milestone; it does not
define one. An Action belongs to whichever Milestone its plan is pursuing,
unless it explicitly points elsewhere.

It also gives the word a meaning distinct from "a single task", which is what
the operator asked for: a Milestone is an outcome several Actions add up to,
and it can be pursued by more than one plan over time.

## What changes

- **The Project declares its Milestones**, each with an id, a title, and a
  status. This is the authoritative list.
- **A plan references a Milestone by id** rather than restating its title.
  Restating is what allowed the two commands to diverge — two copies of one
  fact, which the Constitution already forbids.
- **An Action's override becomes a reference too**, preserving Decision 0005's
  ability for a plan to span Milestones without reintroducing free text.
- **The Project's current Milestone is derived**, not stored: it is the one the
  active plan references. A derived value cannot contradict its source.

Note this is the opposite conclusion from Decision 0023, which kept
`current_action` stored rather than derived. The difference is that a pointer
records a *choice* between valid options and derivation would replace the
operator's judgment, whereas a current Milestone records a *consequence* of a
choice already made. Deriving a consequence removes a contradiction; deriving a
choice removes an operator.

## Migration is the real cost

Every existing plan states its milestone as free text, and the DB has titles
matched on ingest. Turning those into referenced ids means reconciling the
titles that already exist across four projects, and some will not map cleanly —
`Establish the project operating loop` and `Pinterest publishing support` are
scope statements, not outcomes that outlive a plan.

This should be a migration with a report, not a silent rewrite: name each
existing milestone title, say which Project Milestone it maps to, and leave
unmappable ones for the operator. Confidence on this Decision is `medium`
because that reconciliation is where it will actually be hard, and the shape of
it is not yet known.

## Why this comes before ranking and before new vocabulary

The operator asked for cross-project ranking — what matters most overall — and
for `vision`, `horizon`, and `prime_directive` as real fields.

Ranking sorts Projects by progress toward something. If that something means
three different things, the ranking inherits the contradiction and silently
orders Projects by incomparable values. And adding two more scope-shaped words
above an already-overloaded `milestone` compounds the ambiguity rather than
resolving it — the new words would be defined against a term with no fixed
meaning.

Both are worth doing. Both are cheaper and more truthful after this.

## Keep triggered

| Increment | Reactivate when |
| --- | --- |
| Implement the schema change and migration this Decision defines | The operator schedules it as a plan Action, or `portfolio` and `next` are caught disagreeing again in a way that changes a real decision. |
| Cross-project ranking ("what matters most overall") | This Decision is implemented and the Project Milestone list is authoritative. |
| Vision, horizon, and prime directive as schema (Decision 0027) | Same trigger; 0027 states the dependency itself. |
| Retire the DB `milestone` column in favour of the derived value | The derived current Milestone has agreed with the stored one across every Project for one full sync. |

## What this Decision does not authorize

- It does not authorize the schema change, the migration, or any edit to an
  existing plan's milestone text. Approval is the gate.
- It does not define `vision`, `horizon`, or `prime_directive`; that is 0027.
- It does not change how `current_action` is resolved. Decision 0023 governs
  that and is unaffected.
