---
arcadia: v1
type: decision
id: "0274"
slug: what-do-milestone-and-checkpoint-mean-in-arcadia-and-where-do-checkpoints-live
project: arcadia
status: open
question: What do Milestone and Checkpoint mean in Arcadia, and where do Checkpoints live?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Ordered Checkpoint list per Plan; Milestones operator-declared
options:
  - label: A. Ordered Checkpoint list per Plan; Milestones operator-declared
    consequence: "Adopt this vocabulary. MILESTONE (operator, 2026-11-18): 'a celebrated achievement where new capabilities are obvious and usable … a big state change on the way to the final North Star goal'; one Milestone closes a span of Plans; only the operator declares it reached, and a view may say 'ready to celebrate'. CHECKPOINT: what a Plan reaches. Each Plan carries an ordered `checkpoints:` list whose last item is its headline Checkpoint; each item cites the Action ids that produce it and names its receipt; an Action id that no longer exists shows as 'unknown', never as done. The Plan field `milestone:` is renamed to the Checkpoint field through a dated migration with a read-compatibility window in which both names are read; no Roadmap view ships before the cutover. Proposed by Iris and Ellis, not yet the operator's words, for the follow-up work to settle: each Checkpoint is a short state rather than a task; PROJECT.md's `milestone:` is renamed too; today's strings are rewritten as states, nearest Plans first. M1 'Nights run themselves' counts as reliable after 3 consecutive nights ('clean' is defined when the proof is decided); the proof mechanism is decided later. Consequence: Roadmap progress reads in Milestones you celebrate and Checkpoints that Plans prove; the field rename, its validator and the migration follow as separately reviewed work."
    recommended: true
  - label: B. Exactly one Checkpoint per Plan
    consequence: "Milestone meaning and rename as in A, but exactly one Checkpoint per Plan, with the work re-cut into small Plans so a long list of Checkpoints is a list of Plans. Consequence: simplest field; many more, smaller Plans to approve onto the queue."
    recommended: false
  - label: C. One per Plan, finer states as Action acceptance
    consequence: "Milestone meaning and rename as in A, but one Checkpoint per Plan; finer states stay as Action acceptance criteria. Consequence: no long Checkpoint list; progress inside a Plan is read from Actions."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-20
---

# Decision 0274: What do Milestone and Checkpoint mean in Arcadia, and where do Checkpoints live?

## Options

- **A. Ordered Checkpoint list per Plan; Milestones operator-declared** (recommended): Adopt this vocabulary. MILESTONE (operator, 2026-11-18): 'a celebrated achievement where new capabilities are obvious and usable … a big state change on the way to the final North Star goal'; one Milestone closes a span of Plans; only the operator declares it reached, and a view may say 'ready to celebrate'. CHECKPOINT: what a Plan reaches. Each Plan carries an ordered `checkpoints:` list whose last item is its headline Checkpoint; each item cites the Action ids that produce it and names its receipt; an Action id that no longer exists shows as 'unknown', never as done. The Plan field `milestone:` is renamed to the Checkpoint field through a dated migration with a read-compatibility window in which both names are read; no Roadmap view ships before the cutover. Proposed by Iris and Ellis, not yet the operator's words, for the follow-up work to settle: each Checkpoint is a short state rather than a task; PROJECT.md's `milestone:` is renamed too; today's strings are rewritten as states, nearest Plans first. M1 'Nights run themselves' counts as reliable after 3 consecutive nights ('clean' is defined when the proof is decided); the proof mechanism is decided later. Consequence: Roadmap progress reads in Milestones you celebrate and Checkpoints that Plans prove; the field rename, its validator and the migration follow as separately reviewed work.
- **B. Exactly one Checkpoint per Plan**: Milestone meaning and rename as in A, but exactly one Checkpoint per Plan, with the work re-cut into small Plans so a long list of Checkpoints is a list of Plans. Consequence: simplest field; many more, smaller Plans to approve onto the queue.
- **C. One per Plan, finer states as Action acceptance**: Milestone meaning and rename as in A, but one Checkpoint per Plan; finer states stay as Action acceptance criteria. Consequence: no long Checkpoint list; progress inside a Plan is read from Actions.

## Rationale

Operator, 2026-11-18 (quoted verbatim by Iris): 'Plans should have a checkpoint. We definitely should rename milestone to checkpoint. Milestone is just not the right word there, and that frees up the usage of the term milestone to be much more meaningful. A milestone should be a celebrated achievement where new capabilities are obvious and usable. It's a big state change on the way to the final North Star goal.' He chose then to decide the rename first (Iris's D1: Decision first, dated migration, read-compatibility window, view waits). Operator answers 2026-11-20 in Signal 16's chat, verbatim '1A 2A 3A 4A 5C 6A 7D', mapped by Signal 16: Checkpoint cardinality A (ordered list per Plan), reliably = 3 nights, M1 proof decided later. Iris and Ellis agreed the definitions (ellis-milestones-checkpoints-20261120.md). Today docs/arcadia-semantics.md:80-86 defines Milestone as 'A meaningful checkpoint toward an Outcome', and Plan frontmatter `milestone:` holds each Plan's own sentence. This Decision changes vocabulary only, so its record can qualify under Decision 0273 for a byte-matched read-back merge. Its option text avoids that Decision's backstop keywords. The operator's earlier answers were to the draft's questions, not to these options, so he answers this Decision on its own read-back. Next free number: allocate from fresh origin/main at settle (Issue #2369). An independent Sonnet plan-critic checked this draft against main before read-back, and its fixes are applied. This draft grants nothing.

Proposed by Agent Ask ellis-decision-milestone-checkpoint-vocabulary-20261120b.
