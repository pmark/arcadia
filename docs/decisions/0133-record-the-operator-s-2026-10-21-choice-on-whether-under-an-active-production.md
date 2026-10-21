---
arcadia: v1
type: decision
id: "0133"
slug: record-the-operator-s-2026-10-21-choice-on-whether-under-an-active-production
project: arcadia
status: approved
question: Record the operator's 2026-10-21 choice on whether, under an active production policy, an operator-escalated in-scope Action stops holding the pointer so the tick can admit other independent in-scope Actions.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Continue with other independent in-scope Actions after an escalation
options:
  - label: Continue with other independent in-scope Actions after an escalation
    consequence: Under an active policy, an in-scope Action held by an operator escalation (for example review_repair_rounds_exhausted or a terminal refusal) no longer blocks admission of other in-scope Actions that do not depend on it. The escalated Action and its candidate stay preserved and escalated for you; it is never retried, merged or dropped by this path. Concurrency limits, scope, the capacity gate, attempt limits and merge gates are unchanged, and an Action that depends on the escalated one stays held. Each run can exercise all three Actions instead of stopping at the first escalation, but later Actions may build on a main that lacks the held Action's work.
    recommended: true
  - label: Hold the pointer at an escalated Action
    consequence: Nothing changes. An escalation stops the tick at that Action until you resolve it, so a run exercises Actions only up to the first escalation and each escalation costs an operator step before later Actions run.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-10-21
answer: Continue with other independent in-scope Actions after an escalation
decided: 2026-10-21
---

# Decision 0133: Record the operator's 2026-10-21 choice on whether, under an active production policy, an operator-escalated in-scope Action stops holding the pointer so the tick can admit other independent in-scope Actions.

## Options

- **Continue with other independent in-scope Actions after an escalation** (recommended): Under an active policy, an in-scope Action held by an operator escalation (for example review_repair_rounds_exhausted or a terminal refusal) no longer blocks admission of other in-scope Actions that do not depend on it. The escalated Action and its candidate stay preserved and escalated for you; it is never retried, merged or dropped by this path. Concurrency limits, scope, the capacity gate, attempt limits and merge gates are unchanged, and an Action that depends on the escalated one stays held. Each run can exercise all three Actions instead of stopping at the first escalation, but later Actions may build on a main that lacks the held Action's work.
- **Hold the pointer at an escalated Action**: Nothing changes. An escalation stops the tick at that Action until you resolve it, so a run exercises Actions only up to the first escalation and each escalation costs an operator step before later Actions run.

## Rationale

Operator answer, 2026-10-21, Release Manager session (Remote Control), chosen in chat with the verbatim reply "1, 2 and 3" to three options; this is option 3, offered as: "When an Action escalates, the tick could carry on with the other independent in-scope Actions instead of holding the pointer. Each run would then exercise all 3 Actions, not stop at the first." This Ask only records that chat answer as a Decision for the operator to answer by button. It adds no scope: only Actions already in the active policy's scope and already authorized may run, and the code change that implements it is a separate PR on the Decision 0098 gate list.

Proposed by Agent Ask decide-tick-continues-past-escalated-action-20261021.
