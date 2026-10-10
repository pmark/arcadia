---
arcadia: v1
type: decision
id: "0116"
slug: decide-what-production-runs-when-a-project-s-active-plan-waits-on-the-operator
project: arcadia
status: open
question: "Decide what production runs when a Project's active Plan waits on the operator: that Project's next Plan, or the next Project."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Fall through to the next Project
options:
  - label: Fall through to the next Project
    consequence: While a Project's active Plan waits on the operator, that Project starts nothing new; its turn goes to the next included Project. The Project stays on one Plan at a time and the operator sees fewer PRs from it. Needs the tick to treat an operator wait on the active Plan as a Project-level skip with the wait reason needs_operator.
    recommended: true
  - label: Run the same Project's next Plan
    consequence: Today's behavior under 0048. The Project keeps moving on a second Plan, producing more PRs from a Project already waiting on the operator.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-10
---

# Decision 0116: Decide what production runs when a Project's active Plan waits on the operator: that Project's next Plan, or the next Project.

## Options

- **Fall through to the next Project** (recommended): While a Project's active Plan waits on the operator, that Project starts nothing new; its turn goes to the next included Project. The Project stays on one Plan at a time and the operator sees fewer PRs from it. Needs the tick to treat an operator wait on the active Plan as a Project-level skip with the wait reason needs_operator.
- **Run the same Project's next Plan**: Today's behavior under 0048. The Project keeps moving on a second Plan, producing more PRs from a Project already waiting on the operator.

## Rationale

In the 2026-10-09 /production design session the operator chose this option in chat; this Decision records it for the operator's own answer. Today Decision 0048's queue lets the same Project's next queued Plan run, which produces more PRs for a Project already waiting on the operator.

Proposed by Agent Ask decide-blocked-project-fallthrough-2026-10-09.
