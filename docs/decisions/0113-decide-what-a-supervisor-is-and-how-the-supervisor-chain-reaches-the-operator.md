---
arcadia: v1
type: decision
id: "0113"
slug: decide-what-a-supervisor-is-and-how-the-supervisor-chain-reaches-the-operator
project: arcadia
status: approved
question: Decide what a supervisor is and how the supervisor chain reaches the operator.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A deterministic assignment, not a running agent. A delegate's supervisor is its lead. A lead's supervisor is the Project supervisor function, carried out today by existing stall detection, peer watch and arcadia todo, with the operator on top
options:
  - label: A deterministic assignment, not a running agent. A delegate's supervisor is its lead. A lead's supervisor is the Project supervisor function, carried out today by existing stall detection, peer watch and arcadia todo, with the operator on top
    consequence: It adds no standing model spend and works today. It does not deliver active direction or learning for the team. Above the lead, no one steers a team mid-flight or turns lessons from across Sessions into changes; each lead's own notes-to-self are the only learning. Every relay above a lead lands on the operator through arcadia todo and pings. A standing supervisor agent returns when a queued delegation outlives its bounded wait with no supervisor action twice in one week.
    recommended: true
  - label: A standing light-model supervisor agent for each Project, like a Comms session, that watches its teams, directs them, records lessons and reports to an operator-level supervisor
    consequence: Direction and learning are actually performed, and fewer relays reach the operator. It spends model tokens while running and brings a new long-lived lifecycle to manage and watch.
    recommended: false
  - label: "Flat: every agent reports straight to the operator"
    consequence: The simplest. Every relay costs operator attention, which goes against the Constitution's attention budget as the number of teams grows.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: A deterministic assignment, not a running agent. A delegate's supervisor is its lead. A lead's supervisor is the Project supervisor function, carried out today by existing stall detection, peer watch and arcadia todo, with the operator on top
decided: 2026-10-09
---

# Decision 0113: Decide what a supervisor is and how the supervisor chain reaches the operator.

## Options

- **A deterministic assignment, not a running agent. A delegate's supervisor is its lead. A lead's supervisor is the Project supervisor function, carried out today by existing stall detection, peer watch and arcadia todo, with the operator on top** (recommended): It adds no standing model spend and works today. It does not deliver active direction or learning for the team. Above the lead, no one steers a team mid-flight or turns lessons from across Sessions into changes; each lead's own notes-to-self are the only learning. Every relay above a lead lands on the operator through arcadia todo and pings. A standing supervisor agent returns when a queued delegation outlives its bounded wait with no supervisor action twice in one week.
- **A standing light-model supervisor agent for each Project, like a Comms session, that watches its teams, directs them, records lessons and reports to an operator-level supervisor**: Direction and learning are actually performed, and fewer relays reach the operator. It spends model tokens while running and brings a new long-lived lifecycle to manage and watch.
- **Flat: every agent reports straight to the operator**: The simplest. Every relay costs operator attention, which goes against the Constitution's attention budget as the number of teams grows.

## Rationale

The operator wants a supervisor assigned to every agent, responsible for monitoring, direction and learning for its team, and reporting up a chain that ends at the operator. src/briefSupervisor.ts already uses the word for a process watchdog. Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-supervisor-chain-2026-10-09-r2.
