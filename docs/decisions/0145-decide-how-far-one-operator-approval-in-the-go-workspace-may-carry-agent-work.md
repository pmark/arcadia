---
arcadia: v1
type: decision
id: "0145"
slug: decide-how-far-one-operator-approval-in-the-go-workspace-may-carry-agent-work
project: arcadia
status: open
question: Decide how far one operator approval in the Go workspace may carry agent work across consecutive Actions before Arcadia stops and asks again.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Through the current Plan until the first gate
options:
  - label: Through the current Plan until the first gate
    consequence: One approval continues through every eligible Action of Go's current Plan in order, stopping at the first Decision, review or merge gate, failure, limit or pause. Most hands-off while staying inside one Plan.
    recommended: true
  - label: A fixed number of Actions, chosen per approval (for example up to 3)
    consequence: Each approval names a count; continuation also stops at any gate before that. More check-ins, tighter control over spend and drift.
    recommended: false
  - label: One Action per press only
    consequence: No bounded continuation; the workspace keeps the one-Action Continue and the fourth Action is not built.
    recommended: false
confidence: high
plan: make-arcadia-go-orient-one-caller-truthfully-before-authorized-work
updated: 2026-10-28
---

# Decision 0145: Decide how far one operator approval in the Go workspace may carry agent work across consecutive Actions before Arcadia stops and asks again.

## Options

- **Through the current Plan until the first gate** (recommended): One approval continues through every eligible Action of Go's current Plan in order, stopping at the first Decision, review or merge gate, failure, limit or pause. Most hands-off while staying inside one Plan.
- **A fixed number of Actions, chosen per approval (for example up to 3)**: Each approval names a count; continuation also stops at any gate before that. More check-ins, tighter control over spend and drift.
- **One Action per press only**: No bounded continuation; the workspace keeps the one-Action Continue and the fourth Action is not built.

## Rationale

Operator direction 2026-10-27: Arcadia should keep working on subsequent Actions as long as it can. Bounded continuation lets agent work proceed without a press per Action, which changes what runs without the operator, so the scope model is the operator's to set. It is not unattended production: Production stays Off and its separate START approval is untouched. Implemented by continue-through-approved-scope-from-the-workspace in Agent Ask propose-go-workspace-ui-actions-20261027-r2.

Proposed by Agent Ask propose-go-bounded-continuation-scope-decision-20261027.
