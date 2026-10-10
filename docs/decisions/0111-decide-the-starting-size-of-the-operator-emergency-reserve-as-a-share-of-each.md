---
arcadia: v1
type: decision
id: "0111"
slug: decide-the-starting-size-of-the-operator-emergency-reserve-as-a-share-of-each
project: arcadia
status: approved
question: Decide the starting size of the operator emergency reserve, as a share of each provider capacity window.
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: 20% of each provider window
options:
  - label: 20% of each provider window
    consequence: A clearly usable emergency allowance is always there, and unattended work gets 80% of each window. It throttles earlier under sustained 24/7 load.
    recommended: true
  - label: 10% of each provider window
    consequence: Unattended work gets 90%. The emergency allowance is smaller, and a burst can reach it faster than observations refresh.
    recommended: false
  - label: 30% of each provider window
    consequence: The largest emergency margin. Unattended throughput drops to 70%, so 24/7 work throttles soonest.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: 20% of each provider window
decided: 2026-10-09
---

# Decision 0111: Decide the starting size of the operator emergency reserve, as a share of each provider capacity window.

## Options

- **20% of each provider window** (recommended): A clearly usable emergency allowance is always there, and unattended work gets 80% of each window. It throttles earlier under sustained 24/7 load.
- **10% of each provider window**: Unattended work gets 90%. The emergency allowance is smaller, and a burst can reach it faster than observations refresh.
- **30% of each provider window**: The largest emergency margin. Unattended throughput drops to 70%, so 24/7 work throttles soonest.

## Rationale

The operator asked for a configurable emergency amount that is always available. The answered size becomes the pinned floor. Raising the reserve is always allowed, up to 100%, which stops all unattended work. Going below the floor needs an operator-script library entry (kind grant) run through the governed operator-script path plus a valid operator presence proof. A missing setting falls back to the floor, never to 0. Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-operator-reserve-size-2026-10-09-r3.
