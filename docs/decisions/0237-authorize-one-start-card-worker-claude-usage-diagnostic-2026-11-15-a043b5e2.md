---
arcadia: v1
type: decision
id: "0237"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-15-a043b5e2
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-15 a043b5e2
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 4d15cbea2dfb83cd29ea34d1bab8dd7390cc4b6a0a9b9f4dcbe00287d85781b6
options:
  - label: Authorize one worker Claude usage diagnostic 4d15cbea2dfb83cd29ea34d1bab8dd7390cc4b6a0a9b9f4dcbe00287d85781b6
    consequence: "Authorizes only the worker grant with SHA-256 4d15cbea2dfb83cd29ea34d1bab8dd7390cc4b6a0a9b9f4dcbe00287d85781b6: nonce a043b5e2-4adf-43a4-a9eb-283af86b6d83, expiring 2026-11-15T17:06:59.110Z, policy revision 133 epoch 71, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261113-part-3
updated: 2026-11-15
---

# Decision 0237: Authorize one START card worker Claude usage diagnostic 2026-11-15 a043b5e2

## Options

- **Authorize one worker Claude usage diagnostic 4d15cbea2dfb83cd29ea34d1bab8dd7390cc4b6a0a9b9f4dcbe00287d85781b6** (recommended): Authorizes only the worker grant with SHA-256 4d15cbea2dfb83cd29ea34d1bab8dd7390cc4b6a0a9b9f4dcbe00287d85781b6: nonce a043b5e2-4adf-43a4-a9eb-283af86b6d83, expiring 2026-11-15T17:06:59.110Z, policy revision 133 epoch 71, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-plan3-pins-10-12-20261115b run 20261115T165911Z-72461: the card's one Haiku renewal of 2026-11-15 succeeded, so the bound worker (release 3f6e8330f0f4cebd17a1726e251533e601656b34, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-15-a043b5e2.
