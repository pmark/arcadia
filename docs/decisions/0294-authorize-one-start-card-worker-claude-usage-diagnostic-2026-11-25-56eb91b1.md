---
arcadia: v1
type: decision
id: "0294"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-25-56eb91b1
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-25 56eb91b1
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic c0cf5eaae13110adfc3733d0022c57c126df952c0073177e8765118c755e6e29
options:
  - label: Authorize one worker Claude usage diagnostic c0cf5eaae13110adfc3733d0022c57c126df952c0073177e8765118c755e6e29
    consequence: "Authorizes only the worker grant with SHA-256 c0cf5eaae13110adfc3733d0022c57c126df952c0073177e8765118c755e6e29: nonce 56eb91b1-1067-4c61-b95d-6d7ba3eab289, expiring 2026-11-25T22:13:32.338Z, policy revision 187 epoch 98, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-2-standby-test-pins-20261123
updated: 2026-11-25
---

# Decision 0294: Authorize one START card worker Claude usage diagnostic 2026-11-25 56eb91b1

## Options

- **Authorize one worker Claude usage diagnostic c0cf5eaae13110adfc3733d0022c57c126df952c0073177e8765118c755e6e29** (recommended): Authorizes only the worker grant with SHA-256 c0cf5eaae13110adfc3733d0022c57c126df952c0073177e8765118c755e6e29: nonce 56eb91b1-1067-4c61-b95d-6d7ba3eab289, expiring 2026-11-25T22:13:32.338Z, policy revision 187 epoch 98, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-2-standby-pins-20261125c run 20261125T220516Z-47743: the card's one Haiku renewal of 2026-11-25 succeeded, so the bound worker (release f49b4f154e6090762dc41bd5d28d8623e4260429, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-25-56eb91b1.
