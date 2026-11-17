---
arcadia: v1
type: decision
id: "0248"
slug: does-the-first-workspace-try-of-unattended-production-include-a-hosted-rowan
project: arcadia
status: open
question: Does the first Workspace try of unattended production include a hosted Rowan?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. No: worker plus timer-pressed cards only"
options:
  - label: "A. No: worker plus timer-pressed cards only"
    consequence: "The first Workspace try runs with the worker and timer-pressed cards; Rowan stays a desktop session. Consequence: fastest to try; the operator still starts Rowan successors by hand."
    recommended: true
  - label: "B. Yes: wait for the relay tick and the predecessor stand-down"
    consequence: "Consequence: matches the operator's team model; delays the try by the relay proof (several batches)."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-replace-the-daily-start
updated: 2026-11-17
---

# Decision 0248: Does the first Workspace try of unattended production include a hosted Rowan?

## Options

- **A. No: worker plus timer-pressed cards only** (recommended): The first Workspace try runs with the worker and timer-pressed cards; Rowan stays a desktop session. Consequence: fastest to try; the operator still starts Rowan successors by hand.
- **B. Yes: wait for the relay tick and the predecessor stand-down**: Consequence: matches the operator's team model; delays the try by the relay proof (several batches).

## Rationale

The operator answered A. His words, verbatim: "A: No, worker plus timer only". Mira's D2 (predecessor never stands down) is not separate: it is answered as Ellis D1 = A. Source: the operator's answer, given by picker in Signal 13's chat (session local_d6b861a8-20f6-433d-a67f-4d3255bbaee7, 2026-11-16, about 1:20 PM Pacific) and verified by Signal 13, who holds that transcript. Evidence report: Mira, 'Can we start unattended production through the Workspace today?', 2026-11-16 (sha256 311403a154f5d9007932974361b9612fad65e8676933eadcb7ca131420f20c6f). Proposed by Claudia Mason under Rowan 19 to record the already-given answer; this draft grants nothing, only the answer recorded through arcadia decision approve does.

Proposed by Agent Ask claudia-mira-d3-first-workspace-try-no-hosted-rowan-20261116.
