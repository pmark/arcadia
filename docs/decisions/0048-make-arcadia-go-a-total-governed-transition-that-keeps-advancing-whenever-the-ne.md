---
arcadia: v1
type: decision
id: "0048"
slug: make-arcadia-go-a-total-governed-transition-that-keeps-advancing-whenever-the-ne
project: arcadia
status: approved
question: Make Arcadia Go a total governed transition that keeps advancing whenever the next move is mechanically derivable, including when the active Plan is absent or complete, and stops only for genuine operator judgment, authority, or an unrecoverable truth/safety defect.
gap_type: missing-decision
recommendation: Use explicit queue across Plans
options:
  - label: Use explicit queue across Plans
    consequence: Arcadia Go automatically activates the Plan whose earliest eligible Action is highest in the existing explicit queue when the current Plan is absent or complete. Dependencies and approvals filter eligibility; an actual tie, missing authority, or conflicting explicit order asks the operator. FIFO only seeds unordered legacy work once, with a preview and undo receipt.
    recommended: true
  - label: Use strict FIFO Plans
    consequence: Arcadia Go activates the oldest eligible approved Plan whenever the current Plan ends or is absent. This is simple and deterministic, but creation time becomes implicit priority and may run stale low-value work before newer urgent Outcomes.
    recommended: false
  - label: Keep explicit Plan choice
    consequence: Arcadia Go continues to stop whenever no active Plan is selected or a Plan completes, preserving Decision 0042 but requiring operator intervention at every cross-Plan handoff.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
answer: >-
  Approved by the operator: use the explicit Action queue across Plans. When
  the active Plan is absent or complete, Arcadia Go automatically activates
  the Plan whose earliest eligible Action is highest in that queue.
  Dependencies and approvals filter eligibility without changing priority.
  FIFO is only a visible, reversible one-time seed for approved legacy work
  lacking explicit order. Do not add a separate urgency field unless a
  concrete priority need cannot be represented by the queue.
decided: 2026-09-12
updated: 2026-09-13
---

# Decision 0048: Make Arcadia Go a total governed transition that keeps advancing whenever the next move is mechanically derivable, including when the active Plan is absent or complete, and stops only for genuine operator judgment, authority, or an unrecoverable truth/safety defect.

## Options

- **Use explicit queue across Plans** (recommended): Arcadia Go automatically activates the Plan whose earliest eligible Action is highest in the existing explicit queue when the current Plan is absent or complete. Dependencies and approvals filter eligibility; an actual tie, missing authority, or conflicting explicit order asks the operator. FIFO only seeds unordered legacy work once, with a preview and undo receipt.
- **Use strict FIFO Plans**: Arcadia Go activates the oldest eligible approved Plan whenever the current Plan ends or is absent. This is simple and deterministic, but creation time becomes implicit priority and may run stale low-value work before newer urgent Outcomes.
- **Keep explicit Plan choice**: Arcadia Go continues to stop whenever no active Plan is selected or a Plan completes, preserving Decision 0042 but requiring operator intervention at every cross-Plan handoff.

## Rationale

The operator wants Arcadia Go to run unless it truly needs them and proposed oldest-first Plan selection with dependencies plus an optional urgency or priority signal. Decision 0012 already requires a total transition result, but Decision 0042 forbids selecting an inactive Plan from queue order alone. Decision 0039 and the accepted execution-queue contract already provide one explicit operator-owned priority order and prohibit timestamps or backlog age from silently changing priority. Reuse that order: eligible dependencies are readiness constraints, not hidden priority. Use FIFO only as a visible, reversible one-time seed for legacy approved work that lacks explicit order; do not add a second urgency field until a concrete need cannot be represented by queue order.

Proposed by Agent Ask total-go-plan-selection-2026-09-12.

## Resolution

Approved directly by the operator on 2026-09-12. The explicit Action queue is
the one priority authority across Plans. Arcadia Go may cross a missing or
completed active-Plan boundary without another operator round trip when that
queue and the shared readiness resolver produce one eligible next Plan.
Dependencies, Decisions, and approval boundaries filter what is eligible; they
do not silently rewrite priority. FIFO is limited to a previewed, reversible
seed for approved legacy work with no explicit order, and a second urgency
field is deferred until the existing queue cannot represent a concrete need.
