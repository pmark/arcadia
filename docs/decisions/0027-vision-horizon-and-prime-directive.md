---
arcadia: v1
type: decision
id: "0027"
slug: vision-horizon-and-prime-directive
project: arcadia
status: approved
question: Should a Project declare a prime directive, a vision, and a horizon as validated fields, and what does each one mean that `goal`, `outcome`, and `milestone` do not already cover?
gap_type: missing-decision
recommendation: >-
  Add two fields and reuse one. `prime_directive` is the single constraint that
  outranks progress for this Project. `horizon` is the time band a plan is
  aimed at, declared per plan rather than per Project. Do not add `vision` --
  the Project's existing `outcome` field already carries it, and a fourth
  aspirational sentence beside goal, outcome, and vision would be three ways to
  say the same thing. Land this only after Decision 0026 fixes what milestone
  means.
confidence: medium
decided: 2026-08-17
answer: >-
  Approved as recommended by the operator on 2026-08-17. `prime_directive` is
  adopted as a per-Project field: the single constraint that outranks
  progress for that Project. `horizon` is adopted as a per-plan field: the
  time band a plan is aimed at. `vision` is explicitly rejected --
  `ProjectDoc.outcome` already carries it, and no fourth aspirational field is
  added beside `goal` and `outcome`. This ratification does not authorize the
  schema change; that remains gated as the Decision states. Because Decision
  0026 was approved on its definition with its own schema and migration
  deferred, `horizon`'s ranking benefit stays theoretical until 0026 is
  separately implemented -- this Decision proceeds on that understanding
  rather than waiting for 0026's implementation to be scheduled first.
updated: 2026-08-17
---

# Vision, horizon, and prime directive

## Context

A `ProjectDoc` today has `goal`, `outcome`, and `milestone`. A plan has
`milestone`. There is no field for what a Project must never trade away, and
none for how far ahead a plan is aimed.

The operator asked for `vision`, `horizon`, and `prime_directive` as real
concepts, alongside a Milestone that means more than a single task. Decision
0026 answers the Milestone half. This one answers the rest, and its first job
is to resist adding words that already exist under other names.

## Applying the admission test

Decision 0020 established that a concept earns a field only if something would
be decided differently because of it. Taking each in turn:

### `prime_directive` — admit it

The single constraint that outranks progress for this Project. Not a goal:
a goal is what you are trying to reach, and a prime directive is what you will
not do to reach it.

It earns a field because it changes dispatch. An agent reading *"never publish
copy that names a client's patients"* or *"never let the demo be a mock
presented as working software"* will refuse work it would otherwise take. That
is a decision changed, which is the test.

It is per Project, singular, and rarely edited. If a Project has three, they
are constraints and belong in the plan; a prime directive that competes with
another prime directive is not prime.

The Constitution already carries Arcadia-wide constraints and continues to. A
prime directive is the one *this Project* adds on top, in its own domain.

### `horizon` — admit it, on plans

How far ahead a plan is aimed: this week, this quarter, or someday. Not a
deadline and not an estimate — a band.

It earns a field because it changes what may be deferred. "If not now, then
when?" requires knowing what *now* means for a given plan, and a deferral
trigger written on a two-week plan means something different from the same
words on a someday plan. It also gives the portfolio a real axis to rank on
once Decision 0026 lands: a near-horizon plan with a blocked Action outranks a
someday plan that is merely idle.

It belongs on the **plan**, not the Project. Projects do not have one horizon —
Arcadia is simultaneously shipping a dashboard this week and considering
packaging someday. Putting it on the Project would force one number onto both
and produce a false answer.

### `vision` — reject it

`ProjectDoc.outcome` already carries this. Arcadia's own reads: *the operator
states a desired outcome; Arcadia clarifies it, routes it to the right Project,
drives coding agents, and reports back — asking for a decision only when one is
genuinely needed.* That is a vision statement wearing a different label.

Adding `vision` beside `goal` and `outcome` would create three aspirational
sentences with no rule for which governs when they disagree, and every managed
document would carry a field authors fill in by paraphrasing the one above it.

If `outcome` is the wrong name for it, the honest fix is renaming `outcome` to
`vision` — a rename, with a migration, not a new field. That is worth
considering and is deliberately left as an option below rather than smuggled in
here.

## What a Project would carry after this

| Field | Meaning | Scope |
| --- | --- | --- |
| `prime_directive` | The one constraint that outranks progress | Project, new |
| `goal` | What this Project is trying to achieve | Project, unchanged |
| `outcome` | The end state that achievement produces | Project, unchanged |
| Milestones | Named outcomes that outlive plans | Project, per Decision 0026 |
| `horizon` | The time band a plan is aimed at | Plan, new |

Five levels, each with one job, and no two of them competing to describe the
same thing.

## Why this must land after 0026

`horizon` is only useful for ranking once Milestones are comparable across
Projects, which is exactly what 0026 establishes. And defining a new vocabulary
layer above a `milestone` that means three things would bake the ambiguity into
two more fields instead of one.

Confidence is `medium` for a specific reason: `prime_directive` and `horizon`
are individually defensible, but whether operators actually write a truthful
prime directive rather than a slogan is unknown until several exist. A field
filled with slogans is worse than no field, because dispatch would print it as
though it constrained something.

## Keep triggered

| Increment | Reactivate when |
| --- | --- |
| Rename `outcome` to `vision` | The operator confirms `outcome` is the wrong word for what it holds; it is a rename with a migration, never an addition. |
| Enforce `prime_directive` as required | Three Projects have written one and at least one has actually refused work because of it. |
| Rank the portfolio by horizon | Decision 0026 is implemented and horizons exist on more than one plan. |

## What this Decision does not authorize

- It does not authorize the schema change; approval is the gate, and 0026 must
  land first.
- It does not add `vision`, and no implementation may quietly include it.
- It does not change the Constitution, which continues to carry the constraints
  that bind every Project.
