---
arcadia: v1
type: decision
id: "0002"
slug: first-foreign-repository
project: arcadia
plan: portfolio-docs-protocol
action: second-project-validation
status: open
question: Which non-Arcadia repository should be the first foreign project docs sync is tested against?
gap_type: missing-decision
recommendation: A repository with existing hand-written docs nobody wrote against this schema, so the test measures the schema rather than the author's memory of it.
confidence: medium
decided: null
answer: null
updated: 2026-07-25
---

# First foreign repository

## Context

Every document the protocol has ingested so far was written by the same session
that wrote the protocol. That makes the current evidence close to worthless as
validation: the schema has only ever been tested against documents authored with
the schema in mind.

The remaining build work — mission-log ingestion, dependency persistence,
narrative summarization — all sits on top of the current schema. Building it
before testing the schema against foreign documentation risks pouring three more
increments of work onto a foundation that a single real repository could
invalidate.

Choosing the repository is the operator's call, and it materially changes
direction, so no implementation should proceed on the assumption of an answer.

## Options

**A repository with substantial existing hand-written docs.** For example
`PrivatePracticeNow/platform`, which has `docs/architecture.md`,
`docs/deployment.md`, `docs/decisions/`, and `docs/plans/`.

- Measures: whether the schema fits documentation nobody shaped for it.
- Cost: likely produces many validation errors at once, which is the point.
- Risk: the documents may be so unlike the schema that the exercise says more
  about that repository than about the protocol.

**A small, recently started repository.** Fewer documents, less history.

- Measures: whether the protocol is cheap to adopt from scratch.
- Cost: low.
- Risk: too close to the Arcadia case to be real validation.

**A repository the operator actively works in, whatever its shape.** The test
becomes "does this help me next week", not "does it parse".

- Measures: real utility of `arcadia portfolio` across two projects.
- Risk: conflates schema fit with workflow fit; a failure is harder to localize.

## Consequences

Whichever is chosen, the expected output is a list of validation errors and
schema gaps, not a clean ingest. A clean first ingest of foreign documentation
would be evidence the test was too easy.

Until this is answered, `second-project-validation` stays `question_open` and
carries no next action, and the other open actions in this plan remain
undesignated rather than being promoted to fill the gap.
