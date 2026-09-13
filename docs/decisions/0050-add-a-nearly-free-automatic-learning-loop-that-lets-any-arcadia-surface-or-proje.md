---
arcadia: v1
type: decision
id: "0050"
slug: add-a-nearly-free-automatic-learning-loop-that-lets-any-arcadia-surface-or-proje
project: arcadia
status: open
question: Add a nearly-free automatic learning loop that lets any Arcadia surface or Project record a concise lesson independently of a coding-agent provider, then periodically turns supported lessons into durable improvements.
gap_type: missing-decision
recommendation: Bounded automatic learning loop
options:
  - label: Bounded automatic learning loop
    consequence: Add a zero-model one-line lesson intake with Project or Arcadia scope and provenance, then use the existing periodically budgeted worker to deduplicate, verify, dismiss, or promote supported lessons into tests, references, Way guidance, Decisions, Actions, or reusable skills. Allow only low-risk reversible improvements within standing authority; preserve scope/privacy and every consequential approval gate.
    recommended: true
  - label: Capture and recommend only
    consequence: Record and analyze lessons automatically, but require the operator to approve every durable promotion or repair. This minimizes autonomous mutation but turns routine learning into another attention queue.
    recommended: false
  - label: Project lessons only
    consequence: Automate capture and promotion inside the originating Project but forbid Arcadia-wide learning. This contains disclosure risk, but repeated lessons cannot become shared guards or Arcadia Way improvements without a later redesign.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-13
---

# Decision 0050: Add a nearly-free automatic learning loop that lets any Arcadia surface or Project record a concise lesson independently of a coding-agent provider, then periodically turns supported lessons into durable improvements.

## Options

- **Bounded automatic learning loop** (recommended): Add a zero-model one-line lesson intake with Project or Arcadia scope and provenance, then use the existing periodically budgeted worker to deduplicate, verify, dismiss, or promote supported lessons into tests, references, Way guidance, Decisions, Actions, or reusable skills. Allow only low-risk reversible improvements within standing authority; preserve scope/privacy and every consequential approval gate.
- **Capture and recommend only**: Record and analyze lessons automatically, but require the operator to approve every durable promotion or repair. This minimizes autonomous mutation but turns routine learning into another attention queue.
- **Project lessons only**: Automate capture and promotion inside the originating Project but forbid Arcadia-wide learning. This contains disclosure risk, but repeated lessons cannot become shared guards or Arcadia Way improvements without a later redesign.

## Rationale

The operator wants Arcadia and its Projects to learn without relying on one
coding agent's private context or requiring a formal Action at capture time.
Decision 0020 already adopts the compounding loop from results through
captured learning to reusable capability. Decision 0049 now supplies the
cheap Back Burner intake, deterministic-first triage, periodic token budget,
formal Action promotion, and bounded safe-repair precedent.

Reuse that substrate with a distinct lesson signal. Do not build a transcript
archive or generic memory platform. Intake should preserve the statement and
automatically attach scope, provenance, source, time, repository revision
when available, confidence/freshness, and whether it is an operator statement
or an inferred observation. The periodic process should deduplicate and test
support before promoting a lesson into its authoritative home: a regression
test or guard, Project reference, Arcadia Way guidance, Decision, governed
Action, reusable skill, or a reasoned dismissal. The signal itself is evidence,
not truth or authority.

Project-scoped material must not leak into another Project or global guidance
merely because a model finds it similar. Promotion across scope requires
support from more than one Project or one high-severity trust/safety incident,
keeps source links, and remains inspectable and correctable. Operator identity
and preferences distinguish direct statements from inference. Credentials,
sensitive content, raw transcripts, and unrelated repository contents are not
copied into the learning store. Stop-the-line safety lessons bypass cadence;
consequential operations retain their existing approval gates.

Proposed by Agent Ask agent-agnostic-learning-loop-2026-09-12. This Decision remains open until the operator answers it.
