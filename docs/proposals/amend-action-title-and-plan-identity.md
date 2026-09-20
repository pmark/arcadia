---
arcadia: v1
type: proposal
project: arcadia
question: Can an Agent Ask amend an Action's title, a Plan's heading and slug, and retire a draft Plan as superseded?
---

# Amending Action titles and Plan identity

## Why this project needs it

Arcadia pivoted its board surface from building Flight Deck to GitHub Projects
on 2026-09-20. Three Agent Asks retargeted everything the contract could reach:
the Milestone (`rename-milestone-off-flight-deck-2026-09-20`) and three Actions'
next actions and acceptance criteria
(`retire-flight-deck-scope-from-bootstrap-plan-2026-09-20`,
`retire-flight-deck-from-fault-matrix-2026-09-20`).

Four things were left stale because the contract has no field for them.

**1. An Action's `title`.** `Action fields: acceptance, dependencies,
desired_result, id, references, target_ref`. `desired_result` writes
`next_action`, not `title`. So an amended Action can end up contradicting
itself:

```yaml
- id: freeze-production-runtime-and-handoff-flight-deck
  title: Freeze the proven production runtime and prepare Flight Deck as its first real production workload.
  next_action: Freeze the proven production runtime and prepare the first real production workload, once that workload is named and agreed.
```

The `next_action` says the workload is undecided. The `title` names one that was
abandoned. Both were written by Arcadia, one of them today. A reader — human or
agent — has no way to know which is current, and `arcadia next` prints the
title.

**2. A Plan's body heading.** `# Bootstrap managed production to build Flight
Deck` sat under frontmatter whose `milestone:` a settlement had just rewritten.
This one is repairable by hand under Decision 0044 (a heading asserts nothing
about the work) and was repaired, but the settlement that changed the Milestone
should have carried its own heading.

**3. A Plan's slug and filename.**
`bootstrap-managed-production-to-build-flight-deck` still names the abandoned
target in the slug, the filename, and every reference to it. A slug is an
identity, so renaming one is not obviously safe — but neither is having no
answer at all.

**4. Retiring a draft Plan.**
`docs/plans/flight-deck-board-carries-the-whole-portfolio-on-one-surface.md` is
`status: draft` and superseded: GitHub Projects now does what it proposed. No
intent sets a Plan's status, and `DecisionOptionEffect` is `"defer"` and nothing
else, so no Decision can retire it mechanically either. It will sit in `draft`
indefinitely, and anyone reading the plans directory will find a drafted
Milestone for work nobody intends to do.

## What we would build locally

Nothing, which is the point of filing this. The alternatives available to an
agent that hits these gaps today are all worse than waiting:

- hand-edit the Plan document, which is exactly the governance-state write
  `AGENTS.md` forbids;
- leave the contradiction in place and hope the next reader notices; or
- open a Decision per stale field, spending operator attention on wording that
  nobody disagrees about.

The third is what the contract currently pushes toward, and it is the worst of
the three, because a Decision is for a judgment someone could reasonably answer
either way. "Should this title say the thing its own next action says?" is not
that.

## What would resolve it

Any of these, in rough order of value:

1. **`title` as an amendable Action field**, alongside `desired_result`. Or,
   more simply, have `desired_result` write both on an amendment, since a title
   that disagrees with its next action is never intended.
2. **A settlement that changes a Milestone also rewrites the Plan's `#`
   heading**, since the heading is a projection of that field.
3. **A `plan_status` effect** — or a `plan` intent field — that retires a draft
   Plan as `superseded`, naming what superseded it.
4. **A documented answer on Plan slugs**: either an intent that renames one and
   rewrites referring documents, or an explicit "slugs are immutable, here is
   what to do instead" so agents stop treating it as an open question.

Items 1 and 3 are the ones with live stale documents behind them today.
