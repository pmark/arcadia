---
arcadia: v1
type: decision
id: "0232"
slug: new-decision-may-the-coordinator-rowan-itself-execute-a-published-arcadia-plan
project: arcadia
status: open
question: "New Decision: may the coordinator (Rowan) itself execute a published arcadia-plan-activation-v1 runner action, instead of waiting for an operator tap, once the operator has chosen that Plan in his own verified words?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A: Rowan may execute a published arcadia-plan-activation-v1 action when (1) the operator's choice of that exact Plan is verified per Decision 0229 and cited in the activation Ask, (2) the descriptor merged on gate (independent PASS on the current head, checks green, CLEAN) and its published bytes equal the merged blob, (3) production is Off and the press activates a Plan only (never START, production activation, day grants, spend or credentials), and (4) Signal verifies the receipt and the resulting main commit afterwards and reports it to the operator."
options:
  - label: "A: Rowan may execute a published arcadia-plan-activation-v1 action when (1) the operator's choice of that exact Plan is verified per Decision 0229 and cited in the activation Ask, (2) the descriptor merged on gate (independent PASS on the current head, checks green, CLEAN) and its published bytes equal the merged blob, (3) production is Off and the press activates a Plan only (never START, production activation, day grants, spend or credentials), and (4) Signal verifies the receipt and the resulting main commit afterwards and reports it to the operator."
    consequence: Activation stops waiting for an operator tap, saving a round-trip per Plan. The coordinator presses a button it prepared, bounded by the operator's own verified words, the merged and byte-identical descriptor, and Signal's after-the-fact check. Every other runner shape (plan amendments beyond activation, START, day grants, credentials) stays an operator tap.
    recommended: true
  - label: "B: Same conditions as A, but Signal presses instead of the coordinator."
    consequence: The coordinator never presses its own activation, so preparer and presser are different sessions. Saves the operator's tap, but needs Signal to be up and adds one hand-off per activation.
    recommended: false
  - label: "C: Keep operator taps for every activation."
    consequence: No new risk; every activation keeps one operator round-trip after the operator has already chosen the Plan in chat.
    recommended: false
confidence: high
plan: draft-an-inactive-batch-6-test-stability-plan-of-three-verified-fixes-with
updated: 2026-11-14
---

# Decision 0232: New Decision: may the coordinator (Rowan) itself execute a published arcadia-plan-activation-v1 runner action, instead of waiting for an operator tap, once the operator has chosen that Plan in his own verified words?

## Options

- **A: Rowan may execute a published arcadia-plan-activation-v1 action when (1) the operator's choice of that exact Plan is verified per Decision 0229 and cited in the activation Ask, (2) the descriptor merged on gate (independent PASS on the current head, checks green, CLEAN) and its published bytes equal the merged blob, (3) production is Off and the press activates a Plan only (never START, production activation, day grants, spend or credentials), and (4) Signal verifies the receipt and the resulting main commit afterwards and reports it to the operator.** (recommended): Activation stops waiting for an operator tap, saving a round-trip per Plan. The coordinator presses a button it prepared, bounded by the operator's own verified words, the merged and byte-identical descriptor, and Signal's after-the-fact check. Every other runner shape (plan amendments beyond activation, START, day grants, credentials) stays an operator tap.
- **B: Same conditions as A, but Signal presses instead of the coordinator.**: The coordinator never presses its own activation, so preparer and presser are different sessions. Saves the operator's tap, but needs Signal to be up and adds one hand-off per activation.
- **C: Keep operator taps for every activation.**: No new risk; every activation keeps one operator round-trip after the operator has already chosen the Plan in chat.

## Rationale

Re-drafted by Rowan 14 as a NEW Decision from Signal 10's proposal rowan-presses-plan-activation-runner-20261113, whose natural-fallback preview mis-targeted it as an update to Decision 0229 (the same bug as before); it is not an amendment of 0229. Operator words, verified per Decision 0229 by Rowan 14 in Signal 10 transcript 67f5e9a4-65f4-490c-8bde-6b77f7a9e20d: line 4769, uuid 18f43448-7023-4e05-b0fa-69460ee2cde2, user-role content block 1 (block 0 is a system-reminder), 2026-11-14T02:40:15.250Z (6:40 PM PST), 'Draft a Decision so Rowan can press activation buttons'. Context: activating a draft Plan needs an operator tap on a runner button even after the operator chose the Plan in chat; batch 6 cost 3 PRs and about 75 minutes, and the tap added a round-trip without adding information. This draft grants nothing; only the operator's answer can. The batch 5 activation is unaffected: the operator still taps that one.

Proposed by Agent Ask rowan-presses-activation-decision-20261113.
