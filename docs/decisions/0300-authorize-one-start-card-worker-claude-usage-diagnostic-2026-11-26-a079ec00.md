---
arcadia: v1
type: decision
id: "0300"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-26-a079ec00
project: arcadia
status: approved
question: Authorize one START card worker Claude usage diagnostic 2026-11-26 a079ec00
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 8eeedb7def04dbeee7221cd34b4352c5a288b8a3348add6f30bcdedd5bdc9d52
options:
  - label: Authorize one worker Claude usage diagnostic 8eeedb7def04dbeee7221cd34b4352c5a288b8a3348add6f30bcdedd5bdc9d52
    consequence: "Authorizes only the worker grant with SHA-256 8eeedb7def04dbeee7221cd34b4352c5a288b8a3348add6f30bcdedd5bdc9d52: nonce a079ec00-52db-4f5f-9232-afd4dfd42572, expiring 2026-11-26T19:33:16.771Z, policy revision 195 epoch 102, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-3-standby-test-pins-20261125
updated: 2026-11-26
answer: Authorize one worker Claude usage diagnostic 8eeedb7def04dbeee7221cd34b4352c5a288b8a3348add6f30bcdedd5bdc9d52
decided: 2026-11-26
---

# Decision 0300: Authorize one START card worker Claude usage diagnostic 2026-11-26 a079ec00

## Options

- **Authorize one worker Claude usage diagnostic 8eeedb7def04dbeee7221cd34b4352c5a288b8a3348add6f30bcdedd5bdc9d52** (recommended): Authorizes only the worker grant with SHA-256 8eeedb7def04dbeee7221cd34b4352c5a288b8a3348add6f30bcdedd5bdc9d52: nonce a079ec00-52db-4f5f-9232-afd4dfd42572, expiring 2026-11-26T19:33:16.771Z, policy revision 195 epoch 102, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-4-standby-pins-20261126a2 run 20261126T192658Z-83366: the card's one Haiku renewal of 2026-11-26 succeeded, so the bound worker (release cd7644072744ccc6d4d91e644e40255d689747fd, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-26-a079ec00.
