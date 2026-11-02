# Arcadia Design: revision 8

Date: 2026-11-02. This revision makes Arcadia Design usable. It records what changed
from [revision 7](arcadia-design-proposal-r7.md), which stays unchanged as evidence.
The [arcadia-design skill](../../../.agents/skills/arcadia-design/SKILL.md) is now the
method's single home.

## Why now

The operator lifted the hold on revision 8 ([Issue 2005](https://github.com/pmark/arcadia/issues/2005)):

> Arcadia Design is meant for this exact purpose. Any gaps must be filled now so that
> we can make the Arcadia super-agent solution

The purpose is to paste plans, proposals and ideas from anywhere and reach a proposal
that withstands intense scrutiny and aligns directly with the Project mission and
desired outcomes.

## Gaps filled

| Gap in revision 7 | Now |
| --- | --- |
| No way to invoke it | A portable skill, a consultation route and an index trigger |
| No home for a brief | `docs/design/<slug>/` in an existing Project (Decision 0160) |
| No finite allowance or deadline | Stated in the skill |
| Ideas came from an owner, one at a time | Source intake for any paste, with a retention rule because the repository is public |
| No way to compare sources | Discrete concepts with stable IDs, and a derived matrix of what is shared and differentiated |
| Advice could not gate, and nothing else did | An independent critic gate across three lenses, kept outside the facilitator |
| Ready to commit never mentioned the mission | A frame written first, with mission quotes checked against the file, and a trace from each chosen concept to a requirement |
| Nothing checked the record | `arcadia design check`, including staleness of reviews |
| No field guide format | A format with validation, and one unreviewed software architecture guide |

Revision 7's rule that advice is never a gate still holds. The facilitator gives
advice, and separate critics do the scrutiny, so a generator never grades its own work.

## Operator answers applied

- **Optional Iris handle** (Decision 0150).
- **Quick by default,** with a sustained brief when asked (Decision 0154).
- **Reviewed guides first, never limited** (Decision 0159).
- **Existing Projects only** for briefs (Decision 0160).

## Defaults taken on revision 7's open Decisions

These followed revision 7's recommendations and can be changed in a later revision.

| Open Decision | Default taken |
| --- | --- |
| 1. Architecture | Field-neutral core plus field guides as data |
| 2. Role | A Behavior on `planner` with the optional handle |
| 3. Guide authorship | The operator ratifies each guide; the first one ships as `review: null` and so claims no conformance |
| 4. Probes | Evidence linked from the record's riskiest assumption, with Decisions where they are needed |
| 5. Revival condition | Not needed, because the work is now active |

## Departures from revision 7, by this operator direction

- **Software comes first.** Revision 7 planned website and then game guides. The first
  guide is software architecture because the first real design needs it. Website and
  game guides remain next.
- **The paper test is replaced by real use.** Revision 7's Milestone 1 compared the core
  with ordinary notes before any code. Instead, the super-agent design is the first real
  run. It tests a software design only, not a website or game design, and it isn't the
  planned comparison with ordinary notes.

## Limits

- The simulations behind revision 7 are evidence about record keeping, not expertise.
- Passing the check proves traceability and independent challenge, not a correct design.
- No completion is claimed for the draft Plan's open Actions, and no pointer or queue
  moved.
