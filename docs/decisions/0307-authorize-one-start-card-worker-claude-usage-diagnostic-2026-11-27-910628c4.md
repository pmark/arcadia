---
arcadia: v1
type: decision
id: "0307"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-27-910628c4
project: arcadia
status: approved
question: Authorize one START card worker Claude usage diagnostic 2026-11-27 910628c4
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic ba11336e83edff744ee55a13d226932f2b575f8fad9459aec37c2d36f195894b
options:
  - label: Authorize one worker Claude usage diagnostic ba11336e83edff744ee55a13d226932f2b575f8fad9459aec37c2d36f195894b
    consequence: "Authorizes only the worker grant with SHA-256 ba11336e83edff744ee55a13d226932f2b575f8fad9459aec37c2d36f195894b: nonce 910628c4-29f2-4efc-9d7d-28a5647b6578, expiring 2026-11-28T06:01:50.105Z, policy revision 207 epoch 108, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-6-standby-test-pins-20261127
updated: 2026-11-27
answer: Authorize one worker Claude usage diagnostic ba11336e83edff744ee55a13d226932f2b575f8fad9459aec37c2d36f195894b
decided: 2026-11-27
---

# Decision 0307: Authorize one START card worker Claude usage diagnostic 2026-11-27 910628c4

## Options

- **Authorize one worker Claude usage diagnostic ba11336e83edff744ee55a13d226932f2b575f8fad9459aec37c2d36f195894b** (recommended): Authorizes only the worker grant with SHA-256 ba11336e83edff744ee55a13d226932f2b575f8fad9459aec37c2d36f195894b: nonce 910628c4-29f2-4efc-9d7d-28a5647b6578, expiring 2026-11-28T06:01:50.105Z, policy revision 207 epoch 108, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-7-standby-pins-20261127a run 20261128T055328Z-84605: the card's one Haiku renewal of 2026-11-27 succeeded, so the bound worker (release cd9d2f95bc60ffbaa3b83106ea05abd480318ebb, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-27-910628c4.
