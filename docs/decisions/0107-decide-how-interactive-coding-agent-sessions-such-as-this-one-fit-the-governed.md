---
arcadia: v1
type: decision
id: "0107"
slug: decide-how-interactive-coding-agent-sessions-such-as-this-one-fit-the-governed
project: arcadia
status: approved
question: Decide how interactive coding-agent sessions such as this one fit the governed role scheme now, during the crutch phase.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Self-declare with receipts. An interactive session runs arcadia role start (which prints its role brief and records an activity receipt), asks arcadia delegation request before every subagent, and ends with arcadia role end. The operator is its supervisor. No claim or lease is granted
options:
  - label: Self-declare with receipts. An interactive session runs arcadia role start (which prints its role brief and records an activity receipt), asks arcadia delegation request before every subagent, and ends with arcadia role end. The operator is its supervisor. No claim or lease is granted
    consequence: Usable the day those commands ship, with the same commands and receipts as managed Sessions, so behavior matches. Interactive work shows on /agents. Compliance is by convention, and a session without an Action still works.
    recommended: true
  - label: Leave interactive sessions out until automated production runs the scheme
    consequence: Nothing changes for how the operator works today. It goes against the request to model production behavior now, and interactive work stays invisible.
    recommended: false
  - label: Require every interactive session to enroll as a governed Session through native-adopt
    consequence: Closest to managed Session rows, with claims and leases. Every chat needs a governed Action and an enrollment step, and operator-directed work with no Action cannot take part.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: Self-declare with receipts. An interactive session runs arcadia role start (which prints its role brief and records an activity receipt), asks arcadia delegation request before every subagent, and ends with arcadia role end. The operator is its supervisor. No claim or lease is granted
decided: 2026-10-09
---

# Decision 0107: Decide how interactive coding-agent sessions such as this one fit the governed role scheme now, during the crutch phase.

## Options

- **Self-declare with receipts. An interactive session runs arcadia role start (which prints its role brief and records an activity receipt), asks arcadia delegation request before every subagent, and ends with arcadia role end. The operator is its supervisor. No claim or lease is granted** (recommended): Usable the day those commands ship, with the same commands and receipts as managed Sessions, so behavior matches. Interactive work shows on /agents. Compliance is by convention, and a session without an Action still works.
- **Leave interactive sessions out until automated production runs the scheme**: Nothing changes for how the operator works today. It goes against the request to model production behavior now, and interactive work stays invisible.
- **Require every interactive session to enroll as a governed Session through native-adopt**: Closest to managed Session rows, with claims and leases. Every chat needs a governed Action and an enrollment step, and operator-directed work with no Action cannot take part.

## Rationale

The operator wants these sessions to model exactly the behavior of unattended operation, and wants a system usable now, with skills and coding agents as crutches that deterministic pieces later replace. Interactive sessions leave no Session row today. native-adopt enrollment exists (src/sessions/hostEnrollment.ts). Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-interactive-session-crutch-mapping-2026-10-09.
