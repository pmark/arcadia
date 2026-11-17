---
arcadia: v1
type: decision
id: "0245"
slug: where-does-the-relay-tick-work-wire-renew-into-the-liveness-tick-stand-down-for
project: arcadia
status: open
question: Where does the relay-tick work (wire renew into the liveness tick, stand-down for an unresponsive predecessor, two live handoffs, skills pointed at the relay) go in the queue?
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: A. Next
options:
  - label: A. Next
    consequence: "A three-Action relay tick Plan runs before the remaining standing-autonomy Actions. Consequence: Rowan 19 to 20 can be the first automatic handoff; standing autonomy slips by about one batch."
    recommended: true
  - label: B. After standing autonomy
    consequence: "Consequence: the operator starts successors by hand for several more days."
    recommended: false
  - label: C. Fold into the hosted-coordinators Plan, wherever it lands
    consequence: "Consequence: one Plan, latest delivery."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-replace-the-daily-start
updated: 2026-11-17
---

# Decision 0245: Where does the relay-tick work (wire renew into the liveness tick, stand-down for an unresponsive predecessor, two live handoffs, skills pointed at the relay) go in the queue?

## Options

- **A. Next** (recommended): A three-Action relay tick Plan runs before the remaining standing-autonomy Actions. Consequence: Rowan 19 to 20 can be the first automatic handoff; standing autonomy slips by about one batch.
- **B. After standing autonomy**: Consequence: the operator starts successors by hand for several more days.
- **C. Fold into the hosted-coordinators Plan, wherever it lands**: Consequence: one Plan, latest delivery.

## Rationale

The operator answered C. His words, verbatim: "C: Fold into host-coordinators". Recorded meaning: the relay-tick Actions go into the host-coordinators draft Plan draft-an-inactive-plan-of-seven-bounded-actions-that-host-the-coordinators (#2714); its Action 2 settle-relay-probes-and-launch-decision is closed as already satisfied by Decision 0191 A and the #1929 probe record; Plan placement stays where the operator put host-coordinators on the queue, after standing autonomy. Under Decision 0241 E only the operator places a Plan on the queue. Source: the operator's answer, given by picker in Signal 13's chat (session local_d6b861a8-20f6-433d-a67f-4d3255bbaee7, 2026-11-16, about 11:45 AM Pacific) and verified by Signal 13, who holds that transcript. Evidence report: Ellis, 'Coordinator handoff with zero operator action', 2026-11-16 (sha256 2df7498fee8c40ce3fc8dbc406d967b5ce321f117bdc1d3a65c6947f7f263964). Proposed by Claudia Mason under Rowan 19 to record the already-given answer; this draft grants nothing, only the answer recorded through arcadia decision approve does.

Proposed by Agent Ask claudia-ellis-d2-relay-tick-queue-placement-20261116.
