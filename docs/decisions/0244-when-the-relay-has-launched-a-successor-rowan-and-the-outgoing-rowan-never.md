---
arcadia: v1
type: decision
id: "0244"
slug: when-the-relay-has-launched-a-successor-rowan-and-the-outgoing-rowan-never
project: arcadia
status: open
question: When the relay has launched a successor Rowan and the outgoing Rowan never stands down (dead, out of context or idle), what completes the custody transfer?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. The relay stands it down
options:
  - label: A. The relay stands it down
    consequence: "When the predecessor is at forced (75%) or its transcript has been silent 20 minutes since the launch. Consequence: handoffs complete with no one awake, including after a crash. Risk: a slow but live predecessor is fenced mid-thought; a tmux one is stopped, a desktop one is only fenced from guarded commands until it ends itself."
    recommended: true
  - label: B. Only the predecessor stands down
    consequence: "Otherwise one urgent ping. Consequence: the normal handoff is automatic; a dead Rowan still needs the operator, as on 11-13."
    recommended: false
  - label: C. Wake the predecessor with a labelled tmux message first, then A
    consequence: "Consequence: gentler, but hosted sessions only, and typed text reads as operator input, which the design ruled out by default."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-replace-the-daily-start
updated: 2026-11-17
---

# Decision 0244: When the relay has launched a successor Rowan and the outgoing Rowan never stands down (dead, out of context or idle), what completes the custody transfer?

## Options

- **A. The relay stands it down** (recommended): When the predecessor is at forced (75%) or its transcript has been silent 20 minutes since the launch. Consequence: handoffs complete with no one awake, including after a crash. Risk: a slow but live predecessor is fenced mid-thought; a tmux one is stopped, a desktop one is only fenced from guarded commands until it ends itself.
- **B. Only the predecessor stands down**: Otherwise one urgent ping. Consequence: the normal handoff is automatic; a dead Rowan still needs the operator, as on 11-13.
- **C. Wake the predecessor with a labelled tmux message first, then A**: Consequence: gentler, but hosted sessions only, and typed text reads as operator input, which the design ruled out by default.

## Rationale

The operator answered A. His words, verbatim: "A: Relay stands it down" (stand down at forced 75% or after 20 minutes of transcript silence since the launch). Source: the operator's answer, given by picker in Signal 13's chat (session local_d6b861a8-20f6-433d-a67f-4d3255bbaee7, 2026-11-16, about 11:45 AM Pacific) and verified by Signal 13, who holds that transcript. Evidence report: Ellis, 'Coordinator handoff with zero operator action', 2026-11-16 (sha256 2df7498fee8c40ce3fc8dbc406d967b5ce321f117bdc1d3a65c6947f7f263964). Proposed by Claudia Mason under Rowan 19 to record the already-given answer; this draft grants nothing, only the answer recorded through arcadia decision approve does. Evidence: accept refuses until the predecessor records stand-down; after 15 minutes the launch fails no_acceptance and relaunches (limit 6 a day), so a Rowan that ran out of context can never stand down (Rowan 11, 2026-11-13). Mira's report asked the same question as her D2 and is answered by this Decision.

Proposed by Agent Ask claudia-ellis-d1-predecessor-stand-down-20261116.
