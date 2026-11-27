---
arcadia: v1
type: decision
id: "0304"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-26-ad3e07d1
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-26 ad3e07d1
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 6d755fbf4a28dcac1a3346c7c6c244bd6f4427947c5f01da487d66f8c5cbd0ed
options:
  - label: Authorize one worker Claude usage diagnostic 6d755fbf4a28dcac1a3346c7c6c244bd6f4427947c5f01da487d66f8c5cbd0ed
    consequence: "Authorizes only the worker grant with SHA-256 6d755fbf4a28dcac1a3346c7c6c244bd6f4427947c5f01da487d66f8c5cbd0ed: nonce ad3e07d1-f498-44d3-9892-08a4e24cc7c7, expiring 2026-11-27T05:57:29.153Z, policy revision 201 epoch 105, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-5-standby-test-pins-20261126
updated: 2026-11-27
---

# Decision 0304: Authorize one START card worker Claude usage diagnostic 2026-11-26 ad3e07d1

## Options

- **Authorize one worker Claude usage diagnostic 6d755fbf4a28dcac1a3346c7c6c244bd6f4427947c5f01da487d66f8c5cbd0ed** (recommended): Authorizes only the worker grant with SHA-256 6d755fbf4a28dcac1a3346c7c6c244bd6f4427947c5f01da487d66f8c5cbd0ed: nonce ad3e07d1-f498-44d3-9892-08a4e24cc7c7, expiring 2026-11-27T05:57:29.153Z, policy revision 201 epoch 105, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-5-standby-pins-20261126b run 20261127T054515Z-57268: the card's one Haiku renewal of 2026-11-26 succeeded, so the bound worker (release 6c2402dbc701ddc0f26af5700dbb9303e6078d53, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-26-ad3e07d1.
